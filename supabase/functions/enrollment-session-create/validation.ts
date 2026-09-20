import type { EnrollmentSessionCreateBody } from "./types.ts";

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function parseBody(value: unknown): EnrollmentSessionCreateBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_json_body");
  const body = value as Record<string, unknown>;
  const allowed = new Set(["employee_id", "expires_in_seconds"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new Error("unexpected_field");
  if (!isUuid(body.employee_id)) throw new Error("invalid_employee_id");
  if (body.expires_in_seconds !== undefined &&
    (!Number.isInteger(body.expires_in_seconds) || body.expires_in_seconds < 60 || body.expires_in_seconds > 900)) {
    throw new Error("invalid_expiry");
  }
  return {
    employee_id: body.employee_id,
    expires_in_seconds: body.expires_in_seconds as number | undefined,
  };
}

export function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
