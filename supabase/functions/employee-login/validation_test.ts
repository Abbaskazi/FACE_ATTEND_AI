import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseEmployeeLoginBody } from "./validation.ts";

Deno.test("parses an employee login without modifying the password", () => {
  assertEquals(parseEmployeeLoginBody({ employee_code: " EMP001 ", password: " RajMotor " }), {
    employee_code: "EMP001",
    password: " RajMotor ",
  });
});

Deno.test("rejects missing login fields", () => {
  assertThrows(() => parseEmployeeLoginBody({ employee_code: "EMP001" }), Error, "invalid_request");
  assertThrows(() => parseEmployeeLoginBody({ employee_code: "", password: "RajMotor" }), Error, "invalid_request");
});
