import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertActiveDevice, assertEnrollmentState } from "./enrollment-rules.ts";
import { parseEnrollmentBody } from "./validation.ts";

const token = "A".repeat(43);
const validEmbedding = Array.from({ length: 512 }, (_, index) => index === 0 ? 1 : 0);
const validBody = () => ({
  session_token: token,
  embedding: validEmbedding,
  model_name: "w600k_mbf.onnx",
  model_version: "verified-model-v1",
  app_version: "0.1.0",
});

Deno.test("rejects invalid embedding dimensions", () => {
  assertThrows(() => parseEnrollmentBody({ ...validBody(), embedding: [1] }), Error, "invalid_embedding_dimension");
});

Deno.test("rejects non-finite embedding values", () => {
  const embedding = [...validEmbedding];
  embedding[12] = Number.NaN;
  assertThrows(() => parseEnrollmentBody({ ...validBody(), embedding }), Error, "invalid_embedding_value");
});

Deno.test("rejects expired sessions", () => {
  assertThrows(() => assertEnrollmentState({
    session: { id: "s", employee_id: "e", status: "PENDING", expires_at: "2020-01-01T00:00:00Z" },
    employeeIsActive: true,
    templateExists: false,
  }, new Date("2020-01-02T00:00:00Z")), Error, "enrollment_session_expired");
});

Deno.test("rejects reused sessions", () => {
  assertThrows(() => assertEnrollmentState({
    session: { id: "s", employee_id: "e", status: "USED", expires_at: "2099-01-01T00:00:00Z" },
    employeeIsActive: true,
    templateExists: false,
  }), Error, "enrollment_session_reused");
});

Deno.test("rejects inactive devices through the device gate state", () => {
  assertThrows(() => assertActiveDevice({ is_active: false }), Error, "device_not_active");
});

Deno.test("accepts the successful enrollment state", () => {
  const session = assertEnrollmentState({
    session: { id: "s", employee_id: "e", status: "PENDING", expires_at: "2099-01-01T00:00:00Z" },
    employeeIsActive: true,
    templateExists: false,
  });
  assertEquals(session.status, "PENDING");
});

Deno.test("rejects duplicate enrollment protection", () => {
  assertThrows(() => assertEnrollmentState({
    session: { id: "s", employee_id: "e", status: "PENDING", expires_at: "2099-01-01T00:00:00Z" },
    employeeIsActive: true,
    templateExists: true,
  }), Error, "employee_already_enrolled");
});
