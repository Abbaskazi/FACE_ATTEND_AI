export type AttendanceAction = "CHECK_IN" | "CHECK_OUT";

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
  outcome: "CHECK_IN_RECORDED" | "CHECK_OUT_RECORDED" | "NOT_RECORDED";
  request_id: string;
  server_time?: string;
  employee_name?: string;
  employee_code?: string;
}

export interface AttendanceRpcResult {
  outcome: AttendanceSubmitResponse["outcome"];
  request_id: string;
  server_time: string;
}

export interface AttendanceDevice {
  id: string;
  auth_user_id: string;
  is_active: boolean;
  timezone: string;
}

export interface AttendanceAttemptSummary {
  outcome: AttendanceSubmitResponse["outcome"];
  created_at: string;
  employee_id: string | null;
}

export interface AttendanceEmployeeSummary {
  full_name: string;
  employee_code: string;
}
