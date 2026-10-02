import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";
import {
  MAX_BODY_BYTES,
  isUuid,
  parseAttendanceBody,
  toPgVectorLiteral,
} from "./validation.ts";
import type {
  AttendanceAttemptSummary,
  AttendanceDiagnosticSummary,
  AttendanceEmployeeSummary,
  AttendanceDevice,
  AttendanceRpcResult,
  AttendanceSubmitBody,
  AttendanceSubmitResponse,
} from "./types.ts";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};
const RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT = 30;
const ZERO_REQUEST_ID = "00000000-0000-4000-8000-000000000000";

type DiagnosticContext = {
  enabled: boolean;
  requestId: string;
  action: string;
  stage: string;
  httpStatus: number | null;
  backendOutcome: string;
};

type LiveMatchDiagnosticResult = {
  claimed: boolean;
  request_id: string;
  candidate_count: number;
  top_employee_code: string | null;
  top_score: number | null;
  second_employee_code: string | null;
  second_score: number | null;
  score_margin: number | null;
  threshold: number;
  ambiguity_margin: number;
  decision: string;
  model_name: string;
  model_version: string;
  embedding_dimension: number;
  normalization_status: string;
};

let diagnosticRequestClaimed = false;

function claimDiagnosticRequest() {
  if (diagnosticRequestClaimed) return false;
  diagnosticRequestClaimed = true;
  return true;
}

function safeDiagnosticText(value: string) {
  return value
    .replace(
      /(access_token|refresh_token|authorization|apikey|service[-_ ]role|password|embedding|biometric|face)\s*[:=]\s*[^,;\s]+/gi,
      "$1=<redacted>",
    )
    .replace(/[\r\n]+/g, " ")
    .slice(0, 240);
}

function safeExceptionDetails(error: unknown) {
  const metadata = error && typeof error === "object"
    ? error as Record<string, unknown>
    : null;
  const errorCode = typeof metadata?.code === "string" && /^[A-Z0-9]{2,12}$/.test(metadata.code)
    ? metadata.code
    : "none";
  if (error instanceof Error) {
    return {
      type: error.name || error.constructor.name,
      message: safeDiagnosticText(error.message || "no message"),
      code: errorCode,
    };
  }
  return { type: typeof error, message: safeDiagnosticText(String(error)), code: errorCode };
}

function logDiagnosticResult(context: DiagnosticContext, exception?: unknown) {
  if (!context.enabled) return;
  const details = exception
    ? safeExceptionDetails(exception)
    : { type: "none", code: "none", message: "none" };
  const level = exception ? console.error : console.info;
  level(
      "attendance-submit-diagnostic " +
      `requestId=${context.requestId} action=${context.action} stage=${context.stage} ` +
      `exceptionType=${details.type} exceptionCode=${details.code} exceptionMessage=${details.message} ` +
      `httpStatus=${context.httpStatus ?? "none"} backendOutcome=${context.backendOutcome}`,
  );
}

function getRequiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_environment_${name}`);
  return value;
}

function getRateLimit() {
  const rawValue = Deno.env.get("ATTENDANCE_RATE_LIMIT_PER_MINUTE");
  if (!rawValue) return DEFAULT_RATE_LIMIT;
  const parsed = Number(rawValue);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_RATE_LIMIT;
}

function response(body: AttendanceSubmitResponse, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function genericFailure(
  requestId: string,
  status: number,
  outcome: AttendanceSubmitResponse["outcome"],
) {
  return response({ ok: false, outcome, request_id: requestId }, status);
}

function liveMatchDiagnosticResponse(result: LiveMatchDiagnosticResult) {
  const safeOutcome = result.decision === "AMBIGUOUS_MATCH"
    ? "AMBIGUOUS_MATCH"
    : "VALIDATION_ERROR";
  return response({
    ok: false,
    outcome: safeOutcome,
    request_id: result.request_id,
    error_code: "LIVE_MATCH_DIAGNOSTIC",
    message: "Live match diagnostic recorded; attendance was not written.",
    diagnostic: {
      claimed: result.claimed,
      candidate_count: result.candidate_count,
      top_employee_code: result.top_employee_code,
      top_score: result.top_score,
      second_employee_code: result.second_employee_code,
      second_score: result.second_score,
      score_margin: result.score_margin,
      threshold: result.threshold,
      ambiguity_margin: result.ambiguity_margin,
      decision: result.decision,
      model_name: result.model_name,
      model_version: result.model_version,
      embedding_dimension: result.embedding_dimension,
      normalization_status: result.normalization_status,
    },
  } as unknown as AttendanceSubmitResponse, 422);
}

function optionalDiagnosticFromRpc(
  result: AttendanceRpcResult,
): AttendanceDiagnosticSummary | undefined {
  const diagnostic: AttendanceDiagnosticSummary = {
    candidate_count: result.candidate_count ?? null,
    top_employee_code: result.top_employee_code ?? null,
    top_score: result.top_score ?? null,
    second_employee_code: result.second_employee_code ?? null,
    second_score: result.second_score ?? null,
    score_margin: result.score_margin ?? null,
    threshold: result.threshold ?? null,
    ambiguity_margin: result.ambiguity_margin ?? null,
  };

  return Object.values(diagnostic).some((value) => value !== null)
    ? diagnostic
    : undefined;
}

function successResponse(result: AttendanceRpcResult): AttendanceSubmitResponse {
  return {
    ok: result.outcome === "CHECK_IN_RECORDED" || result.outcome === "CHECK_OUT_RECORDED",
    outcome: result.outcome,
    request_id: result.request_id,
    server_time: result.server_time,
    check_in_time: result.check_in_time ?? undefined,
    check_out_time: result.check_out_time ?? undefined,
    session_working_minutes: result.session_working_minutes ?? undefined,
    today_total_working_minutes: result.today_total_working_minutes ?? undefined,
    diagnostic: optionalDiagnosticFromRpc(result),
  };
}

function attemptResponse(
  attempt: AttendanceAttemptSummary,
  employee: AttendanceEmployeeSummary | null,
  requestId: string,
): AttendanceSubmitResponse {
  return {
    ok: attempt.outcome === "CHECK_IN_RECORDED" || attempt.outcome === "CHECK_OUT_RECORDED",
    outcome: attempt.outcome,
    request_id: requestId,
    server_time: attempt.created_at,
    ...(employee ? {
      employee_name: employee.full_name,
      employee_code: employee.employee_code,
    } : {}),
    check_in_time: attempt.check_in_time ?? undefined,
    check_out_time: attempt.check_out_time ?? undefined,
    session_working_minutes: attempt.session_working_minutes ?? undefined,
    today_total_working_minutes: attempt.today_total_working_minutes ?? undefined,
  };
}

async function getEmployeeSummary(
  serverClient: SupabaseClient,
  employeeId: string | null,
): Promise<AttendanceEmployeeSummary | null> {
  if (!employeeId) return null;
  const { data, error } = await serverClient
    .from("employees")
    .select("full_name, employee_code")
    .eq("id", employeeId)
    .maybeSingle();
  if (error) throw error;
  return data as AttendanceEmployeeSummary | null;
}

async function previousAttemptResponse(
  serverClient: SupabaseClient,
  attempt: AttendanceAttemptSummary,
  requestId: string,
) {
  const employee = await getEmployeeSummary(serverClient, attempt.employee_id);
  if (!employee && [
    "CHECK_IN_RECORDED",
    "ALREADY_CHECKED_IN",
    "CHECK_OUT_RECORDED",
    "NOT_CHECKED_IN",
  ].includes(attempt.outcome)) {
    throw new Error("attendance_employee_identity_missing");
  }
  return response(attemptResponse(attempt, employee, requestId));
}

async function getAuthenticatedUserId(
  authClient: SupabaseClient,
  token: string,
) {
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

async function getActiveDevice(
  serverClient: SupabaseClient,
  authUserId: string,
) {
  const { data, error } = await serverClient
    .from("attendance_devices")
    .select("id, auth_user_id, is_active, timezone")
    .eq("auth_user_id", authUserId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  return data as AttendanceDevice | null;
}

async function getPreviousAttempt(
  serverClient: SupabaseClient,
  deviceId: string,
  requestId: string,
) {
  const { data, error } = await serverClient
    .from("attendance_attempts")
    .select("outcome, created_at, employee_id, attendance_id, check_in_time, check_out_time, session_working_minutes, today_total_working_minutes")
    .eq("device_id", deviceId)
    .eq("request_id", requestId)
    .maybeSingle();

  if (error) throw error;
  return data as AttendanceAttemptSummary | null;
}

async function isRateLimited(serverClient: SupabaseClient, deviceId: string) {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count, error } = await serverClient
    .from("attendance_attempts")
    .select("id", { count: "exact", head: true })
    .eq("device_id", deviceId)
    .gte("created_at", since);

  if (error) throw error;
  return (count ?? 0) >= getRateLimit();
}

async function updateLastSeen(serverClient: SupabaseClient, deviceId: string) {
  // This is operational metadata only; it does not affect attendance
  // authorization and is never returned to the device.
  await serverClient
    .from("attendance_devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", deviceId);
}

async function handleRequest(request: Request, diagnostics: DiagnosticContext) {
  if (request.method !== "POST") {
    diagnostics.stage = "VALIDATION";
    diagnostics.httpStatus = 405;
    diagnostics.backendOutcome = "VALIDATION_ERROR";
    logDiagnosticResult(diagnostics);
    return genericFailure(ZERO_REQUEST_ID, 405, "VALIDATION_ERROR");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    diagnostics.stage = "VALIDATION";
    diagnostics.httpStatus = 413;
    diagnostics.backendOutcome = "VALIDATION_ERROR";
    logDiagnosticResult(diagnostics);
    return genericFailure(ZERO_REQUEST_ID, 413, "VALIDATION_ERROR");
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    diagnostics.stage = "AUTH";
    diagnostics.httpStatus = 401;
    diagnostics.backendOutcome = "UNAUTHORIZED_DEVICE";
    logDiagnosticResult(diagnostics);
    return genericFailure(ZERO_REQUEST_ID, 401, "UNAUTHORIZED_DEVICE");
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    diagnostics.stage = "AUTH";
    diagnostics.httpStatus = 401;
    diagnostics.backendOutcome = "UNAUTHORIZED_DEVICE";
    logDiagnosticResult(diagnostics);
    return genericFailure(ZERO_REQUEST_ID, 401, "UNAUTHORIZED_DEVICE");
  }

  let body: AttendanceSubmitBody;
  let requestId = ZERO_REQUEST_ID;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      diagnostics.stage = "VALIDATION";
      diagnostics.httpStatus = 413;
      diagnostics.backendOutcome = "VALIDATION_ERROR";
      logDiagnosticResult(diagnostics);
      return genericFailure(requestId, 413, "VALIDATION_ERROR");
    }

    const parsed: unknown = JSON.parse(rawBody);
    body = parseAttendanceBody(parsed);
    requestId = body.request_id;
  } catch {
    diagnostics.stage = "VALIDATION";
    diagnostics.httpStatus = 400;
    diagnostics.backendOutcome = "VALIDATION_ERROR";
    logDiagnosticResult(diagnostics);
    return genericFailure(requestId, 400, "VALIDATION_ERROR");
  }

  diagnostics.enabled = claimDiagnosticRequest();
  diagnostics.requestId = body.request_id;
  diagnostics.action = body.action;
  diagnostics.stage = "AUTH";

  const supabaseUrl = getRequiredEnv("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!anonKey) throw new Error("missing_environment_SUPABASE_ANON_KEY");
  const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const serverClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const authUserId = await getAuthenticatedUserId(authClient, token);
  if (!authUserId) {
    diagnostics.httpStatus = 401;
    diagnostics.backendOutcome = "UNAUTHORIZED_DEVICE";
    logDiagnosticResult(diagnostics);
    return genericFailure(requestId, 401, "UNAUTHORIZED_DEVICE");
  }

  diagnostics.stage = "DEVICE";
  const device = await getActiveDevice(serverClient, authUserId);
  if (!device) {
    diagnostics.httpStatus = 403;
    diagnostics.backendOutcome = "UNAUTHORIZED_DEVICE";
    logDiagnosticResult(diagnostics);
    return genericFailure(requestId, 403, "UNAUTHORIZED_DEVICE");
  }

  diagnostics.stage = "ATTEMPT_LOOKUP";
  const previousAttempt = await getPreviousAttempt(serverClient, device.id, requestId);
  if (previousAttempt) {
    diagnostics.stage = "RESPONSE";
    diagnostics.httpStatus = 200;
    diagnostics.backendOutcome = previousAttempt.outcome;
    logDiagnosticResult(diagnostics);
    return previousAttemptResponse(serverClient, previousAttempt, requestId);
  }

  if (await isRateLimited(serverClient, device.id)) {
    diagnostics.httpStatus = 429;
    diagnostics.backendOutcome = "RATE_LIMITED";
    logDiagnosticResult(diagnostics);
    return genericFailure(requestId, 429, "RATE_LIMITED");
  }

  diagnostics.stage = "VALIDATION";
  const expectedModelName = getRequiredEnv("ATTENDANCE_MODEL_NAME");
  const expectedModelVersion = getRequiredEnv("ATTENDANCE_MODEL_VERSION");
  if (body.model_name !== expectedModelName || body.model_version !== expectedModelVersion) {
    diagnostics.httpStatus = 422;
    diagnostics.backendOutcome = "VALIDATION_ERROR";
    logDiagnosticResult(diagnostics);
    return genericFailure(requestId, 422, "VALIDATION_ERROR");
  }

  const requireChallenge = Deno.env.get("ATTENDANCE_REQUIRE_CHALLENGE") === "true";
  if (requireChallenge && !body.challenge_id) {
    diagnostics.httpStatus = 422;
    diagnostics.backendOutcome = "VALIDATION_ERROR";
    logDiagnosticResult(diagnostics);
    return genericFailure(requestId, 422, "VALIDATION_ERROR");
  }

  if (Deno.env.get("ATTENDANCE_LIVE_DIAGNOSTIC_ONCE") === "true") {
    diagnostics.stage = "LIVE_MATCH_DIAGNOSTIC";
    const { data: diagnosticData, error: diagnosticError } = await serverClient.rpc(
      "diagnose_live_face_match",
      {
        p_device_id: device.id,
        p_request_id: body.request_id,
        p_embedding: toPgVectorLiteral(body.embedding),
        p_action: body.action,
        p_model_name: body.model_name,
        p_model_version: body.model_version,
      },
    );
    if (diagnosticError) throw diagnosticError;
    const diagnostic = (Array.isArray(diagnosticData) ? diagnosticData[0] : diagnosticData) as LiveMatchDiagnosticResult | null;
    if (!diagnostic || !isUuid(diagnostic.request_id)) throw new Error("invalid_live_match_diagnostic_result");
    diagnostics.httpStatus = 422;
    diagnostics.backendOutcome = diagnostic.decision;
    logDiagnosticResult(diagnostics);
    return liveMatchDiagnosticResponse(diagnostic);
  }

  /*
   * Liveness integration point:
   * before calling the database function, verify a server challenge,
   * Android attestation, or another server-verifiable liveness proof.
   * A client-provided boolean is deliberately not accepted as proof.
   */

  diagnostics.stage = "DEVICE";
  await updateLastSeen(serverClient, device.id);

  diagnostics.stage = "RPC";
  const { data, error } = await serverClient.rpc("record_attendance_from_face", {
    p_device_id: device.id,
    p_request_id: body.request_id,
    p_embedding: toPgVectorLiteral(body.embedding),
    p_action: body.action,
    p_model_name: body.model_name,
    p_model_version: body.model_version,
    p_app_version: body.app_version,
    p_challenge_id: body.challenge_id ?? null,
  });

  if (error) throw error;

  const result = (Array.isArray(data) ? data[0] : data) as AttendanceRpcResult | null;
  if (!result || !isUuid(result.request_id)) throw new Error("invalid_attendance_rpc_result");
  diagnostics.backendOutcome = result.outcome;

  diagnostics.stage = "ATTEMPT_LOOKUP";
  const { data: attempt, error: attemptError } = await serverClient
    .from("attendance_attempts")
    .select("outcome, created_at, employee_id, attendance_id, check_in_time, check_out_time, session_working_minutes, today_total_working_minutes")
    .eq("device_id", device.id)
    .eq("request_id", requestId)
    .maybeSingle();
  if (attemptError) throw attemptError;
  if (!attempt) throw new Error("attendance_attempt_missing");
  diagnostics.stage = "EMPLOYEE_LOOKUP";
  const employee = await getEmployeeSummary(serverClient, attempt?.employee_id ?? null);
  if (!employee && [
    "CHECK_IN_RECORDED",
    "ALREADY_CHECKED_IN",
    "CHECK_OUT_RECORDED",
    "NOT_CHECKED_IN",
  ].includes(result.outcome)) {
    throw new Error("attendance_employee_identity_missing");
  }
  diagnostics.stage = "RESPONSE";
  diagnostics.httpStatus = 200;
  logDiagnosticResult(diagnostics);
  return response({ ...successResponse(result), ...attemptResponse(attempt, employee, requestId) });
}

Deno.serve(async (request) => {
  const diagnostics: DiagnosticContext = {
    enabled: false,
    requestId: ZERO_REQUEST_ID,
    action: "unknown",
    stage: "REQUEST",
    httpStatus: null,
    backendOutcome: "SERVER_ERROR",
  };
  try {
    return await handleRequest(request, diagnostics);
  } catch (error) {
    diagnostics.httpStatus = 500;
    diagnostics.backendOutcome = "SERVER_ERROR";
    logDiagnosticResult(diagnostics, error);
    // Never log request bodies, embeddings, tokens, database rows, or
    // database error messages that could contain implementation details.
    console.error("attendance-submit failed");
    return genericFailure(ZERO_REQUEST_ID, 500, "SERVER_ERROR");
  }
});
