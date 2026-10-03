import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";
import { parseEmployeeLoginBody, type EmployeeLoginBody } from "./validation.ts";

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

type LoginErrorCode =
  | "INVALID_CREDENTIALS"
  | "EMPLOYEE_INACTIVE"
  | "EMPLOYEE_SUSPENDED"
  | "ACCOUNT_NOT_PROVISIONED";

type LoginResponse = {
  ok: boolean;
  error_code?: LoginErrorCode | "INVALID_REQUEST" | "AUTHENTICATION_UNAVAILABLE";
  session?: unknown;
};

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_environment_${name}`);
  return value;
}

function response(body: LoginResponse, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function failure(errorCode: LoginResponse["error_code"], status = 200) {
  return response({ ok: false, error_code: errorCode }, status);
}

async function findEmployee(serverClient: SupabaseClient, employeeCode: string) {
  const { data, error } = await serverClient
    .from("employees")
    .select("id, auth_user_id, status")
    .eq("employee_code", employeeCode)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; auth_user_id: string | null; status: "ACTIVE" | "INACTIVE" | "SUSPENDED" } | null;
}

async function signInEmployee(
  authClient: SupabaseClient,
  serverClient: SupabaseClient,
  body: EmployeeLoginBody,
) {
  const employee = await findEmployee(serverClient, body.employee_code);
  if (!employee) return failure("INVALID_CREDENTIALS");
  if (employee.status === "INACTIVE") return failure("EMPLOYEE_INACTIVE");
  if (employee.status === "SUSPENDED") return failure("EMPLOYEE_SUSPENDED");
  if (!employee.auth_user_id) return failure("ACCOUNT_NOT_PROVISIONED");

  const { data: authUser, error: authUserError } = await serverClient.auth.admin.getUserById(employee.auth_user_id);
  if (authUserError || !authUser.user?.email) return failure("ACCOUNT_NOT_PROVISIONED");

  const { data, error } = await authClient.auth.signInWithPassword({
    email: authUser.user.email,
    password: body.password,
  });
  if (error || !data.session) return failure("INVALID_CREDENTIALS");

  return response({ ok: true, session: data.session });
}

async function handleRequest(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") return failure("INVALID_REQUEST", 405);

  let body: EmployeeLoginBody;
  try {
    body = parseEmployeeLoginBody(JSON.parse(await request.text()));
  } catch {
    return failure("INVALID_REQUEST", 400);
  }

  const url = requiredEnv("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!anonKey) throw new Error("missing_environment_SUPABASE_ANON_KEY");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const authClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const serverClient = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  return signInEmployee(authClient, serverClient, body);
}

Deno.serve(async (request) => {
  try {
    return await handleRequest(request);
  } catch {
    // Never log credentials, Auth tokens, or employee records.
    console.error("employee-login failed");
    return failure("AUTHENTICATION_UNAVAILABLE", 500);
  }
});
