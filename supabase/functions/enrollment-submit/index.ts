import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";
import { assertActiveDevice, assertEnrollmentState } from "./enrollment-rules.ts";
import {
  EMBEDDING_DIMENSION,
  MAX_BODY_BYTES,
  isSafeVersion,
  parseEnrollmentBody,
  sha256Hex,
  toPgVectorLiteral,
} from "./validation.ts";
import type { EnrollmentDevice, EnrollmentSessionState, EnrollmentSubmitBody, EnrollmentSubmitResponse } from "./types.ts";

const CORS_HEADERS = {
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-origin": "*",
};
const JSON_HEADERS = {
  ...CORS_HEADERS,
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

function getRequiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_environment_${name}`);
  return value;
}

function response(body: EnrollmentSubmitResponse, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function failure(status = 400) {
  return response({ ok: false }, status);
}

async function getAuthenticatedUserId(authClient: SupabaseClient, token: string) {
  const { data, error } = await authClient.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

async function getActiveDevice(serverClient: SupabaseClient, authUserId: string) {
  const { data, error } = await serverClient
    .from("attendance_devices")
    .select("id, auth_user_id, is_active")
    .eq("auth_user_id", authUserId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data as EnrollmentDevice | null;
}

async function getEnrollmentState(serverClient: SupabaseClient, tokenHash: string) {
  const sessionResult = await serverClient
    .from("enrollment_sessions")
    .select("id, employee_id, status, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (sessionResult.error) throw sessionResult.error;
  const session = sessionResult.data as EnrollmentSessionState | null;
  if (!session) return { session: null, employeeIsActive: false, templateExists: false };

  const [employeeResult, templateResult] = await Promise.all([
    serverClient.from("employees").select("status").eq("id", session.employee_id).maybeSingle(),
    serverClient.from("biometric_templates").select("id").eq("employee_id", session.employee_id).maybeSingle(),
  ]);
  if (employeeResult.error) throw employeeResult.error;
  if (templateResult.error) throw templateResult.error;
  return {
    session,
    employeeIsActive: employeeResult.data?.status === "ACTIVE",
    templateExists: Boolean(templateResult.data),
  };
}

function statusForEnrollmentError(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : "";
  if (message.includes("not_found") || message.includes("invalid")) return 422;
  if (message.includes("expired")) return 410;
  if (message.includes("reused") || message.includes("already_enrolled")) return 409;
  if (message.includes("not_active")) return 422;
  return 500;
}

async function handleRequest(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") return failure(405);

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return failure(401);
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) return failure(401);

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) return failure(413);

  let body: EnrollmentSubmitBody;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return failure(413);
    body = parseEnrollmentBody(JSON.parse(rawBody));
  } catch {
    return failure(400);
  }

  const expectedModelName = getRequiredEnv("ENROLLMENT_MODEL_NAME");
  const expectedModelVersion = getRequiredEnv("ENROLLMENT_MODEL_VERSION");
  if (!isSafeVersion(expectedModelName) || !isSafeVersion(expectedModelVersion)) throw new Error("invalid_model_configuration");
  if (body.model_name !== expectedModelName || body.model_version !== expectedModelVersion) return failure(422);

  const supabaseUrl = getRequiredEnv("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!anonKey) throw new Error("missing_environment_SUPABASE_ANON_KEY");
  const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const authClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const serverClient = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const authUserId = await getAuthenticatedUserId(authClient, token);
  if (!authUserId) return failure(401);
  const device = await getActiveDevice(serverClient, authUserId);
  try {
    assertActiveDevice(device);
  } catch {
    return failure(403);
  }

  const tokenHash = await sha256Hex(body.session_token);
  const state = await getEnrollmentState(serverClient, tokenHash);
  try {
    assertEnrollmentState(state);
  } catch (error) {
    return failure(statusForEnrollmentError(error));
  }

  const { data, error } = await serverClient.rpc("complete_enrollment", {
    p_token_hash: tokenHash,
    p_embedding: toPgVectorLiteral(body.embedding),
    p_model_name: body.model_name,
    p_model_version: body.model_version,
    p_device_id: device.id,
    p_app_version: body.app_version,
  });
  if (error) {
    return failure(statusForEnrollmentError(error));
  }
  const result = (Array.isArray(data) ? data[0] : data) as { completed_at?: string } | null;
  if (!result?.completed_at) throw new Error(`invalid_enrollment_rpc_result_${EMBEDDING_DIMENSION}`);
  return response({ ok: true, completed_at: result.completed_at });
}

Deno.serve(async (request) => {
  try {
    return await handleRequest(request);
  } catch {
    // Never log tokens, embeddings, request bodies, or database rows.
    console.error("enrollment-submit failed");
    return failure(500);
  }
});
