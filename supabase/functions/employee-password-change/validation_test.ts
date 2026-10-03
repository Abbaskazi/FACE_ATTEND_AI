import { assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parsePasswordChangeBody } from "./validation.ts";

Deno.test("accepts a valid new password", () => {
  parsePasswordChangeBody({
    current_password: "RajMotor",
    new_password: "NewSecurePassword123",
    confirm_password: "NewSecurePassword123",
  });
});

Deno.test("rejects short, blank, temporary, and mismatched passwords", () => {
  assertThrows(() => parsePasswordChangeBody({ current_password: "RajMotor", new_password: "short", confirm_password: "short" }), Error, "password_too_short");
  assertThrows(() => parsePasswordChangeBody({ current_password: "RajMotor", new_password: "        ", confirm_password: "        " }), Error, "password_blank");
  assertThrows(() => parsePasswordChangeBody({ current_password: "RajMotor", new_password: "RajMotor", confirm_password: "RajMotor" }), Error, "temporary_password_not_allowed");
  assertThrows(() => parsePasswordChangeBody({ current_password: "RajMotor", new_password: "NewSecurePassword123", confirm_password: "DifferentPassword123" }), Error, "passwords_do_not_match");
});
