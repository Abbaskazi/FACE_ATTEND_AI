import { assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseEmployeeAccountAdminBody } from "./validation.ts";

Deno.test("accepts only a valid account action and employee UUID", () => {
  parseEmployeeAccountAdminBody({ action: "provision", employee_id: "00000000-0000-4000-8000-000000000001" });
  parseEmployeeAccountAdminBody({ action: "deprovision", employee_id: "00000000-0000-4000-8000-000000000001" });
  parseEmployeeAccountAdminBody({ action: "approve-password-request", request_id: "00000000-0000-4000-8000-000000000001" });
  parseEmployeeAccountAdminBody({ action: "reject-password-request", request_id: "00000000-0000-4000-8000-000000000001", rejection_reason: "Not verified" });
});

Deno.test("rejects malformed account administration requests", () => {
  assertThrows(() => parseEmployeeAccountAdminBody({ action: "provision", employee_id: "EMP001" }), Error, "invalid_request");
});
