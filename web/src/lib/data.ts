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
} from "../types/database";

const employeeSelect =
  "id, employee_code, full_name, email, phone, department_id, designation, joining_date, salary, status, created_by, created_at, updated_at, departments(id, name, code)";
const attendanceSelect =
  "id, employee_id, attendance_date, check_in, check_out, status, working_minutes, created_at, employees(id, employee_code, full_name, department_id, departments(id, name, code))";

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
  email: string | null;
  phone: string | null;
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
  return data as unknown as Employee;
}

export async function updateEmployeeSalary(employeeId: string, salary: number) {
  if (!Number.isFinite(salary) || salary < 0 || salary > 9_999_999_999.99) {
    throw new Error("Salary must be a valid non-negative amount.");
  }

  const { data, error } = await supabase
    .from("employees")
    .update({ salary })
    .eq("id", employeeId)
    .select(employeeSelect)
    .single();

  throwIfError(error);
  return data as unknown as Employee;
}

export async function deleteEmployee(employeeId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(employeeId)) {
    throw new Error("Invalid employee.");
  }

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
