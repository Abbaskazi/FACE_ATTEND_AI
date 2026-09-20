import type { EnrollmentSessionState } from "./types.ts";

export interface EnrollmentStateCheck {
  session: EnrollmentSessionState | null;
  employeeIsActive: boolean;
  templateExists: boolean;
}

export function assertActiveDevice(device: { is_active: boolean } | null) {
  if (!device || !device.is_active) throw new Error("device_not_active");
  return device;
}

export function assertEnrollmentState(
  state: EnrollmentStateCheck,
  now = new Date(),
) {
  if (!state.session) throw new Error("enrollment_session_not_found");
  if (state.session.status !== "PENDING") throw new Error("enrollment_session_reused");
  if (new Date(state.session.expires_at).getTime() <= now.getTime()) {
    throw new Error("enrollment_session_expired");
  }
  if (!state.employeeIsActive) throw new Error("employee_not_active");
  if (state.templateExists) throw new Error("employee_already_enrolled");
  return state.session;
}
