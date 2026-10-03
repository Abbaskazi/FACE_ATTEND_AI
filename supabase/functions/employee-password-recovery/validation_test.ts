import { assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { maskEmail, parseRecoveryBody } from "./validation.ts";

Deno.test("accepts recovery request and OTP payloads", () => {
  parseRecoveryBody({ action: "request-otp", employee_code: "EMP001" });
  parseRecoveryBody({ action: "verify-otp", employee_code: "EMP001", challenge_id: "00000000-0000-4000-8000-000000000001", otp: "123456" });
});

Deno.test("accepts a one-character employee code", () => {
  const parsed = parseRecoveryBody({ action: "request-otp", employee_code: "1" });
  if (parsed.employee_code !== "1") throw new Error("one-character employee code was not accepted");
});

Deno.test("accepts resend OTP payloads", () => {
  parseRecoveryBody({ action: "resend-otp", employee_code: "1", challenge_id: "00000000-0000-4000-8000-000000000001" });
});

Deno.test("masks email local parts without exposing the full address", () => {
  if (maskEmail("abbas@gmail.com") !== "a****@gmail.com") throw new Error("email was not masked");
  if (maskEmail("mohammed.abbas@gmail.com") !== "m*************@gmail.com") throw new Error("long email was not masked");
  if (maskEmail("ab@gmail.com") !== "a*@gmail.com") throw new Error("short email was not masked");
});

Deno.test("rejects malformed recovery payloads", () => {
  assertThrows(() => parseRecoveryBody({ action: "verify-otp", employee_code: "EMP001", otp: "1234" }), Error, "invalid_request");
  assertThrows(() => parseRecoveryBody({ action: "request-otp", employee_code: "" }), Error, "invalid_request");
});
