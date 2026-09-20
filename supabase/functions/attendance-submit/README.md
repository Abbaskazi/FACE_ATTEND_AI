# attendance-submit

Android-facing attendance API for the Phase 1 secure attendance backend.

The function requires a Supabase Auth access token belonging to an active row
in `public.attendance_devices`. It validates the request and invokes the
private `public.record_attendance_from_face` database function using the
server-only `SUPABASE_SERVICE_ROLE_KEY` environment variable. No service-role
credential is present in source code or shipped to Android.

Required environment variables:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (Edge Function secret only)
- `ATTENDANCE_MODEL_NAME`
- `ATTENDANCE_MODEL_VERSION`

Optional environment variables:

- `ATTENDANCE_RATE_LIMIT_PER_MINUTE` (default: `30`)
- `ATTENDANCE_REQUIRE_CHALLENGE` (default: `false` during Phase 1)

The liveness/attestation integration point is intentionally left before the
database RPC call. A client-provided liveness boolean must not be treated as
proof. Challenge issuance and production liveness enforcement should be added
before Android attendance is enabled in production.
