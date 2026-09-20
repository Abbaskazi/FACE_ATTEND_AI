export interface EnrollmentSubmitBody {
  session_token: string;
  embedding: number[];
  model_name: string;
  model_version: string;
  app_version: string;
}

export interface EnrollmentSubmitResponse {
  ok: boolean;
  completed_at?: string;
}

export interface EnrollmentDevice {
  id: string;
  auth_user_id: string;
  is_active: boolean;
}

export interface EnrollmentSessionState {
  id: string;
  employee_id: string;
  status: "PENDING" | "USED" | "EXPIRED" | "REVOKED";
  expires_at: string;
}
