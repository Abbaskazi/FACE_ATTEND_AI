# attendance-submit

Android-facing check-in/check-out API for the secure attendance backend.

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

For the ResNet100 production contract, set `ATTENDANCE_MODEL_NAME` to
`glintr100.onnx` and `ATTENDANCE_MODEL_VERSION` to
`4ab1d6435d639628a6f3e5008dd4f929edf4c4124b1a7169e1048f9fef534cdf`.

Optional environment variables:

- `ATTENDANCE_RATE_LIMIT_PER_MINUTE` (default: `30`)
- `ATTENDANCE_REQUIRE_CHALLENGE` (default: `false` during Phase 1)

The liveness/attestation integration point is intentionally left before the
database RPC call. A client-provided liveness boolean must not be treated as
proof. Challenge issuance and production liveness enforcement should be added
before Android attendance is enabled in production.

The database stores one `public.attendance` row per session. The private RPC
locks the matched employee row, permits multiple completed sessions per local
attendance date, and permits at most one open session. The response outcomes
include `CHECK_IN_RECORDED`, `ALREADY_CHECKED_IN`, `CHECK_OUT_RECORDED`,
`NOT_CHECKED_IN`, `RECOGNITION_FAILED`, `AMBIGUOUS_MATCH`,
`UNAUTHORIZED_DEVICE`, `RATE_LIMITED`, and
`VALIDATION_ERROR`. A close top-two match is rejected without selecting an
employee. Session times and daily totals are
calculated from database server timestamps; client timestamps and working
minutes are not accepted.
