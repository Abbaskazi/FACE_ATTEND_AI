-- FaceAttend AI
-- Phase 1 employee authentication.
--
-- Employee passwords are owned by Supabase Auth. This migration stores only
-- the Auth identity mapping and the server-controlled first-login state.

-- ============================================================
-- EMPLOYEE AUTH STATE
-- ============================================================

alter table public.employees
    add column if not exists auth_user_id uuid
        references auth.users(id)
        on delete set null,
    add column if not exists must_change_password boolean
        not null default true,
    add column if not exists password_changed_at timestamptz;

create unique index if not exists employees_auth_user_id_unique
    on public.employees(auth_user_id)
    where auth_user_id is not null;

create index if not exists idx_employees_auth_user_active
    on public.employees(auth_user_id)
    where auth_user_id is not null and status = 'ACTIVE';

comment on column public.employees.auth_user_id is
'Supabase Auth identity for the employee. Managed only by the server-side provisioning flow.';

comment on column public.employees.must_change_password is
'Server-controlled first-login gate. Only the employee password-change backend may clear it.';

comment on column public.employees.password_changed_at is
'Timestamp of the first successful employee password change. Never contains a password or hash.';

-- Prevent direct admin/client updates from clearing the first-login gate or
-- changing the Auth mapping outside the narrowly scoped server RPCs below.
create or replace function public.enforce_employee_auth_state()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
    -- A nulling update is also emitted by the auth.users ON DELETE SET NULL
    -- foreign-key action. Only assigning an Auth identity is server-managed.
    if new.auth_user_id is not null
       and old.auth_user_id is distinct from new.auth_user_id
       and current_setting('app.employee_auth_provision', true) <> 'on' then
        raise exception 'employee_auth_mapping_is_server_managed'
            using errcode = '42501';
    end if;

    if old.must_change_password = true
       and new.must_change_password = false
       and current_setting('app.employee_password_change', true) <> 'on' then
        raise exception 'employee_password_change_required'
            using errcode = '42501';
    end if;

    if old.password_changed_at is distinct from new.password_changed_at
       and current_setting('app.employee_password_change', true) <> 'on'
       and current_setting('app.employee_auth_provision', true) <> 'on' then
        raise exception 'employee_password_state_is_server_managed'
            using errcode = '42501';
    end if;

    return new;
end;
$function$;

drop trigger if exists employees_auth_state_guard on public.employees;
create trigger employees_auth_state_guard
before update on public.employees
for each row
execute function public.enforce_employee_auth_state();

-- Do not leave a live Auth account behind when an employee is deleted through
-- the existing admin deletion RPC. The admin UI deprovisions Auth first; this
-- trigger protects direct RPC callers if that step was skipped.
create or replace function public.prevent_employee_delete_with_auth()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
    if old.auth_user_id is not null then
        raise exception 'employee_auth_must_be_deprovisioned'
            using errcode = '23514';
    end if;
    return old;
end;
$function$;

drop trigger if exists employees_auth_delete_guard on public.employees;
create trigger employees_auth_delete_guard
before delete on public.employees
for each row
execute function public.prevent_employee_delete_with_auth();

-- Audit rows may be produced by employee-authenticated flows. Keep the
-- existing admin actor column intact and add a separate employee actor FK.
alter table public.audit_logs
    add column if not exists actor_employee_id uuid
        references public.employees(id)
        on delete set null;

create index if not exists idx_audit_logs_actor_employee
    on public.audit_logs(actor_employee_id);

-- ============================================================
-- SECURITY DEFINER HELPERS
-- ============================================================

create or replace function public.is_active_employee_for(p_employee_id uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $function$
    select p_employee_id is not null
       and auth.uid() is not null
       and exists (
           select 1
             from public.employees e
            where e.id = p_employee_id
              and e.auth_user_id = auth.uid()
              and e.status = 'ACTIVE'
       );
$function$;

revoke all on function public.is_active_employee_for(uuid)
from public, anon, authenticated;

grant execute on function public.is_active_employee_for(uuid)
to authenticated;

-- Called only by the employee-account-admin Edge Function after it has
-- authenticated an active administrator and created the Auth user. The
-- service-only grant is deliberate: the browser cannot assign identities.
create or replace function public.set_employee_auth_user(
    p_employee_id uuid,
    p_auth_user_id uuid,
    p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
    v_existing_auth_user_id uuid;
begin
    if p_employee_id is null or p_auth_user_id is null or p_actor_user_id is null then
        raise exception 'employee_auth_provisioning_input_required'
            using errcode = '22023';
    end if;

    if not exists (
        select 1
          from public.admin_profiles
         where id = p_actor_user_id
           and is_active = true
    ) then
        raise exception 'admin_authorization_required'
            using errcode = '42501';
    end if;

    perform set_config('app.employee_auth_provision', 'on', true);

    update public.employees
       set auth_user_id = p_auth_user_id,
           must_change_password = true,
           password_changed_at = null
     where id = p_employee_id
       and (auth_user_id is null or auth_user_id = p_auth_user_id)
     returning auth_user_id into v_existing_auth_user_id;

    if v_existing_auth_user_id is null then
        raise exception 'employee_not_found_or_auth_mapping_conflict'
            using errcode = 'P0002';
    end if;

    insert into public.audit_logs (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) values (
        p_actor_user_id,
        'EMPLOYEE_AUTH_PROVISIONED',
        'employee',
        p_employee_id,
        jsonb_build_object('employee_id', p_employee_id)
    );

    return v_existing_auth_user_id;
end;
$function$;

revoke all on function public.set_employee_auth_user(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function public.set_employee_auth_user(uuid, uuid, uuid)
to service_role;

create or replace function public.clear_employee_auth_user(
    p_employee_id uuid,
    p_auth_user_id uuid,
    p_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
    if p_employee_id is null or p_auth_user_id is null or p_actor_user_id is null then
        raise exception 'employee_auth_deprovisioning_input_required'
            using errcode = '22023';
    end if;

    if not exists (
        select 1
          from public.admin_profiles
         where id = p_actor_user_id
           and is_active = true
    ) then
        raise exception 'admin_authorization_required'
            using errcode = '42501';
    end if;

    perform set_config('app.employee_auth_provision', 'on', true);

    update public.employees
       set auth_user_id = null,
           must_change_password = true,
           password_changed_at = null
     where id = p_employee_id
       and (auth_user_id = p_auth_user_id or auth_user_id is null);

    if not found then
        raise exception 'employee_not_found_or_auth_mapping_conflict'
            using errcode = 'P0002';
    end if;

    insert into public.audit_logs (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) values (
        p_actor_user_id,
        'EMPLOYEE_AUTH_DEPROVISIONED',
        'employee',
        p_employee_id,
        jsonb_build_object('employee_id', p_employee_id)
    );

    return true;
end;
$function$;

revoke all on function public.clear_employee_auth_user(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function public.clear_employee_auth_user(uuid, uuid, uuid)
to service_role;

-- Called only after Supabase Auth has accepted the new password. It is
-- idempotent so an Auth-success/DB-failure retry cannot strand the employee.
create or replace function public.complete_employee_password_change(
    p_employee_id uuid,
    p_auth_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
    v_updated boolean := false;
begin
    if p_employee_id is null or p_auth_user_id is null then
        raise exception 'employee_password_change_input_required'
            using errcode = '22023';
    end if;

    perform set_config('app.employee_password_change', 'on', true);

    update public.employees
       set must_change_password = false,
           password_changed_at = coalesce(password_changed_at, clock_timestamp())
     where id = p_employee_id
       and auth_user_id = p_auth_user_id
       and status = 'ACTIVE'
       and must_change_password = true;

    v_updated := found;

    if not v_updated then
        if exists (
            select 1
              from public.employees
             where id = p_employee_id
               and auth_user_id = p_auth_user_id
               and status = 'ACTIVE'
               and must_change_password = false
        ) then
            return true;
        end if;
        raise exception 'employee_password_change_not_allowed'
            using errcode = '42501';
    end if;

    insert into public.audit_logs (
        actor_employee_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) values (
        p_employee_id,
        'EMPLOYEE_FIRST_PASSWORD_CHANGED',
        'employee',
        p_employee_id,
        jsonb_build_object('employee_id', p_employee_id)
    );

    return true;
end;
$function$;

revoke all on function public.complete_employee_password_change(uuid, uuid)
from public, anon, authenticated;

grant execute on function public.complete_employee_password_change(uuid, uuid)
to service_role;

-- ============================================================
-- RLS
-- ============================================================

-- Employees may read their active own row, including the salary field already
-- present in the schema. They have no INSERT/UPDATE/DELETE policy.
drop policy if exists "Employees can view their own employee record" on public.employees;
create policy "Employees can view their own employee record"
on public.employees
for select
to authenticated
using (
    auth_user_id = auth.uid()
    and status = 'ACTIVE'
);

-- Employee portal attendance is read-only and owner-scoped. No employee
-- policy is added to attendance_events, biometric_templates, or audit_logs.
drop policy if exists "Employees can view their own attendance" on public.attendance;
create policy "Employees can view their own attendance"
on public.attendance
for select
to authenticated
using (public.is_active_employee_for(employee_id));

-- Explicitly keep the identity/security tables admin-only. These policies are
-- restrictive because employees receive no matching policy.
drop policy if exists "Employees cannot view admin profiles" on public.admin_profiles;
drop policy if exists "Employees cannot view biometric templates" on public.biometric_templates;
drop policy if exists "Employees cannot view audit logs" on public.audit_logs;

comment on function public.complete_employee_password_change(uuid, uuid) is
'Service-only completion step for the employee first-login password flow; never callable by a browser client.';
