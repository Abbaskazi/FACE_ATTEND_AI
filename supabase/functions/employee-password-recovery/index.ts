import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";
import { maskEmail, parseRecoveryBody, type RecoveryAction, validateNewPassword } from "./validation.ts";

const CORS_HEADERS = {
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-origin": "*",
};
const JSON_HEADERS = { ...CORS_HEADERS, "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const GENERIC_MESSAGE = "If the employee account is eligible, recovery instructions have been sent.";
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_GENERATIONS_PER_HOUR = 5;
const OTP_MAX_ATTEMPTS = 5;

type RecoveryBody = ReturnType<typeof parseRecoveryBody>;
type RecoveryResponse = { ok: boolean; message?: string; challenge_id?: string; maskedEmail?: string; error_code?: string };

type DiagnosticCode = "EMPLOYEE_NOT_ELIGIBLE" | "OTP_COOLDOWN" | "OTP_RATE_LIMIT" | "DATABASE_FAILURE" | "RESEND_CONFIGURATION_MISSING" | "RESEND_REJECTED" | "INTERNAL_ERROR";

class RecoveryDiagnosticError extends Error {
  constructor(
    public readonly diagnosticCode: DiagnosticCode,
    public readonly failedStage: string,
    public readonly databaseCode?: string,
  ) {
    super(diagnosticCode);
  }
}

function diagnosticLog(stage: string, metadata: Record<string, unknown> = {}) {
  console.log("employee-password-recovery", { stage, ...metadata });
}

function databaseFailure(failedStage: string, error: unknown): RecoveryDiagnosticError {
  const databaseCode = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code.slice(0, 32)
    : undefined;
  return new RecoveryDiagnosticError("DATABASE_FAILURE", failedStage, databaseCode);
}

function senderDomain(value: string | undefined) {
  if (!value) return undefined;
  const match = value.match(/@([^\s>]+)>?\s*$/);
  return match?.[1];
}

function redactResendText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email redacted]")
    .replace(/re_[A-Za-z0-9_-]+/g, "[secret redacted]")
    .replace(/\b\d{6}\b/g, "[otp redacted]")
    .slice(0, 240);
}

function safeResendError(body: string) {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const nested = parsed.error && typeof parsed.error === "object" ? parsed.error as Record<string, unknown> : parsed;
    const code = typeof nested.name === "string" ? nested.name : typeof nested.code === "string" ? nested.code : undefined;
    const message = typeof nested.message === "string" ? redactResendText(nested.message) : undefined;
    return { code, message };
  } catch {
    return {};
  }
}

function response(body: RecoveryResponse, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function randomOtp() {
  // Rejection sampling avoids modulo bias while keeping the code six digits.
  const limit = Math.floor(0xffffffff / 1_000_000) * 1_000_000;
  const bytes = new Uint32Array(1);
  do crypto.getRandomValues(bytes); while (bytes[0] >= limit);
  return String(bytes[0] % 1_000_000).padStart(6, "0");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalDigest(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function audit(serverClient: SupabaseClient, action: string, employeeId: string, entityType = "employee", entityId?: string) {
  const { error } = await serverClient.rpc("record_employee_security_audit", {
    p_action: action,
    p_employee_id: employeeId,
    p_entity_type: entityType,
    p_entity_id: entityId ?? null,
  });
  if (error) throw error;
}

async function sendOtpEmail(email: string, otp: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("PASSWORD_RECOVERY_FROM_EMAIL");
  if (!apiKey || !from) throw new RecoveryDiagnosticError("RESEND_CONFIGURATION_MISSING", "resend_request");

  diagnosticLog("resend_request");
  let result: Response;
  try {
    result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "FaceAttend AI password recovery code",
        text: `Your FaceAttend AI password recovery code is ${otp}. It expires in 10 minutes and can be used once.`,
      }),
    });
  } catch {
    throw new RecoveryDiagnosticError("RESEND_REJECTED", "resend_request");
  }

  if (!result.ok) {
    const details = safeResendError(await result.text());
    diagnosticLog("resend_response", {
      status: result.status,
      ok: result.ok,
      ...(details.code ? { errorCode: details.code } : {}),
      ...(details.message ? { errorMessage: details.message } : {}),
    });
    throw new RecoveryDiagnosticError("RESEND_REJECTED", "resend_response");
  }

  diagnosticLog("resend_response", { status: result.status, ok: result.ok });
}

async function getEmployee(serverClient: SupabaseClient, employeeCode: string) {
  const { data, error } = await serverClient
    .from("employees")
    .select("id, employee_code, email, auth_user_id, status")
    .eq("employee_code", employeeCode)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; employee_code: string; email: string | null; auth_user_id: string | null; status: string } | null;
}

async function requestOtp(serverClient: SupabaseClient, body: RecoveryBody, isResend = false) {
  let employee: Awaited<ReturnType<typeof getEmployee>>;
  try {
    employee = await getEmployee(serverClient, body.employee_code);
  } catch (error) {
    throw databaseFailure("employee_lookup", error);
  }
  diagnosticLog("employee_lookup", { found: Boolean(employee) });

  const eligible = Boolean(employee && employee.status === "ACTIVE" && employee.email && employee.auth_user_id);
  diagnosticLog("eligibility_check", {
    employeeFound: Boolean(employee),
    active: employee?.status === "ACTIVE",
    emailPresent: Boolean(employee?.email),
    authMappingPresent: Boolean(employee?.auth_user_id),
    eligible,
  });
  if (!employee || employee.status !== "ACTIVE" || !employee.email || !employee.auth_user_id) {
    diagnosticLog("failure", { errorCode: "EMPLOYEE_NOT_ELIGIBLE", failedStage: "eligibility_check" });
    return response({ ok: false, error_code: "EMPLOYEE_NOT_ELIGIBLE" });
  }

  const now = Date.now();
  let recent: unknown[] | null;
  try {
    const result = await serverClient
      .from("employee_password_recovery_challenges")
      .select("id, created_at, last_sent_at")
      .eq("employee_id", employee.id)
      .order("created_at", { ascending: false })
      .limit(6);
    if (result.error) throw result.error;
    recent = result.data;
  } catch (error) {
    throw databaseFailure("otp_database_insert", error);
  }
  const recentRows = (recent ?? []) as Array<{ id: string; created_at: string; last_sent_at: string }>;
  const latest = recentRows[0];
  if (isResend && (!body.challenge_id || latest?.id !== body.challenge_id)) {
    diagnosticLog("failure", { errorCode: "INTERNAL_ERROR", failedStage: "eligibility_check" });
    return response({ ok: false, error_code: "OTP_INVALID" });
  }
  if (latest && now - Date.parse(latest.last_sent_at) < OTP_RESEND_COOLDOWN_MS) {
    diagnosticLog("failure", { errorCode: "OTP_COOLDOWN", failedStage: "eligibility_check" });
    return response({ ok: false, error_code: "OTP_COOLDOWN" });
  }
  if (recentRows.filter((row) => now - Date.parse(row.created_at) < 60 * 60 * 1000).length >= OTP_MAX_GENERATIONS_PER_HOUR) {
    diagnosticLog("failure", { errorCode: "OTP_RATE_LIMIT", failedStage: "eligibility_check" });
    return response({ ok: false, error_code: "OTP_RATE_LIMIT" });
  }

  const otp = randomOtp();
  const challengeId = crypto.randomUUID();
  const otpHash = await sha256(otp);
  try {
    const { error: invalidateError } = await serverClient
      .from("employee_password_recovery_challenges")
      .update({ invalidated_at: new Date().toISOString() })
      .eq("employee_id", employee.id)
      .is("used_at", null)
      .is("invalidated_at", null);
    if (invalidateError) throw invalidateError;
    const { error: insertError } = await serverClient.from("employee_password_recovery_challenges").insert({
      id: challengeId,
      employee_id: employee.id,
      otp_hash: otpHash,
      expires_at: new Date(now + OTP_TTL_MS).toISOString(),
      last_sent_at: new Date(now).toISOString(),
    });
    if (insertError) throw insertError;
  } catch (error) {
    throw databaseFailure("otp_database_insert", error);
  }
  diagnosticLog("otp_database_insert", { ok: true });

  try {
    await sendOtpEmail(employee.email.trim(), otp);
  } catch (error) {
    try {
      const { error: invalidateError } = await serverClient.from("employee_password_recovery_challenges").update({ invalidated_at: new Date().toISOString() }).eq("id", challengeId);
      if (invalidateError) throw invalidateError;
    } catch (cleanupError) {
      throw databaseFailure("otp_database_insert", cleanupError);
    }
    if (error instanceof RecoveryDiagnosticError) throw error;
    throw new RecoveryDiagnosticError("RESEND_REJECTED", "resend_request");
  }
  try {
    await audit(serverClient, "PASSWORD_RECOVERY_REQUESTED", employee.id, "password_recovery_challenge", challengeId);
    await audit(serverClient, "EMAIL_OTP_SENT", employee.id, "password_recovery_challenge", challengeId);
  } catch (error) {
    throw databaseFailure("success", error);
  }
  diagnosticLog("success", { action: isResend ? "resend-otp" : "request-otp" });
  return response({ ok: true, message: GENERIC_MESSAGE, challenge_id: challengeId, maskedEmail: maskEmail(employee.email.trim()) });
}

async function verifyOtp(serverClient: SupabaseClient, body: RecoveryBody) {
  if (!body.challenge_id || !body.otp) return response({ ok: false, error_code: "OTP_INVALID" });
  const employee = await getEmployee(serverClient, body.employee_code);
  const { data: challenge, error } = await serverClient.from("employee_password_recovery_challenges")
    .select("id, employee_id, otp_hash, expires_at, attempt_count, verified_at, used_at, invalidated_at")
    .eq("id", body.challenge_id)
    .maybeSingle();
  if (error) throw error;
  const validState = Boolean(employee && challenge && challenge.employee_id === employee.id && employee.status === "ACTIVE" && employee.auth_user_id && !challenge.used_at && !challenge.invalidated_at && !challenge.verified_at && Date.parse(challenge.expires_at) > Date.now() && challenge.attempt_count < OTP_MAX_ATTEMPTS);
  const providedHash = await sha256(body.otp);
  if (!validState || !equalDigest(providedHash, challenge?.otp_hash ?? "")) {
    const challengeBelongsToEmployee = Boolean(employee && challenge && challenge.employee_id === employee.id);
    let errorCode = "OTP_INVALID";
    if (challengeBelongsToEmployee && challenge?.id && !challenge.used_at && !challenge.invalidated_at && !challenge.verified_at) {
      const expired = Date.parse(challenge.expires_at) <= Date.now();
      const attemptsExhausted = (challenge.attempt_count ?? 0) >= OTP_MAX_ATTEMPTS;
      if (expired) {
        const { error: invalidateError } = await serverClient.from("employee_password_recovery_challenges").update({ invalidated_at: new Date().toISOString() }).eq("id", challenge.id).is("used_at", null).is("invalidated_at", null);
        if (invalidateError) throw invalidateError;
        errorCode = "OTP_EXPIRED";
      } else if (attemptsExhausted) {
        const { error: invalidateError } = await serverClient.from("employee_password_recovery_challenges").update({ invalidated_at: new Date().toISOString() }).eq("id", challenge.id).is("used_at", null).is("invalidated_at", null);
        if (invalidateError) throw invalidateError;
        errorCode = "OTP_ATTEMPTS_EXCEEDED";
      } else {
        const nextAttemptCount = Math.min((challenge.attempt_count ?? 0) + 1, OTP_MAX_ATTEMPTS);
        const update = nextAttemptCount >= OTP_MAX_ATTEMPTS
          ? { attempt_count: nextAttemptCount, invalidated_at: new Date().toISOString() }
          : { attempt_count: nextAttemptCount };
        const { error: attemptError } = await serverClient.from("employee_password_recovery_challenges").update(update).eq("id", challenge.id).is("verified_at", null).is("used_at", null).is("invalidated_at", null);
        if (attemptError) throw attemptError;
        if (nextAttemptCount >= OTP_MAX_ATTEMPTS) errorCode = "OTP_ATTEMPTS_EXCEEDED";
      }
      if (employee) await audit(serverClient, "OTP_FAILED", employee.id, "password_recovery_challenge", challenge.id);
    }
    return response({ ok: false, error_code: errorCode });
  }
  const { data: verifiedRows, error: updateError } = await serverClient.from("employee_password_recovery_challenges").update({ verified_at: new Date().toISOString() }).eq("id", challenge.id).is("verified_at", null).is("used_at", null).is("invalidated_at", null).select("id");
  if (updateError) throw updateError;
  if (!verifiedRows?.length) return response({ ok: false, error_code: "OTP_INVALID" });
  await audit(serverClient, "OTP_VERIFIED", employee.id, "password_recovery_challenge", challenge.id);
  return response({ ok: true });
}

async function resetPassword(serverClient: SupabaseClient, body: RecoveryBody) {
  if (!body.challenge_id || !body.new_password) return response({ ok: false, error_code: "INVALID_REQUEST" }, 422);
  validateNewPassword(body.new_password);
  const { data: challenge, error } = await serverClient.from("employee_password_recovery_challenges")
    .select("id, employee_id, expires_at, verified_at, used_at, invalidated_at")
    .eq("id", body.challenge_id)
    .maybeSingle();
  if (error) throw error;
  if (!challenge || challenge.used_at || challenge.invalidated_at || !challenge.verified_at || Date.parse(challenge.expires_at) <= Date.now()) return response({ ok: false, error_code: "RECOVERY_EXPIRED" }, 422);
  const { data: employee, error: employeeError } = await serverClient.from("employees").select("id, auth_user_id, status").eq("id", challenge.employee_id).maybeSingle();
  if (employeeError) throw employeeError;
  if (!employee || employee.status !== "ACTIVE" || !employee.auth_user_id) return response({ ok: false, error_code: "RECOVERY_EXPIRED" }, 422);
  // Claim the challenge before changing Auth. This makes the reset single-use
  // even when two requests arrive concurrently.
  const { data: claimedRows, error: claimError } = await serverClient.from("employee_password_recovery_challenges")
    .update({ used_at: new Date().toISOString() })
    .eq("id", challenge.id)
    .is("used_at", null)
    .is("invalidated_at", null)
    .not("verified_at", "is", null)
    .select("id");
  if (claimError) throw claimError;
  if (!claimedRows?.length) return response({ ok: false, error_code: "RECOVERY_EXPIRED" }, 422);
  const { error: authError } = await serverClient.auth.admin.updateUserById(employee.auth_user_id, { password: body.new_password });
  if (authError) return response({ ok: false, error_code: "PASSWORD_RESET_FAILED" }, 500);
  const { data: completed, error: completeError } = await serverClient.rpc("complete_employee_password_change", { p_employee_id: employee.id, p_auth_user_id: employee.auth_user_id });
  if (completeError || completed !== true) return response({ ok: false, error_code: "PASSWORD_RESET_FAILED" }, 500);
  await audit(serverClient, "PASSWORD_RESET_COMPLETED", employee.id, "password_recovery_challenge", challenge.id);
  return response({ ok: true });
}

async function requestAdminReset(serverClient: SupabaseClient, body: RecoveryBody) {
  const employee = await getEmployee(serverClient, body.employee_code);
  const generic = response({ ok: true, message: "Your request has been submitted for administrator review." });
  if (!employee || employee.status !== "ACTIVE" || !employee.auth_user_id) return generic;
  const { data: inserted, error } = await serverClient.from("employee_password_change_requests").insert({ employee_id: employee.id, reason: body.reason || null }).select("id").maybeSingle();
  if (error && !/duplicate|unique/i.test(error.message)) throw error;
  if (inserted?.id) await audit(serverClient, "PASSWORD_CHANGE_REQUESTED", employee.id, "employee_password_change_request", inserted.id);
  return generic;
}

async function handle(serverClient: SupabaseClient, body: RecoveryBody) {
  switch (body.action as RecoveryAction) {
    case "request-otp": return requestOtp(serverClient, body);
    case "resend-otp": return requestOtp(serverClient, body, true);
    case "verify-otp": return verifyOtp(serverClient, body);
    case "reset-password": return resetPassword(serverClient, body);
    case "request-admin-reset": return requestAdminReset(serverClient, body);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  diagnosticLog("request_received", { method: request.method });
  if (request.method !== "POST") return response({ ok: false, error_code: "INVALID_REQUEST" }, 405);
  try {
    const body = parseRecoveryBody(JSON.parse(await request.text()));
    const isOtpRequest = body.action === "request-otp" || body.action === "resend-otp";
    const url = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("PASSWORD_RECOVERY_FROM_EMAIL");
    if (isOtpRequest) {
      diagnosticLog("environment_check", {
        supabaseUrlPresent: Boolean(url),
        serviceRoleKeyPresent: Boolean(serviceRoleKey),
        resendApiKeyPresent: Boolean(resendApiKey),
        senderConfigured: Boolean(fromEmail),
        ...(fromEmail ? { senderDomain: senderDomain(fromEmail) } : {}),
      });
    }
    if (!url || !serviceRoleKey) throw new RecoveryDiagnosticError("INTERNAL_ERROR", "environment_check");
    if (isOtpRequest && (!resendApiKey || !fromEmail)) throw new RecoveryDiagnosticError("RESEND_CONFIGURATION_MISSING", "environment_check");
    const serverClient = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    return await handle(serverClient, body);
  } catch (error) {
    if (error instanceof Error && ["password_invalid", "passwords_do_not_match", "invalid_request"].includes(error.message)) {
      diagnosticLog("failure", { errorCode: "INVALID_REQUEST", failedStage: "request_received" });
      return response({ ok: false, error_code: "INVALID_REQUEST" }, 400);
    }
    if (error instanceof RecoveryDiagnosticError) {
      diagnosticLog("failure", {
        errorCode: error.diagnosticCode,
        failedStage: error.failedStage,
        ...(error.databaseCode ? { databaseCode: error.databaseCode } : {}),
      });
      return response({ ok: false, error_code: error.diagnosticCode });
    }
    diagnosticLog("failure", { errorCode: "INTERNAL_ERROR", failedStage: "unknown" });
    return response({ ok: false, error_code: "INTERNAL_ERROR" });
  }
});
