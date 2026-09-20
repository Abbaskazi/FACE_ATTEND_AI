import { assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseBody } from "./validation.ts";

Deno.test("rejects an arbitrary employee identifier shape", () => {
  assertThrows(() => parseBody({ employee_id: "not-a-uuid" }), Error, "invalid_employee_id");
});

Deno.test("rejects unsafe session lifetimes", () => {
  assertThrows(() => parseBody({ employee_id: "00000000-0000-4000-8000-000000000001", expires_in_seconds: 1 }), Error, "invalid_expiry");
});
