const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const EMPLOYEE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;
const OTP_PATTERN = /^[0-9]{6}$/;

export type RecoveryAction = "request-otp" | "resend-otp" | "verify-otp" | "reset-password" | "request-admin-reset";

export function parseRecoveryBody(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("invalid_request");
  const body = value as Record<string, unknown>;
  if (typeof body.action !== "string") throw new Error("invalid_request");
  if (!["request-otp", "resend-otp", "verify-otp", "reset-password", "request-admin-reset"].includes(body.action)) {
    throw new Error("invalid_request");
  }
  if (typeof body.employee_code !== "string") throw new Error("invalid_request");
  const employeeCode = body.employee_code.trim().toUpperCase();
  if (!EMPLOYEE_CODE_PATTERN.test(employeeCode)) throw new Error("invalid_request");

  const result: { action: RecoveryAction; employee_code: string; challenge_id?: string; otp?: string; new_password?: string; confirm_password?: string; reason?: string } = {
    action: body.action as RecoveryAction,
    employee_code: employeeCode,
  };
  if (body.challenge_id !== undefined) {
    if (typeof body.challenge_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.challenge_id)) throw new Error("invalid_request");
    result.challenge_id = body.challenge_id;
  }
  if (body.otp !== undefined) {
    if (typeof body.otp !== "string" || !OTP_PATTERN.test(body.otp)) throw new Error("invalid_request");
    result.otp = body.otp;
  }
  if (body.new_password !== undefined || body.confirm_password !== undefined) {
    if (typeof body.new_password !== "string" || typeof body.confirm_password !== "string") throw new Error("invalid_request");
    if (body.new_password !== body.confirm_password) throw new Error("passwords_do_not_match");
    validateNewPassword(body.new_password);
    result.new_password = body.new_password;
    result.confirm_password = body.confirm_password;
  }
  if (body.reason !== undefined) {
    if (typeof body.reason !== "string" || body.reason.length > 2000) throw new Error("invalid_request");
    result.reason = body.reason.trim();
  }
  return result;
}

export function maskEmail(email: string) {
  const atIndex = email.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === email.length - 1) return "hidden email";
  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  const maskedLocalPart = localPart.length === 1 ? "*" : `${localPart[0]}${"*".repeat(localPart.length - 1)}`;
  return `${maskedLocalPart}@${domain}`;
}

export function validateNewPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH || !password.trim()) throw new Error("password_invalid");
  if (password.trim().toLowerCase() === "rajmotor") throw new Error("password_invalid");
}
