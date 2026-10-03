import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";
import { parseEmployeeAccountAdminBody, type EmployeeAccountAdminBody } from "./validation.ts";

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

type AdminResponse = {
  ok: boolean;
  error_code?:
    | "UNAUTHENTICATED"
    | "ADMIN_REQUIRED"
    | "EMPLOYEE_NOT_FOUND"
    | "ACCOUNT_ALREADY_EXISTS"
    | "ACCOUNT_NOT_PROVISIONED"
    | "ACCOUNT_OPERATION_FAILED"
    | "PASSWORD_REQUEST_NOT_FOUND"
    | "PASSWORD_REQUEST_OPERATION_FAILED"
    | "INVALID_REQUEST";
  provisioned?: boolean;
};

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_environment_${name}`);
  return value;
}

function temporaryPassword() {
  return requiredEnv("EMPLOYEE_INITIAL_PASSWORD");
}

function response(body: AdminResponse, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

async function authenticatedUserId(authClient: SupabaseClient, token: string) {
  const { data, error } = await authClient.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

function internalAuthEmail(employeeCode: string) {
  const bytes = new TextEncoder().encode(employeeCode);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `employee-${encoded}@auth.faceattend.internal`;
}

async function assertActiveAdmin(serverClient: SupabaseClient, userId: string) {
  const { data, error } = await serverClient
    .from("admin_profiles")
    .select("id")
    .eq("id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function getEmployee(serverClient: SupabaseClient, employeeId: string) {
  const { data, error } = await serverClient
    .from("employees")
    .select("id, employee_code, auth_user_id")
    .eq("id", employeeId)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; employee_code: string; auth_user_id: string | null } | null;
}

async function provision(serverClient: SupabaseClient, employeeId: string, actorUserId: string) {
  const employee = await getEmployee(serverClient, employeeId);
  if (!employee) return response({ ok: false, error_code: "EMPLOYEE_NOT_FOUND" }, 404);

  if (employee.auth_user_id) {
    const { data: existingUser, error } = await serverClient.auth.admin.getUserById(employee.auth_user_id);
    if (error || !existingUser.user) return response({ ok: false, error_code: "ACCOUNT_NOT_PROVISIONED" }, 409);
    return response({ ok: true, provisioned: true });
  }

  const { data: created, error: createError } = await serverClient.auth.admin.createUser({
    email: internalAuthEmail(employee.employee_code),
    password: temporaryPassword(),
    email_confirm: true,
    user_metadata: { employee_id: employee.id, employee_code: employee.employee_code },
    app_metadata: { role: "employee", employee_id: employee.id },
  });
  if (createError || !created.user) {
    // A deterministic internal email makes a duplicate explicit. Never create
    // a second Auth user or return the internal email to the browser.
    return response({ ok: false, error_code: "ACCOUNT_ALREADY_EXISTS" }, 409);
  }

  const { data: mapped, error: mappingError } = await serverClient.rpc("set_employee_auth_user", {
    p_employee_id: employee.id,
    p_auth_user_id: created.user.id,
    p_actor_user_id: actorUserId,
  });
  if (mappingError || mapped !== created.user.id) {
    await serverClient.auth.admin.deleteUser(created.user.id);
    console.error("employee account mapping failed");
    return response({ ok: false, error_code: "ACCOUNT_OPERATION_FAILED" }, 500);
  }

  return response({ ok: true, provisioned: true });
}

async function deprovision(serverClient: SupabaseClient, employeeId: string, actorUserId: string) {
  const employee = await getEmployee(serverClient, employeeId);
  if (!employee) return response({ ok: false, error_code: "EMPLOYEE_NOT_FOUND" }, 404);
  if (!employee.auth_user_id) return response({ ok: true, provisioned: false });

  const { error: deleteError } = await serverClient.auth.admin.deleteUser(employee.auth_user_id);
  if (deleteError && !/not found|does not exist/i.test(deleteError.message)) {
    return response({ ok: false, error_code: "ACCOUNT_OPERATION_FAILED" }, 500);
  }

  const { error: mappingError } = await serverClient.rpc("clear_employee_auth_user", {
    p_employee_id: employee.id,
    p_auth_user_id: employee.auth_user_id,
    p_actor_user_id: actorUserId,
  });
  if (mappingError) {
    console.error("employee account deprovision mapping failed");
    return response({ ok: false, error_code: "ACCOUNT_OPERATION_FAILED" }, 500);
  }
  return response({ ok: true, provisioned: false });
}

async function approvePasswordRequest(serverClient: SupabaseClient, requestId: string, actorUserId: string) {
  const { data: request, error: requestError } = await serverClient
    .from("employee_password_change_requests")
    .select("id, employee_id, status")
    .eq("id", requestId)
    .maybeSingle();
  if (requestError) throw requestError;
  if (!request || request.status !== "PENDING") return response({ ok: false, error_code: "PASSWORD_REQUEST_NOT_FOUND" }, 404);

  const employee = await getEmployee(serverClient, request.employee_id);
  if (!employee || !employee.auth_user_id) return response({ ok: false, error_code: "PASSWORD_REQUEST_NOT_FOUND" }, 404);
  // Reject self-reset before touching Auth. The database RPC repeats this
  // check as a second server-side authorization boundary.
  if (employee.auth_user_id === actorUserId) return response({ ok: false, error_code: "PASSWORD_REQUEST_OPERATION_FAILED" }, 403);
  const { error: resetError } = await serverClient.auth.admin.updateUserById(employee.auth_user_id, { password: temporaryPassword() });
  if (resetError) return response({ ok: false, error_code: "PASSWORD_REQUEST_OPERATION_FAILED" }, 500);

  const { data: marked, error: markError } = await serverClient.rpc("mark_employee_admin_password_reset", {
    p_request_id: request.id,
    p_employee_id: employee.id,
    p_auth_user_id: employee.auth_user_id,
    p_actor_user_id: actorUserId,
  });
  if (markError || marked !== true) {
    console.error("employee admin password reset state update failed");
    return response({ ok: false, error_code: "PASSWORD_REQUEST_OPERATION_FAILED" }, 500);
  }
  return response({ ok: true });
}

async function rejectPasswordRequest(serverClient: SupabaseClient, requestId: string, actorUserId: string, rejectionReason?: string) {
  const { data: rejected, error } = await serverClient.rpc("reject_employee_password_change_request", {
    p_request_id: requestId,
    p_actor_user_id: actorUserId,
    p_rejection_reason: rejectionReason?.trim() || null,
  });
  if (error || rejected !== true) return response({ ok: false, error_code: "PASSWORD_REQUEST_NOT_FOUND" }, 404);
  return response({ ok: true });
}

async function handleRequest(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") return response({ ok: false, error_code: "INVALID_REQUEST" }, 405);
  const token = bearerToken(request);
  if (!token) return response({ ok: false, error_code: "UNAUTHENTICATED" }, 401);

  let body: EmployeeAccountAdminBody;
  try {
    body = parseEmployeeAccountAdminBody(JSON.parse(await request.text()));
  } catch {
    return response({ ok: false, error_code: "INVALID_REQUEST" }, 400);
  }

  const url = requiredEnv("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!anonKey) throw new Error("missing_environment_SUPABASE_ANON_KEY");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const authClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const serverClient = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const actorUserId = await authenticatedUserId(authClient, token);
  if (!actorUserId) return response({ ok: false, error_code: "UNAUTHENTICATED" }, 401);
  if (!await assertActiveAdmin(serverClient, actorUserId)) return response({ ok: false, error_code: "ADMIN_REQUIRED" }, 403);

  if (body.action === "provision") return provision(serverClient, body.employee_id!, actorUserId);
  if (body.action === "deprovision") return deprovision(serverClient, body.employee_id!, actorUserId);
  if (body.action === "approve-password-request") return approvePasswordRequest(serverClient, body.request_id!, actorUserId);
  return rejectPasswordRequest(serverClient, body.request_id!, actorUserId, body.rejection_reason);
}

Deno.serve(async (request) => {
  try {
    return await handleRequest(request);
  } catch {
    console.error("employee-account-admin failed");
    return response({ ok: false, error_code: "ACCOUNT_OPERATION_FAILED" }, 500);
  }
});
