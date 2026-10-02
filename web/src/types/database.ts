export type EmployeeStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED";
export type AttendanceStatus = "PRESENT" | "ABSENT" | "HALF_DAY" | "LEAVE";
export type EnrollmentStatus = "PENDING" | "USED" | "EXPIRED" | "REVOKED";

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

export interface AdminProfile {
  id: string;
  full_name: string;
  is_active: boolean;
}

export interface DashboardData {
  totalEmployees: number;
  activeEmployees: number;
  presentToday: number;
  activeDepartments: number;
  attendanceRate: number;
  recentAttendance: AttendanceRecord[];
}
