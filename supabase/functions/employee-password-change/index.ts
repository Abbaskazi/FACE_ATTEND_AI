import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";
import { parsePasswordChangeBody, type PasswordChangeBody } from "./validation.ts";

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

type PasswordChangeResponse = {
  ok: boolean;
  error_code?:
    | "UNAUTHENTICATED"
    | "NOT_EMPLOYEE"
    | "EMPLOYEE_INACTIVE"
    | "CURRENT_PASSWORD_INVALID"
    | "INVALID_REQUEST"
    | "PASSWORD_UPDATE_FAILED";
};

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_environment_${name}`);
  return value;
}

function response(body: PasswordChangeResponse, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function authenticatedUserId(authClient: SupabaseClient, token: string) {
  const { data, error } = await authClient.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

async function handlePasswordChange(
  serverClient: SupabaseClient,
  authClient: SupabaseClient,
  token: string,
  body: PasswordChangeBody,
) {
  const authUserId = await authenticatedUserId(authClient, token);
  if (!authUserId) return response({ ok: false, error_code: "UNAUTHENTICATED" }, 401);

  const { data: employee, error: employeeError } = await serverClient
    .from("employees")
    .select("id, employee_code, auth_user_id, status, must_change_password")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (employeeError) throw employeeError;
  if (!employee) return response({ ok: false, error_code: "NOT_EMPLOYEE" }, 403);
  if (employee.status !== "ACTIVE") return response({ ok: false, error_code: "EMPLOYEE_INACTIVE" }, 403);

  const { data: authUser, error: authUserError } = await serverClient.auth.admin.getUserById(authUserId);
  if (authUserError || !authUser.user?.email) return response({ ok: false, error_code: "CURRENT_PASSWORD_INVALID" }, 422);

  // Verify the current password against Auth without returning or persisting a
  // second session. The browser token only proves identity, not knowledge of
  // the current password.
  const { data: verified, error: verifyError } = await authClient.auth.signInWithPassword({
    email: authUser.user.email,
    password: body.current_password,
  });
  if (verifyError || !verified.user) return response({ ok: false, error_code: "CURRENT_PASSWORD_INVALID" }, 422);

  const { error: updateError } = await serverClient.auth.admin.updateUserById(authUserId, {
    password: body.new_password,
  });
  if (updateError) return response({ ok: false, error_code: "PASSWORD_UPDATE_FAILED" }, 422);

  const { data: completed, error: completionError } = await serverClient.rpc("complete_employee_password_change", {
    p_employee_id: employee.id,
    p_auth_user_id: authUserId,
  });
  if (completionError || completed !== true) {
    // Auth has accepted the password, but the employee remains gated. A retry
    // with the same new password safely completes the database step.
    console.error("employee-password-change state completion failed");
    return response({ ok: false, error_code: "PASSWORD_UPDATE_FAILED" }, 500);
  }

  const { error: auditError } = await serverClient.rpc("record_employee_security_audit", {
    p_action: "PASSWORD_CHANGE_COMPLETED",
    p_employee_id: employee.id,
  });
  if (auditError) {
    console.error("employee-password-change audit failed");
    return response({ ok: false, error_code: "PASSWORD_UPDATE_FAILED" }, 500);
  }

  const { error: requestCompletionError } = await serverClient.rpc("complete_employee_password_change_request", {
    p_employee_id: employee.id,
    p_auth_user_id: authUserId,
  });
  if (requestCompletionError) {
    console.error("employee-password-change request completion failed");
    return response({ ok: false, error_code: "PASSWORD_UPDATE_FAILED" }, 500);
  }

  return response({ ok: true });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") return response({ ok: false, error_code: "INVALID_REQUEST" }, 405);

  const token = bearerToken(request);
  if (!token) return response({ ok: false, error_code: "UNAUTHENTICATED" }, 401);

  let body: PasswordChangeBody;
  try {
    body = parsePasswordChangeBody(JSON.parse(await request.text()));
  } catch {
    return response({ ok: false, error_code: "INVALID_REQUEST" }, 400);
  }

  try {
    const url = requiredEnv("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (!anonKey) throw new Error("missing_environment_SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const serverClient = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    return await handlePasswordChange(serverClient, authClient, token, body);
  } catch {
    console.error("employee-password-change failed");
    return response({ ok: false, error_code: "PASSWORD_UPDATE_FAILED" }, 500);
  }
});
