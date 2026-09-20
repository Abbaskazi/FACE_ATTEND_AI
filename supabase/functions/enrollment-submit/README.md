# enrollment-submit

Android-facing secure employee enrollment endpoint.

The caller must provide a Supabase Auth access token belonging to an active
row in `public.attendance_devices`. The request contains only an opaque,
admin-created enrollment token and the normalized embedding. The token is
hashed before lookup; the employee ID is never accepted from Android.

Required Edge Function secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (Edge Function secret only)
- `ENROLLMENT_MODEL_NAME` = `w600k_mbf.onnx`
- `ENROLLMENT_MODEL_VERSION` = the Android `VERIFIED_MODEL_SHA256` value

`complete_enrollment` performs the template insert, one-time session update,
and audit-log insert in one database transaction. It returns only completion
status/time and never returns the embedding.
