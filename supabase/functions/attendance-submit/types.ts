export type AttendanceAction = "CHECK_IN" | "CHECK_OUT";
export type AttendanceOutcome =
  | "CHECK_IN_RECORDED"
  | "ALREADY_CHECKED_IN"
  | "CHECK_OUT_RECORDED"
  | "NOT_CHECKED_IN"
  | "RECOGNITION_FAILED"
  | "AMBIGUOUS_MATCH"
  | "NOT_RECORDED"
  | "UNAUTHORIZED_DEVICE"
  | "RATE_LIMITED"
  | "VALIDATION_ERROR"
  | "SERVER_ERROR";

export interface AttendanceSubmitBody {
  request_id: string;
  action: AttendanceAction;
  embedding: number[];
  model_name: string;
  model_version: string;
  app_version: string;
  challenge_id?: string | null;
}

export interface AttendanceSubmitResponse {
  ok: boolean;
  outcome: AttendanceOutcome;
  request_id: string;
  server_time?: string;
  employee_name?: string;
  employee_code?: string;
  check_in_time?: string;
  check_out_time?: string;
  session_working_minutes?: number;
  today_total_working_minutes?: number;
  error_code?: string;
  message?: string;
  diagnostic?: AttendanceDiagnosticSummary;
}

export interface AttendanceDiagnosticSummary {
  candidate_count: number | null;
  top_employee_code: string | null;
  top_score: number | null;
  second_employee_code: string | null;
  second_score: number | null;
  score_margin: number | null;
  threshold: number | null;
  ambiguity_margin: number | null;
}

export interface AttendanceRpcResult {
  outcome: AttendanceOutcome;
  request_id: string;
  server_time: string;
  employee_id: string | null;
  attendance_id: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  session_working_minutes: number | null;
  today_total_working_minutes: number | null;
  candidate_count?: number | null;
  top_employee_code?: string | null;
  top_score?: number | null;
  second_employee_code?: string | null;
  second_score?: number | null;
  score_margin?: number | null;
  threshold?: number | null;
  ambiguity_margin?: number | null;
}

export interface AttendanceDevice {
  id: string;
  auth_user_id: string;
  is_active: boolean;
  timezone: string;
}

export interface AttendanceAttemptSummary {
  outcome: AttendanceOutcome;
  created_at: string;
  employee_id: string | null;
  attendance_id: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  session_working_minutes: number | null;
  today_total_working_minutes: number | null;
}

export interface AttendanceEmployeeSummary {
  full_name: string;
  employee_code: string;
}
