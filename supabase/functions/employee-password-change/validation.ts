const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

export type PasswordChangeBody = {
  current_password: string;
  new_password: string;
  confirm_password: string;
};

export function validateNewPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error("password_too_short");
  if (password.length > MAX_PASSWORD_LENGTH) throw new Error("password_too_long");
  if (!password.trim()) throw new Error("password_blank");
  if (password.trim().toLowerCase() === "rajmotor") throw new Error("temporary_password_not_allowed");
}

export function parsePasswordChangeBody(value: unknown): PasswordChangeBody {
  if (!value || typeof value !== "object") throw new Error("invalid_request");
  const body = value as Record<string, unknown>;
  if (typeof body.current_password !== "string" || typeof body.new_password !== "string" || typeof body.confirm_password !== "string") {
    throw new Error("invalid_request");
  }
  if (!body.current_password.trim()) throw new Error("current_password_required");
  if (body.new_password !== body.confirm_password) throw new Error("passwords_do_not_match");
  validateNewPassword(body.new_password);
  return {
    current_password: body.current_password,
    new_password: body.new_password,
    confirm_password: body.confirm_password,
  };
}
