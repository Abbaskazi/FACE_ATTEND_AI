const MAX_EMPLOYEE_CODE_LENGTH = 100;
const MAX_PASSWORD_LENGTH = 256;

export type EmployeeLoginBody = {
  employee_code: string;
  password: string;
};

export function parseEmployeeLoginBody(value: unknown): EmployeeLoginBody {
  if (!value || typeof value !== "object") throw new Error("invalid_request");
  const body = value as Record<string, unknown>;
  if (typeof body.employee_code !== "string" || typeof body.password !== "string") {
    throw new Error("invalid_request");
  }

  const employeeCode = body.employee_code.trim();
  if (!employeeCode || employeeCode.length > MAX_EMPLOYEE_CODE_LENGTH) {
    throw new Error("invalid_request");
  }
  if (!body.password || body.password.length > MAX_PASSWORD_LENGTH) {
    throw new Error("invalid_request");
  }

  return { employee_code: employeeCode, password: body.password };
}
