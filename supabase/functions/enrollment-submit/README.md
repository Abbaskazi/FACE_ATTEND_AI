# enrollment-submit

Android-facing secure employee enrollment endpoint.

The caller must provide a Supabase Auth access token belonging to an active
row in `public.attendance_devices`. The request contains only an opaque,
admin-created enrollment token and one normalized embedding. The token is
hashed before lookup; the employee ID is never accepted from Android.

Required Edge Function secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (Edge Function secret only)
- `ENROLLMENT_MODEL_NAME` = `glintr100.onnx`
- `ENROLLMENT_MODEL_VERSION` = `4ab1d6435d639628a6f3e5008dd4f929edf4c4124b1a7169e1048f9fef534cdf`

`complete_enrollment` validates the single sample and atomically replaces the
selected employee's one active template, marks the one-time session used, and
writes an audit record. It returns only completion metadata and never returns
an embedding.
