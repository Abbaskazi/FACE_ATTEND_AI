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
  error_code?: EnrollmentValidationErrorCode;
}

export type EnrollmentValidationErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_SESSION_TOKEN"
  | "INVALID_EMBEDDING"
  | "INVALID_EMBEDDING_LENGTH"
  | "INVALID_MODEL"
  | "INVALID_MODEL_VERSION"
  | "INVALID_APP_VERSION"
  | "INVALID_NORMALIZATION";

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
