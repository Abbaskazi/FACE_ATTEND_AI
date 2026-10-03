export type EmployeeStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED";
export type AttendanceStatus = "PRESENT" | "ABSENT" | "HALF_DAY" | "LEAVE";
export type EnrollmentStatus = "PENDING" | "USED" | "EXPIRED" | "REVOKED";
export type LeaveRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export type PasswordChangeRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED";

export interface Department {
  id: string;
  name: string;
  code: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DepartmentSummary extends Department {
  employee_count: number;
}

export interface EmployeeDepartment {
  id: string;
  name: string;
  code: string;
}

export interface Employee {
  id: string;
  employee_code: string;
  auth_user_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  department_id: string | null;
  designation: string | null;
  joining_date: string | null;
  salary: number;
  status: EmployeeStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  departments: EmployeeDepartment | null;
}

export interface EmployeePortalProfile {
  id: string;
  employee_code: string;
  full_name: string;
  department_id: string | null;
  department: EmployeeDepartment | null;
  designation: string | null;
  joining_date: string | null;
  salary: number;
  status: EmployeeStatus;
  must_change_password: boolean;
}

export interface EnrollmentSession {
  employee_id: string;
  status: EnrollmentStatus;
  expires_at: string;
  created_at: string;
}

export interface AttendanceEmployee {
  id: string;
  employee_code: string;
  full_name: string;
  department_id: string | null;
  departments: EmployeeDepartment | null;
}

export interface AttendanceRecord {
  id: string;
  employee_id: string;
  attendance_date: string;
  check_in: string | null;
  check_out: string | null;
  status: AttendanceStatus;
  working_minutes: number | null;
  created_at: string;
  employees: AttendanceEmployee | null;
}

export interface LeaveRequestEmployee {
  id: string;
  employee_code: string;
  full_name: string;
  designation: string | null;
  department_id: string | null;
  departments: EmployeeDepartment | null;
}

export interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type: "PAID";
  start_date: string;
  end_date: string;
  reason: string;
  status: LeaveRequestStatus;
  requested_working_days: number;
  rejection_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  employees: LeaveRequestEmployee | null;
}

export interface PasswordChangeRequestEmployee {
  id: string;
  employee_code: string;
  full_name: string;
  department_id: string | null;
  departments: EmployeeDepartment | null;
}

export interface PasswordChangeRequest {
  id: string;
  employee_id: string;
  status: PasswordChangeRequestStatus;
  reason: string | null;
  created_at: string;
  updated_at: string;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  completed_at: string | null;
  employees: PasswordChangeRequestEmployee | null;
}

export interface AdminProfile {
  id: string;
  full_name: string;
  is_active: boolean;
}

export interface Holiday {
  id: string;
  holiday_date: string;
  reason: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface DashboardData {
  totalEmployees: number;
  activeEmployees: number;
  presentToday: number;
  activeDepartments: number;
  attendanceRate: number;
  recentAttendance: AttendanceRecord[];
}
