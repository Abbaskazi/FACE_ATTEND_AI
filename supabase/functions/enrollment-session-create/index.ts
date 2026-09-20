import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";
import { parseBody, randomToken, sha256Hex } from "./validation.ts";
import type { EnrollmentSessionCreateResponse } from "./types.ts";

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

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_environment_${name}`);
  return value;
}

function response(body: EnrollmentSessionCreateResponse, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function failure(status = 400) {
  return response({ ok: false }, status);
}

async function authenticatedUserId(authClient: SupabaseClient, token: string) {
  const { data, error } = await authClient.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

async function handleRequest(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") return failure(405);
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return failure(401);
  const accessToken = authorization.slice("Bearer ".length).trim();
  if (!accessToken) return failure(401);

  let body;
  try {
    body = parseBody(JSON.parse(await request.text()));
  } catch {
    return failure(400);
  }

  const url = requiredEnv("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!anonKey) throw new Error("missing_environment_SUPABASE_ANON_KEY");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const authClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const serverClient = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const userId = await authenticatedUserId(authClient, accessToken);
  if (!userId) return failure(401);

  const { data: admin, error: adminError } = await serverClient
    .from("admin_profiles")
    .select("id, is_active")
    .eq("id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (adminError) throw adminError;
  if (!admin) return failure(403);

  const rawToken = randomToken();
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + (body.expires_in_seconds ?? 300) * 1000).toISOString();
  const { data, error } = await serverClient.rpc("create_enrollment_session", {
    p_employee_id: body.employee_id,
    p_token_hash: tokenHash,
    p_created_by: userId,
    p_expires_at: expiresAt,
  });
  if (error) {
    if (error.message.includes("already_enrolled")) return failure(409);
    if (error.message.includes("not_active")) return failure(422);
    throw error;
  }
  const result = (Array.isArray(data) ? data[0] : data) as { expires_at?: string } | null;
  if (!result?.expires_at) throw new Error("invalid_session_rpc_result");

  // This is the only response containing the raw capability. It is not stored
  // in the database and must be copied to the enrollment device once.
  return response({ ok: true, enrollment_token: rawToken, expires_at: result.expires_at });
}

Deno.serve(async (request) => {
  try {
    return await handleRequest(request);
  } catch {
    console.error("enrollment-session-create failed");
    return failure(500);
  }
});
