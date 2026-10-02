-- The attendance-submit Edge Function resolves the server-side matched
-- employee_id to the public employee_code/full_name response fields. Keep
-- this lookup server-only; employee_id is never returned to Android.
grant select (employee_id)
    on table public.attendance_attempts to service_role;
