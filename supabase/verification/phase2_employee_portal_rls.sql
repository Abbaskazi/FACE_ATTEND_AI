-- Phase 2 employee portal verification.
-- Run these read-only checks against the linked database after applying
-- migration 021. Do not run them with a service-role token when validating
-- employee visibility; service role bypasses RLS.

-- 1. Required employee identity and salary columns exist.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'employees'
  and column_name in (
    'auth_user_id',
    'employee_code',
    'department_id',
    'designation',
    'joining_date',
    'salary',
    'status'
  )
order by column_name;

-- 2. Employee-to-Auth mapping is unique and the Phase 2 department policy
-- exists alongside the Phase 1 employee/attendance policies.
select schemaname, tablename, policyname, cmd, roles, qual
from pg_policies
where schemaname = 'public'
  and (
    (tablename = 'departments' and policyname = 'Employees can view their own department')
    or (tablename = 'employees' and policyname = 'Employees can view their own employee record')
    or (tablename = 'attendance' and policyname = 'Employees can view their own attendance')
  )
order by tablename, policyname;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'employees'
  and indexname = 'employees_auth_user_id_unique';

-- 3. No employee policy should exist on protected data tables.
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('admin_profiles', 'biometric_templates', 'attendance_events', 'audit_logs')
  and policyname ilike '%employee%'
order by tablename, policyname;

-- 4. Manual authenticated-session checks (run with an employee JWT, not a
-- service-role connection):
--   select id, employee_code, full_name, salary from public.employees;
--   select employee_id, attendance_date, status from public.attendance;
--   select * from public.admin_profiles;
--   select * from public.biometric_templates;
--   select * from public.attendance_events;
--   select * from public.audit_logs;
-- Expected: only the authenticated employee's employee/attendance rows are
-- returned; the four protected-table queries return zero rows.
