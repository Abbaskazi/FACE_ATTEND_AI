import type { EnrollmentSubmitBody } from "./types.ts";

export const MAX_BODY_BYTES = 100 * 1024;
export const EMBEDDING_DIMENSION = 512;
export const NORMALIZED_NORM_TOLERANCE = 0.01;

const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isSafeVersion(value: unknown): value is string {
  return typeof value === "string" && VERSION_PATTERN.test(value);
}

export function parseEnrollmentBody(value: unknown): EnrollmentSubmitBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_json_body");
  }

  const body = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "session_token",
    "embedding",
    "model_name",
    "model_version",
    "app_version",
  ]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new Error("unexpected_field");
  }
  if (typeof body.session_token !== "string" || !SESSION_TOKEN_PATTERN.test(body.session_token)) {
    throw new Error("invalid_session_token");
  }
  if (!isSafeVersion(body.model_name)) throw new Error("invalid_model_name");
  if (!isSafeVersion(body.model_version)) throw new Error("invalid_model_version");
  if (!isSafeVersion(body.app_version)) throw new Error("invalid_app_version");
  if (!Array.isArray(body.embedding) || body.embedding.length !== EMBEDDING_DIMENSION) {
    throw new Error("invalid_embedding_dimension");
  }

  const embedding = body.embedding.map((value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("invalid_embedding_value");
    }
    return value;
  });
  const norm = Math.sqrt(embedding.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm <= Number.EPSILON) throw new Error("zero_embedding");
  if (Math.abs(norm - 1) > NORMALIZED_NORM_TOLERANCE) {
    throw new Error("embedding_not_normalized");
  }

  return {
    session_token: body.session_token,
    embedding,
    model_name: body.model_name,
    model_version: body.model_version,
    app_version: body.app_version,
  };
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function toPgVectorLiteral(embedding: number[]) {
  return `[${embedding.map((value) => value.toString()).join(",")}]`;
}
