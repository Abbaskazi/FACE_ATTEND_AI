export interface EnrollmentSessionCreateBody {
  employee_id: string;
  expires_in_seconds?: number;
}

export interface EnrollmentSessionCreateResponse {
  ok: boolean;
  enrollment_token?: string;
  expires_at?: string;
}
