export type EmployeeAccountAdminBody = {
  action: "provision" | "deprovision" | "approve-password-request" | "reject-password-request";
  employee_id?: string;
  request_id?: string;
  rejection_reason?: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseEmployeeAccountAdminBody(value: unknown): EmployeeAccountAdminBody {
  if (!value || typeof value !== "object") throw new Error("invalid_request");
  const body = value as Record<string, unknown>;
  if (!["provision", "deprovision", "approve-password-request", "reject-password-request"].includes(String(body.action))) {
    throw new Error("invalid_request");
  }
  const action = body.action as EmployeeAccountAdminBody["action"];
  if ((action === "provision" || action === "deprovision") && (typeof body.employee_id !== "string" || !UUID_PATTERN.test(body.employee_id))) throw new Error("invalid_request");
  if ((action === "approve-password-request" || action === "reject-password-request") && (typeof body.request_id !== "string" || !UUID_PATTERN.test(body.request_id))) throw new Error("invalid_request");
  if (body.rejection_reason !== undefined && (typeof body.rejection_reason !== "string" || body.rejection_reason.length > 2000)) throw new Error("invalid_request");
  return { action, employee_id: body.employee_id, request_id: body.request_id, rejection_reason: body.rejection_reason };
}
