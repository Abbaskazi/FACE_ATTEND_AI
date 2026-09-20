import type { AttendanceAction, AttendanceSubmitBody } from "./types.ts";

export const MAX_BODY_BYTES = 100 * 1024;
export const EMBEDDING_DIMENSION = 512;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isSafeVersion(value: unknown): value is string {
  return typeof value === "string" && VERSION_PATTERN.test(value);
}

export function isAction(value: unknown): value is AttendanceAction {
  return value === "CHECK_IN" || value === "CHECK_OUT";
}

export function parseAttendanceBody(value: unknown): AttendanceSubmitBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_json_body");
  }

  const body = value as Record<string, unknown>;
  if (!isUuid(body.request_id)) throw new Error("invalid_request_id");
  if (!isAction(body.action)) throw new Error("invalid_action");
  if (!isSafeVersion(body.model_name)) throw new Error("invalid_model_name");
  if (!isSafeVersion(body.model_version)) throw new Error("invalid_model_version");
  if (!isSafeVersion(body.app_version)) throw new Error("invalid_app_version");

  if (body.challenge_id !== undefined && body.challenge_id !== null && !isUuid(body.challenge_id)) {
    throw new Error("invalid_challenge_id");
  }

  if (!Array.isArray(body.embedding) || body.embedding.length !== EMBEDDING_DIMENSION) {
    throw new Error("invalid_embedding_dimension");
  }

  const embedding = body.embedding.map((value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("invalid_embedding_value");
    }
    return value;
  });

  const squaredMagnitude = embedding.reduce((sum, value) => sum + value * value, 0);
  if (!Number.isFinite(squaredMagnitude) || squaredMagnitude <= Number.EPSILON) {
    throw new Error("zero_embedding");
  }

  return {
    request_id: body.request_id,
    action: body.action,
    embedding,
    model_name: body.model_name,
    model_version: body.model_version,
    app_version: body.app_version,
    challenge_id: body.challenge_id === null ? null : body.challenge_id,
  };
}

export function toPgVectorLiteral(embedding: number[]) {
  // Values are finite and dimension-checked before this function runs.
  // The resulting string is sent as an RPC parameter, never interpolated
  // into SQL text.
  return `[${embedding.map((value) => value.toString()).join(",")}]`;
}
