# Employee authentication — Phase 1

Employee authentication uses Supabase Auth. The user-facing login ID is
`employees.employee_code`; the internal Auth email is generated only inside
the `employee-account-admin` Edge Function and is never returned to the
browser.

## Provisioning

1. Apply migration `020_employee_authentication.sql` through the normal
   Supabase migration workflow.
2. Deploy `employee-login`, `employee-password-change`, and
   `employee-account-admin` with the existing Edge Function workflow. The
   function runtime must have the standard `SUPABASE_URL`,
   `SUPABASE_ANON_KEY` (or publishable key), and `SUPABASE_SERVICE_ROLE_KEY`
   secrets plus the server-only `EMPLOYEE_INITIAL_PASSWORD` secret set to
   `RajMotor`. The service-role key and initial password must remain
   server-side.
3. Open the admin employee directory and choose `Provision login` for each
   existing employee that is not yet provisioned. New employees are
   provisioned automatically after the admin creates them; the same button is
   available for a safe retry.

The provisioning function creates one Auth identity with the temporary
credential `RajMotor`, maps it to the employee row, and records an audit event.
The temporary password is not stored in PostgreSQL, Auth metadata, frontend
storage, or logs. Administrators should communicate it to the employee
through the organization’s approved private channel.

## Login and first password change

Employees use `/employee/login` with their employee code and temporary
password. Active, provisioned employees receive a Supabase Auth session. The
first-login flag is read from the employee row and is enforced by the employee
route and by RLS; direct navigation or API calls cannot unlock the dashboard.

The password-change function updates Supabase Auth before clearing the database
flag. If Auth succeeds but the state update fails, the employee remains gated
and can retry with the same new password. No password or token is recorded in
the audit event.

Inactive and suspended employees are rejected by the login broker before a
session is issued. Employee RLS permits only the active employee’s own row and
attendance records. Biometric templates, audit logs, admin profiles, and other
employees remain unavailable.

## Safe deprovisioning

The existing admin delete flow first removes the employee’s Auth identity
through `employee-account-admin`, then calls the existing delete RPC. The
database trigger prevents deleting an employee row while an Auth mapping still
exists. If the database delete fails after Auth deletion, the employee remains
unprovisioned and can be safely retried; no live employee login is left behind.
