import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseAttendanceBody } from "./validation.ts";

const requestId = "11111111-1111-4111-8111-111111111111";
const validEmbedding = Array.from({ length: 512 }, (_, index) => index === 0 ? 1 : 0);
const validBody = (action: "CHECK_IN" | "CHECK_OUT") => ({
  request_id: requestId,
  action,
  embedding: validEmbedding,
  model_name: "glintr100.onnx",
  model_version: "4ab1d6435d639628a6f3e5008dd4f929edf4c4124b1a7169e1048f9fef534cdf",
  app_version: "0.1.0",
});

Deno.test("accepts both check-in and check-out actions", () => {
  assertEquals(parseAttendanceBody(validBody("CHECK_IN")).action, "CHECK_IN");
  assertEquals(parseAttendanceBody(validBody("CHECK_OUT")).action, "CHECK_OUT");
});

Deno.test("rejects device-controlled timestamps and working duration", () => {
  assertThrows(
    () => parseAttendanceBody({ ...validBody("CHECK_OUT"), check_in_time: "2099-01-01T00:00:00Z" }),
    Error,
    "unexpected_field",
  );
  assertThrows(
    () => parseAttendanceBody({ ...validBody("CHECK_OUT"), working_minutes: 999999 }),
    Error,
    "unexpected_field",
  );
});

Deno.test("rejects unsupported attendance actions", () => {
  assertThrows(
    () => parseAttendanceBody({ ...validBody("CHECK_IN"), action: "TOGGLE" }),
    Error,
    "invalid_action",
  );
});

Deno.test("rejects non-normalized embeddings", () => {
  const embedding = Array.from({ length: 512 }, (_, index) => index === 0 ? 0.5 : 0);
  assertThrows(
    () => parseAttendanceBody({ ...validBody("CHECK_IN"), embedding }),
    Error,
    "embedding_not_normalized",
  );
});
