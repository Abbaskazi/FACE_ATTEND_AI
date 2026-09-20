import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";
import {
  MAX_BODY_BYTES,
  isUuid,
  parseAttendanceBody,
  toPgVectorLiteral,
} from "./validation.ts";
import type {
  AttendanceAttemptSummary,
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

function genericFailure(requestId: string, status = 400) {
  return response({ ok: false, outcome: "NOT_RECORDED", request_id: requestId }, status);
}

function successResponse(result: AttendanceRpcResult): AttendanceSubmitResponse {
  return {
    ok: result.outcome !== "NOT_RECORDED",
    outcome: result.outcome,
    request_id: result.request_id,
    server_time: result.server_time,
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
  return response({
    ok: attempt.outcome !== "NOT_RECORDED",
    outcome: attempt.outcome,
    request_id: requestId,
    server_time: attempt.created_at,
    ...(employee ? {
      employee_name: employee.full_name,
      employee_code: employee.employee_code,
    } : {}),
  });
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
    .select("outcome, created_at, employee_id")
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

async function handleRequest(request: Request) {
  if (request.method !== "POST") {
    return genericFailure("00000000-0000-4000-8000-000000000000", 405);
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return genericFailure("00000000-0000-4000-8000-000000000000", 413);
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return genericFailure("00000000-0000-4000-8000-000000000000", 401);
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) return genericFailure("00000000-0000-4000-8000-000000000000", 401);

  let body: AttendanceSubmitBody;
  let requestId = "00000000-0000-4000-8000-000000000000";
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return genericFailure(requestId, 413);
    }

    const parsed: unknown = JSON.parse(rawBody);
    body = parseAttendanceBody(parsed);
    requestId = body.request_id;
  } catch {
    return genericFailure(requestId, 400);
  }

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
  if (!authUserId) return genericFailure(requestId, 401);

  const device = await getActiveDevice(serverClient, authUserId);
  if (!device) return genericFailure(requestId, 403);

  const previousAttempt = await getPreviousAttempt(serverClient, device.id, requestId);
  if (previousAttempt) return previousAttemptResponse(serverClient, previousAttempt, requestId);

  if (await isRateLimited(serverClient, device.id)) {
    return genericFailure(requestId, 429);
  }

  const expectedModelName = getRequiredEnv("ATTENDANCE_MODEL_NAME");
  const expectedModelVersion = getRequiredEnv("ATTENDANCE_MODEL_VERSION");
  if (body.model_name !== expectedModelName || body.model_version !== expectedModelVersion) {
    return genericFailure(requestId, 422);
  }

  const requireChallenge = Deno.env.get("ATTENDANCE_REQUIRE_CHALLENGE") === "true";
  if (requireChallenge && !body.challenge_id) {
    return genericFailure(requestId, 422);
  }

  /*
   * Liveness integration point:
   * before calling the database function, verify a server challenge,
   * Android attestation, or another server-verifiable liveness proof.
   * A client-provided boolean is deliberately not accepted as proof.
   */

  await updateLastSeen(serverClient, device.id);

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

  const { data: attempt, error: attemptError } = await serverClient
    .from("attendance_attempts")
    .select("employee_id")
    .eq("device_id", device.id)
    .eq("request_id", requestId)
    .maybeSingle();
  if (attemptError) throw attemptError;
  const employee = await getEmployeeSummary(serverClient, attempt?.employee_id ?? null);
  return response({
    ...successResponse(result),
    ...(employee ? {
      employee_name: employee.full_name,
      employee_code: employee.employee_code,
    } : {}),
  });
}

Deno.serve(async (request) => {
  try {
    return await handleRequest(request);
  } catch (error) {
    // Never log request bodies, embeddings, tokens, database rows, or
    // database error messages that could contain implementation details.
    console.error("attendance-submit failed");
    return genericFailure("00000000-0000-4000-8000-000000000000", 500);
  }
});
