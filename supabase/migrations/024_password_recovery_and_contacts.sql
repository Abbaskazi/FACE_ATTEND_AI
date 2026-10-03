-- FaceAttend AI
-- Phase 4: employee contact validation, password recovery, and admin reset requests.
-- Passwords and plaintext OTPs are never stored in this schema.

-- ============================================================
-- EMPLOYEE CONTACT VALIDATION
-- ============================================================

create or replace function public.normalize_employee_contact_information()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
    v_phone text;
begin
    -- Existing rows are intentionally allowed to remain NULL. New rows must
    -- have both contact fields so email recovery can work for new employees.
    if tg_op = 'INSERT' then
        if nullif(btrim(new.email), '') is null then
            raise exception 'employee_email_required' using errcode = '22023';
        end if;
        if nullif(btrim(new.phone), '') is null then
            raise exception 'employee_phone_required' using errcode = '22023';
        end if;
    end if;

    if new.email is not null then
        new.email := lower(btrim(new.email));
        if new.email = '' or new.email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$' then
            raise exception 'employee_email_invalid' using errcode = '22023';
        end if;
    end if;

    if new.phone is not null then
        v_phone := regexp_replace(btrim(new.phone), '[^0-9+]', '', 'g');
        if v_phone like '+91%' then
            v_phone := substring(v_phone from 4);
        elsif v_phone like '0091%' then
            v_phone := substring(v_phone from 5);
        elsif v_phone like '0%' then
            v_phone := substring(v_phone from 2);
        end if;

        if v_phone !~ '^[6-9][0-9]{9}$' then
            raise exception 'employee_phone_invalid' using errcode = '22023';
        end if;
        new.phone := '+91' || v_phone;
    end if;

    return new;
end;
$function$;

drop trigger if exists employees_contact_information_guard on public.employees;
create trigger employees_contact_information_guard
before insert or update of email, phone on public.employees
for each row
execute function public.normalize_employee_contact_information();

-- ============================================================
-- PASSWORD RECOVERY STATE
-- ============================================================

create table if not exists public.employee_password_recovery_challenges (
    id uuid primary key default gen_random_uuid(),
    employee_id uuid not null references public.employees(id) on delete cascade,
    otp_hash text not null,
    expires_at timestamptz not null,
    attempt_count integer not null default 0 check (attempt_count >= 0),
    created_at timestamptz not null default clock_timestamp(),
    last_sent_at timestamptz not null default clock_timestamp(),
    verified_at timestamptz,
    used_at timestamptz,
    invalidated_at timestamptz,
    constraint employee_password_recovery_otp_hash_not_blank check (btrim(otp_hash) <> '')
);

create index if not exists idx_password_recovery_employee_created
    on public.employee_password_recovery_challenges(employee_id, created_at desc);

create index if not exists idx_password_recovery_expiry
    on public.employee_password_recovery_challenges(expires_at)
    where used_at is null and invalidated_at is null;

alter table public.employee_password_recovery_challenges enable row level security;

-- No browser role receives a policy. The recovery Edge Function is the only
-- caller and uses the service role to read/write challenge state.
revoke all on table public.employee_password_recovery_challenges from public, anon, authenticated;
grant all on table public.employee_password_recovery_challenges to service_role;

create table if not exists public.employee_password_change_requests (
    id uuid primary key default gen_random_uuid(),
    employee_id uuid not null references public.employees(id) on delete cascade,
    status text not null default 'PENDING'
        check (status in ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED')),
    reason text,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    approved_by uuid references public.admin_profiles(id) on delete set null,
    approved_at timestamptz,
    rejected_by uuid references public.admin_profiles(id) on delete set null,
    rejected_at timestamptz,
    rejection_reason text,
    completed_at timestamptz
);

create unique index if not exists employee_password_change_one_pending
    on public.employee_password_change_requests(employee_id)
    where status = 'PENDING';

create index if not exists idx_employee_password_change_requests_status
    on public.employee_password_change_requests(status, created_at desc);

create index if not exists idx_employee_password_change_requests_employee
    on public.employee_password_change_requests(employee_id, created_at desc);

alter table public.employee_password_change_requests enable row level security;

drop policy if exists "Admins can view password change requests" on public.employee_password_change_requests;
create policy "Admins can view password change requests"
on public.employee_password_change_requests
for select
to authenticated
using (public.is_active_admin());

drop policy if exists "Employees can view their password change requests" on public.employee_password_change_requests;
create policy "Employees can view their password change requests"
on public.employee_password_change_requests
for select
to authenticated
using (public.is_active_employee_for(employee_id));

revoke all on table public.employee_password_change_requests from public, anon;
grant select on table public.employee_password_change_requests to authenticated;
grant all on table public.employee_password_change_requests to service_role;

-- ============================================================
-- SERVER-ONLY SECURITY OPERATIONS
-- ============================================================

-- Extend the Phase 1 completion RPC for voluntary changes and recovery. The
-- original function was intentionally first-login-only; Phase 4 also needs
-- every successful Auth password update to receive a fresh server timestamp.
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
    v_was_required boolean;
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'service_role_required' using errcode = '42501';
    end if;
    select must_change_password into v_was_required
      from public.employees
     where id = p_employee_id and auth_user_id = p_auth_user_id and status = 'ACTIVE'
     for update;
    if not found then
        raise exception 'employee_password_change_not_allowed' using errcode = '42501';
    end if;

    perform set_config('app.employee_password_change', 'on', true);
    update public.employees
       set must_change_password = false,
           password_changed_at = clock_timestamp()
     where id = p_employee_id and auth_user_id = p_auth_user_id;

    if v_was_required then
        insert into public.audit_logs (
            actor_employee_id, action, entity_type, entity_id, metadata
        ) values (
            p_employee_id, 'EMPLOYEE_FIRST_PASSWORD_CHANGED', 'employee', p_employee_id,
            jsonb_build_object('employee_id', p_employee_id)
        );
    end if;
    return true;
end;
$function$;

revoke all on function public.complete_employee_password_change(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.complete_employee_password_change(uuid, uuid)
to service_role;

create or replace function public.record_employee_security_audit(
    p_action text,
    p_employee_id uuid default null,
    p_actor_user_id uuid default null,
    p_entity_type text default 'employee',
    p_entity_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'service_role_required' using errcode = '42501';
    end if;

    if p_action not in (
        'PASSWORD_CHANGE_COMPLETED',
        'PASSWORD_RECOVERY_REQUESTED',
        'EMAIL_OTP_SENT',
        'OTP_VERIFIED',
        'OTP_FAILED',
        'PASSWORD_RESET_COMPLETED',
        'PASSWORD_CHANGE_REQUESTED'
    ) then
        raise exception 'security_audit_action_invalid' using errcode = '22023';
    end if;

    insert into public.audit_logs (
        actor_user_id,
        actor_employee_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) values (
        p_actor_user_id,
        p_employee_id,
        p_action,
        p_entity_type,
        coalesce(p_entity_id, p_employee_id),
        jsonb_build_object('security_event', true)
    );

    return true;
end;
$function$;

revoke all on function public.record_employee_security_audit(text, uuid, uuid, text, uuid)
from public, anon, authenticated;
grant execute on function public.record_employee_security_audit(text, uuid, uuid, text, uuid)
to service_role;

create or replace function public.mark_employee_admin_password_reset(
    p_request_id uuid,
    p_employee_id uuid,
    p_auth_user_id uuid,
    p_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
    v_request public.employee_password_change_requests%rowtype;
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'service_role_required' using errcode = '42501';
    end if;

    if not exists (
        select 1 from public.admin_profiles
        where id = p_actor_user_id and is_active = true
    ) then
        raise exception 'admin_authorization_required' using errcode = '42501';
    end if;

    if exists (
        select 1 from public.employees
        where id = p_employee_id and auth_user_id = p_actor_user_id
    ) then
        raise exception 'admin_cannot_reset_own_employee_password' using errcode = '42501';
    end if;

    select * into v_request
      from public.employee_password_change_requests
     where id = p_request_id
       and employee_id = p_employee_id
     for update;

    if not found or v_request.status <> 'PENDING' then
        raise exception 'pending_password_change_request_not_found' using errcode = '42501';
    end if;

    if not exists (
        select 1 from public.employees
        where id = p_employee_id
          and auth_user_id = p_auth_user_id
          and status = 'ACTIVE'
    ) then
        raise exception 'employee_account_not_available' using errcode = 'P0002';
    end if;

    perform set_config('app.employee_password_change', 'on', true);
    update public.employees
       set must_change_password = true,
           password_changed_at = null
     where id = p_employee_id and auth_user_id = p_auth_user_id;

    update public.employee_password_change_requests
       set status = 'APPROVED',
           approved_by = p_actor_user_id,
           approved_at = clock_timestamp(),
           updated_at = clock_timestamp(),
           rejection_reason = null,
           rejected_by = null,
           rejected_at = null
     where id = p_request_id and status = 'PENDING';

    if not found then
        raise exception 'pending_password_change_request_not_found' using errcode = '42501';
    end if;

    insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
    values
      (p_actor_user_id, 'PASSWORD_CHANGE_REQUEST_APPROVED', 'employee_password_change_request', p_request_id,
       jsonb_build_object('employee_id', p_employee_id)),
      (p_actor_user_id, 'ADMIN_PASSWORD_RESET', 'employee', p_employee_id,
       jsonb_build_object('request_id', p_request_id));

    return true;
end;
$function$;

revoke all on function public.mark_employee_admin_password_reset(uuid, uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.mark_employee_admin_password_reset(uuid, uuid, uuid, uuid)
to service_role;

create or replace function public.reject_employee_password_change_request(
    p_request_id uuid,
    p_actor_user_id uuid,
    p_rejection_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
    v_request public.employee_password_change_requests%rowtype;
    v_reason text := nullif(btrim(coalesce(p_rejection_reason, '')), '');
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'service_role_required' using errcode = '42501';
    end if;
    if not exists (select 1 from public.admin_profiles where id = p_actor_user_id and is_active = true) then
        raise exception 'admin_authorization_required' using errcode = '42501';
    end if;
    if v_reason is not null and char_length(v_reason) > 2000 then
        raise exception 'rejection_reason_invalid' using errcode = '22023';
    end if;

    select * into v_request from public.employee_password_change_requests
     where id = p_request_id for update;
    if not found or v_request.status <> 'PENDING' then
        raise exception 'pending_password_change_request_not_found' using errcode = '42501';
    end if;

    update public.employee_password_change_requests
       set status = 'REJECTED',
           rejected_by = p_actor_user_id,
           rejected_at = clock_timestamp(),
           rejection_reason = v_reason,
           updated_at = clock_timestamp()
     where id = p_request_id and status = 'PENDING';
    if not found then
        raise exception 'pending_password_change_request_not_found' using errcode = '42501';
    end if;

    insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
    values (p_actor_user_id, 'PASSWORD_CHANGE_REQUEST_REJECTED', 'employee_password_change_request', p_request_id,
            jsonb_build_object('employee_id', v_request.employee_id, 'has_rejection_reason', v_reason is not null));
    return true;
end;
$function$;

revoke all on function public.reject_employee_password_change_request(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.reject_employee_password_change_request(uuid, uuid, text)
to service_role;

create or replace function public.complete_employee_password_change_request(
    p_employee_id uuid,
    p_auth_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
    v_request_id uuid;
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'service_role_required' using errcode = '42501';
    end if;
    if not exists (
        select 1 from public.employees
        where id = p_employee_id and auth_user_id = p_auth_user_id and status = 'ACTIVE'
    ) then
        raise exception 'employee_account_not_available' using errcode = 'P0002';
    end if;

    select id into v_request_id
      from public.employee_password_change_requests
     where employee_id = p_employee_id and status = 'APPROVED'
     order by approved_at desc nulls last, created_at desc
     limit 1
     for update;

    if v_request_id is not null then
        update public.employee_password_change_requests
           set status = 'COMPLETED', completed_at = clock_timestamp(), updated_at = clock_timestamp()
         where id = v_request_id and status = 'APPROVED';
        insert into public.audit_logs (actor_employee_id, action, entity_type, entity_id, metadata)
        values (p_employee_id, 'PASSWORD_RESET_COMPLETED', 'employee_password_change_request', v_request_id,
                jsonb_build_object('employee_id', p_employee_id));
    end if;
    return true;
end;
$function$;

revoke all on function public.complete_employee_password_change_request(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.complete_employee_password_change_request(uuid, uuid)
to service_role;

-- Keep request rows readable only through the existing authenticated RLS
-- policies. No INSERT/UPDATE/DELETE browser policy is intentionally provided.
comment on table public.employee_password_recovery_challenges is
'Server-only OTP challenge state. otp_hash is a digest, never the plaintext code.';

comment on table public.employee_password_change_requests is
'Employee password reset requests. Status transitions are server-side only.';
