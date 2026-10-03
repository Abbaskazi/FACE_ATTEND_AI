import { supabase } from "./supabase";
import type {
  AdminProfile,
  AttendanceRecord,
  AttendanceStatus,
  Department,
  DepartmentSummary,
  DashboardData,
  Employee,
  EmployeeStatus,
  EnrollmentSession,
  LeaveRequest,
  PasswordChangeRequest,
} from "../types/database";

const employeeSelect =
  "id, auth_user_id, employee_code, full_name, email, phone, department_id, designation, joining_date, salary, status, created_by, created_at, updated_at, departments(id, name, code)";
const attendanceSelect =
  "id, employee_id, attendance_date, check_in, check_out, status, working_minutes, created_at, employees(id, employee_code, full_name, department_id, departments(id, name, code))";
const leaveRequestSelect =
  "id, employee_id, leave_type, start_date, end_date, reason, status, requested_working_days, rejection_reason, approved_by, approved_at, rejected_by, rejected_at, cancelled_at, created_at, updated_at, employees(id, employee_code, full_name, designation, department_id, departments(id, name, code))";
const passwordChangeRequestSelect =
  "id, employee_id, status, reason, created_at, updated_at, approved_by, approved_at, rejected_by, rejected_at, rejection_reason, completed_at, employees(id, employee_code, full_name, department_id, departments(id, name, code))";

export const getToday = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

export const getDateDaysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

const throwIfError = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

function employeeProfileUpdateError(error: { message: string; code?: string } | null): never | void {
  if (!error) return;
  if (error.code === "23505" || error.message.toLowerCase().includes("duplicate key")) {
    throw new Error("Employee code is already in use.");
  }
  const messages: Record<string, string> = {
    employee_id_required: "Employee was not specified.",
    employee_not_found: "Employee could not be found.",
    employee_code_required: "Employee code is required.",
    employee_code_invalid: "Please enter a valid employee code.",
    employee_code_already_in_use: "Employee code is already in use.",
    full_name_required: "Full name is required.",
    full_name_invalid: "Please enter a valid full name.",
    employee_email_required: "Email is required.",
    employee_email_invalid: "Please enter a valid email address.",
    employee_phone_required: "Phone number is required.",
    employee_phone_invalid: "Please enter a valid Indian phone number.",
    employee_salary_invalid: "Salary cannot be negative and must use up to two decimal places.",
    employee_designation_invalid: "Please enter a valid designation.",
    department_invalid: "Please select a valid department.",
    employee_status_invalid: "Please select a valid employee status.",
    admin_authorization_required: "Active administrator access is required.",
  };
  const detail = Object.keys(messages).find((key) => error.message.includes(key));
  throw new Error(detail ? messages[detail] : "Employee details could not be updated.");
}

export async function getAdminProfile(userId: string) {
  const { data, error } = await supabase
    .from("admin_profiles")
    .select("id, full_name, is_active")
    .eq("id", userId)
    .maybeSingle();

  throwIfError(error);
  return data as AdminProfile | null;
}

export async function getDepartments() {
  const { data, error } = await supabase
    .from("departments")
    .select("id, name, code, description, is_active, created_at, updated_at")
    .order("name");

  throwIfError(error);
  return (data ?? []) as Department[];
}

export async function getDepartmentSummaries() {
  const [departments, employees] = await Promise.all([
    getDepartments(),
    supabase.from("employees").select("department_id"),
  ]);

  throwIfError(employees.error);
  const counts = new Map<string, number>();
  for (const employee of (employees.data ?? []) as Array<{ department_id: string | null }>) {
    if (employee.department_id) {
      counts.set(employee.department_id, (counts.get(employee.department_id) ?? 0) + 1);
    }
  }

  return departments.map((department) => ({
    ...department,
    employee_count: counts.get(department.id) ?? 0,
  })) as DepartmentSummary[];
}

export async function getEmployees() {
  const { data, error } = await supabase
    .from("employees")
    .select(employeeSelect)
    .order("full_name");

  throwIfError(error);
  return (data ?? []) as unknown as Employee[];
}

export async function getEmployee(employeeId: string) {
  const { data, error } = await supabase
    .from("employees")
    .select(employeeSelect)
    .eq("id", employeeId)
    .maybeSingle();

  throwIfError(error);
  return data as unknown as Employee | null;
}

export async function getEnrollmentSessions() {
  const { data, error } = await supabase
    .from("enrollment_sessions")
    .select("employee_id, status, expires_at, created_at")
    .order("created_at", { ascending: false });

  throwIfError(error);
  return (data ?? []) as EnrollmentSession[];
}

export async function getAttendance(options: {
  from?: string;
  to?: string;
  limit?: number;
} = {}) {
  let query = supabase
    .from("attendance")
    .select(attendanceSelect)
    .order("attendance_date", { ascending: false })
    .order("check_in", { ascending: false });

  if (options.from) query = query.gte("attendance_date", options.from);
  if (options.to) query = query.lte("attendance_date", options.to);
  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  throwIfError(error);
  return (data ?? []) as unknown as AttendanceRecord[];
}

export async function getEmployeeAttendance(employeeId: string, options: { from: string; to: string }) {
  const { data, error } = await supabase
    .from("attendance")
    .select("id, employee_id, attendance_date, check_in, check_out, status, working_minutes, created_at")
    .eq("employee_id", employeeId)
    .gte("attendance_date", options.from)
    .lte("attendance_date", options.to)
    .order("attendance_date", { ascending: true })
    .order("check_in", { ascending: true });

  throwIfError(error);
  return (data ?? []) as AttendanceRecord[];
}

export async function getEmployeeAttendanceHistory(employeeId: string) {
  const { data, error } = await supabase
    .from("attendance")
    .select("id, employee_id, attendance_date, check_in, check_out, status, working_minutes, created_at")
    .eq("employee_id", employeeId)
    .order("attendance_date", { ascending: false })
    .order("check_in", { ascending: false });

  throwIfError(error);
  return (data ?? []) as AttendanceRecord[];
}

export async function getEmployeeLeaveRequests() {
  const { data, error } = await supabase
    .from("employee_leave_requests")
    .select(leaveRequestSelect)
    .order("created_at", { ascending: false });

  throwIfError(error);
  return (data ?? []) as unknown as LeaveRequest[];
}

export async function getAdminLeaveRequests() {
  const { data, error } = await supabase
    .from("employee_leave_requests")
    .select(leaveRequestSelect)
    .order("created_at", { ascending: false });

  throwIfError(error);
  return (data ?? []) as unknown as LeaveRequest[];
}

export async function getAdminEmployeeLeaveRequests(employeeId: string) {
  const { data, error } = await supabase
    .from("employee_leave_requests")
    .select(leaveRequestSelect)
    .eq("employee_id", employeeId)
    .order("start_date", { ascending: false })
    .order("created_at", { ascending: false });

  throwIfError(error);
  return (data ?? []) as unknown as LeaveRequest[];
}

export async function requestEmployeePaidLeave(input: {
  startDate: string;
  endDate: string;
  reason: string;
}) {
  const { data, error } = await supabase.rpc("request_employee_paid_leave", {
    p_start_date: input.startDate,
    p_end_date: input.endDate,
    p_reason: input.reason,
  });

  throwIfError(error);
  if (typeof data !== "string") throw new Error("Leave request could not be created.");
  return data;
}

export async function cancelEmployeeLeaveRequest(requestId: string) {
  const { data, error } = await supabase.rpc("cancel_employee_leave_request", {
    p_request_id: requestId,
  });

  throwIfError(error);
  if (data !== true) throw new Error("Pending leave request could not be cancelled.");
}

export async function approveEmployeeLeaveRequest(requestId: string) {
  const { data, error } = await supabase.rpc("approve_employee_leave_request", {
    p_request_id: requestId,
  });

  throwIfError(error);
  if (typeof data !== "string") throw new Error("Leave request could not be approved.");
  return data;
}

export async function rejectEmployeeLeaveRequest(requestId: string, rejectionReason: string) {
  const { data, error } = await supabase.rpc("reject_employee_leave_request", {
    p_request_id: requestId,
    p_rejection_reason: rejectionReason.trim() || null,
  });

  throwIfError(error);
  if (typeof data !== "string") throw new Error("Leave request could not be rejected.");
  return data;
}

export async function deleteAttendanceSession(attendanceId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attendanceId)) {
    throw new Error("Invalid attendance session.");
  }

  const { error } = await supabase
    .from("attendance")
    .delete()
    .eq("id", attendanceId);

  throwIfError(error);
}

export async function getDashboardData(): Promise<DashboardData> {
  const today = getToday();
  const [employeesResult, departmentsResult, todayResult, recentAttendance] =
    await Promise.all([
      supabase.from("employees").select("status"),
      supabase.from("departments").select("is_active"),
      supabase.from("attendance").select("employee_id, status").eq("attendance_date", today),
      getAttendance({ from: getDateDaysAgo(6), to: today, limit: 6 }),
    ]);

  throwIfError(employeesResult.error);
  throwIfError(departmentsResult.error);
  throwIfError(todayResult.error);

  const employees = (employeesResult.data ?? []) as Array<{ status: EmployeeStatus }>;
  const departments = (departmentsResult.data ?? []) as Array<{ is_active: boolean }>;
  const todayAttendance = (todayResult.data ?? []) as Array<{ employee_id: string; status: AttendanceStatus }>;
  const activeEmployees = employees.filter((employee) => employee.status === "ACTIVE").length;
  const presentToday = new Set(
    todayAttendance
      .filter((record) => record.status === "PRESENT")
      .map((record) => record.employee_id),
  ).size;

  return {
    totalEmployees: employees.length,
    activeEmployees,
    presentToday,
    activeDepartments: departments.filter((department) => department.is_active).length,
    attendanceRate: activeEmployees ? Math.round((presentToday / activeEmployees) * 100) : 0,
    recentAttendance,
  };
}

export async function createEmployee(input: {
  employee_code: string;
  full_name: string;
  email: string;
  phone: string;
  department_id: string | null;
  designation: string | null;
  joining_date: string | null;
  created_by: string;
}) {
  const { data, error } = await supabase
    .from("employees")
    .insert({ ...input, salary: 0 })
    .select(employeeSelect)
    .single();

  throwIfError(error);
  const employee = data as unknown as Employee;
  try {
    await provisionEmployeeAccount(employee.id);
  } catch {
    throw new Error("Employee was created, but the login account could not be provisioned. Use Provision login from the employee directory.");
  }
  return employee;
}

export async function updateEmployeeContact(employeeId: string, input: { email: string | null; phone: string | null }) {
  const employee = await getEmployee(employeeId);
  if (!employee) throw new Error("Employee could not be found.");
  return updateEmployeeProfile({
    ...employee,
    email: input.email ?? "",
    phone: input.phone ?? "",
  });
}

export async function updateEmployeeProfile(input: {
  id: string;
  employee_code: string;
  full_name: string;
  email: string;
  phone: string;
  department_id: string | null;
  designation: string | null;
  joining_date: string | null;
  salary: number;
  status: EmployeeStatus;
}) {
  const { data, error } = await supabase.rpc("admin_update_employee_profile", {
    p_employee_id: input.id,
    p_employee_code: input.employee_code,
    p_full_name: input.full_name,
    p_email: input.email,
    p_phone: input.phone,
    p_department_id: input.department_id,
    p_designation: input.designation,
    p_joining_date: input.joining_date,
    p_salary: input.salary,
    p_status: input.status,
  });
  employeeProfileUpdateError(error);
  if (typeof data !== "string") throw new Error("Employee details could not be updated.");
  const updated = await getEmployee(input.id);
  if (!updated) throw new Error("Employee details could not be reloaded.");
  return updated;
}

export async function provisionEmployeeAccount(employeeId: string) {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; error_code?: string }>("employee-account-admin", {
    body: { action: "provision", employee_id: employeeId },
  });
  throwIfError(error);
  if (!data?.ok) throw new Error(data?.error_code === "ACCOUNT_ALREADY_EXISTS" ? "A conflicting Auth account already exists; no duplicate was created." : "Employee login could not be provisioned.");
}

export async function deprovisionEmployeeAccount(employeeId: string) {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; error_code?: string }>("employee-account-admin", {
    body: { action: "deprovision", employee_id: employeeId },
  });
  throwIfError(error);
  if (!data?.ok) throw new Error("Employee login could not be safely deprovisioned.");
}

export async function getAdminPasswordChangeRequests() {
  const { data, error } = await supabase
    .from("employee_password_change_requests")
    .select(passwordChangeRequestSelect)
    .order("created_at", { ascending: false });
  throwIfError(error);
  return (data ?? []) as unknown as PasswordChangeRequest[];
}

export async function approvePasswordChangeRequest(requestId: string) {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; error_code?: string }>("employee-account-admin", {
    body: { action: "approve-password-request", request_id: requestId },
  });
  throwIfError(error);
  if (!data?.ok) throw new Error(data?.error_code === "PASSWORD_REQUEST_NOT_FOUND" ? "This request is no longer pending." : "Password reset could not be completed.");
}

export async function rejectPasswordChangeRequest(requestId: string, rejectionReason: string) {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; error_code?: string }>("employee-account-admin", {
    body: { action: "reject-password-request", request_id: requestId, rejection_reason: rejectionReason.trim() || undefined },
  });
  throwIfError(error);
  if (!data?.ok) throw new Error(data?.error_code === "PASSWORD_REQUEST_NOT_FOUND" ? "This request is no longer pending." : "Password request could not be rejected.");
}

export async function updateEmployeeSalary(employeeId: string, salary: number) {
  if (!Number.isFinite(salary) || salary < 0 || salary > 9_999_999_999.99) {
    throw new Error("Salary must be a valid non-negative amount.");
  }

  const employee = await getEmployee(employeeId);
  if (!employee) throw new Error("Employee could not be found.");
  return updateEmployeeProfile({
    id: employee.id,
    employee_code: employee.employee_code,
    full_name: employee.full_name,
    email: employee.email ?? "",
    phone: employee.phone ?? "",
    department_id: employee.department_id,
    designation: employee.designation,
    joining_date: employee.joining_date,
    salary,
    status: employee.status,
  });
}

export async function deleteEmployee(employeeId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(employeeId)) {
    throw new Error("Invalid employee.");
  }

  await deprovisionEmployeeAccount(employeeId);

  const { data, error } = await supabase.rpc("delete_employee", {
    p_employee_id: employeeId,
  });

  if (error) {
    if (import.meta.env.DEV) {
      console.error("[delete_employee] RPC failed", {
        code: error.code,
        message: error.message,
      });
    }
    if (error.code === "42501") throw new Error("Active administrator access is required.");
    if (error.code === "P0002") throw new Error("Employee no longer exists.");
    throw new Error("Employee could not be deleted. No changes were made.");
  }

  if (!data || data.deleted !== true) {
    throw new Error("Employee could not be deleted. No changes were made.");
  }

  return data as { deleted: true; employee_id: string };
}

export async function createEnrollmentSession(employeeId: string) {
  const { data, error } = await supabase.functions.invoke("enrollment-session-create", {
    body: { employee_id: employeeId },
  });
  throwIfError(error);
  if (!data?.ok || typeof data.enrollment_token !== "string" || typeof data.expires_at !== "string") {
    throw new Error("Enrollment session could not be created.");
  }
  return data as { ok: true; enrollment_token: string; expires_at: string };
}

export function latestEnrollmentByEmployee(sessions: EnrollmentSession[]) {
  const latest = new Map<string, EnrollmentSession>();
  for (const session of sessions) {
    if (!latest.has(session.employee_id)) latest.set(session.employee_id, session);
  }
  return latest;
}

export function getEnrollmentLabel(
  session: EnrollmentSession | undefined,
): { label: string; tone: "success" | "warning" | "muted" | "danger" } {
  if (!session) return { label: "Not enrolled", tone: "muted" };
  if (session.status === "PENDING" && new Date(session.expires_at) < new Date()) {
    return { label: "Expired", tone: "danger" };
  }
  switch (session.status) {
    case "USED":
      return { label: "Enrolled", tone: "success" };
    case "PENDING":
      return { label: "Pending", tone: "warning" };
    case "EXPIRED":
      return { label: "Expired", tone: "danger" };
    case "REVOKED":
      return { label: "Revoked", tone: "muted" };
  }
}

export function normalizeAttendanceStatus(status: string): AttendanceStatus {
  if (status === "ABSENT" || status === "HALF_DAY" || status === "LEAVE") return status;
  return "PRESENT";
}
