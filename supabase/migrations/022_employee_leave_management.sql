-- FaceAttend AI
-- Phase 3 employee paid-leave management.
--
-- Leave dates are calendar dates. Friday (ISO weekday 5) is the only
-- non-working day. All request validation and approval checks happen inside
-- PostgreSQL so the browser cannot forge counts or bypass the allowance.

create extension if not exists btree_gist;

do $block$
begin
    create type public.leave_request_status as enum (
        'PENDING',
        'APPROVED',
        'REJECTED',
        'CANCELLED'
    );
exception
    when duplicate_object then null;
end
$block$;

create table public.employee_leave_requests (
    id uuid primary key default gen_random_uuid(),

    employee_id uuid not null
        references public.employees(id)
        on delete restrict,

    leave_type text not null default 'PAID',

    start_date date not null,

    end_date date not null,

    reason text not null,

    status public.leave_request_status not null default 'PENDING',

    requested_working_days integer not null default 0,

    rejection_reason text,

    approved_by uuid references public.admin_profiles(id)
        on delete set null,

    approved_at timestamptz,

    rejected_by uuid references public.admin_profiles(id)
        on delete set null,

    rejected_at timestamptz,

    cancelled_at timestamptz,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint employee_leave_type_paid
        check (leave_type = 'PAID'),

    constraint employee_leave_date_range_valid
        check (start_date <= end_date),

    constraint employee_leave_reason_valid
        check (char_length(btrim(reason)) between 1 and 2000),

    constraint employee_leave_working_days_valid
        check (requested_working_days > 0),

    constraint employee_leave_approval_metadata_valid
        check (
            (status <> 'APPROVED')
            or (approved_by is not null and approved_at is not null)
        ),

    constraint employee_leave_rejection_metadata_valid
        check (
            (status <> 'REJECTED')
            or (rejected_by is not null and rejected_at is not null)
        ),

    constraint employee_leave_cancellation_metadata_valid
        check (
            (status <> 'CANCELLED')
            or cancelled_at is not null
        )
);

create index idx_employee_leave_requests_employee_created
    on public.employee_leave_requests(employee_id, created_at desc);

create index idx_employee_leave_requests_status_dates
    on public.employee_leave_requests(status, start_date, end_date);

create index idx_employee_leave_requests_employee_status
    on public.employee_leave_requests(employee_id, status);

-- A pending or approved request reserves its complete requested date range.
-- This closes the concurrent-insert race for overlapping requests. Rejected
-- and cancelled requests release the range and do not block a new request.
alter table public.employee_leave_requests
    add constraint employee_leave_active_date_overlap
    exclude using gist (
        employee_id with =,
        daterange(start_date, end_date, '[]') with &&
    ) where (status in ('PENDING', 'APPROVED'));

create trigger employee_leave_requests_updated_at
before update on public.employee_leave_requests
for each row
execute function public.update_updated_at();

alter table public.employee_leave_requests enable row level security;

revoke all on table public.employee_leave_requests from anon, authenticated;
grant select on table public.employee_leave_requests to authenticated;

create policy "Admins can view employee leave requests"
on public.employee_leave_requests
for select
to authenticated
using (public.is_active_admin());

create policy "Employees can view their own leave requests"
on public.employee_leave_requests
for select
to authenticated
using (public.is_active_employee_for(employee_id));

-- The table has no employee INSERT/UPDATE/DELETE policies. Employees and
-- administrators use the narrowly scoped RPCs below instead.

create or replace function public.count_paid_leave_working_days(
    p_start_date date,
    p_end_date date
)
returns integer
language sql
immutable
set search_path = pg_catalog, public
as $function$
    select count(*)::integer
      from generate_series(p_start_date, p_end_date, interval '1 day') as dates(day)
     where extract(isodow from dates.day)::integer <> 5;
$function$;

revoke all on function public.count_paid_leave_working_days(date, date)
from public, anon, authenticated;

create or replace function public.count_paid_leave_working_days_by_month(
    p_start_date date,
    p_end_date date
)
returns table (
    month_start date,
    working_days integer
)
language sql
immutable
set search_path = pg_catalog, public
as $function$
    select date_trunc('month', dates.day)::date as month_start,
           count(*)::integer as working_days
      from generate_series(p_start_date, p_end_date, interval '1 day') as dates(day)
     where extract(isodow from dates.day)::integer <> 5
     group by date_trunc('month', dates.day)::date
     order by month_start;
$function$;

revoke all on function public.count_paid_leave_working_days_by_month(date, date)
from public, anon, authenticated;

-- This helper is called only by the controlled request/approval functions.
-- The caller must hold the employee advisory lock before invoking it.
create or replace function public.validate_paid_leave_request(
    p_employee_id uuid,
    p_start_date date,
    p_end_date date,
    p_ignore_request_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
    v_requested_days integer;
    v_existing_days integer;
    v_month record;
begin
    if p_employee_id is null or p_start_date is null or p_end_date is null then
        raise exception 'leave_request_input_required' using errcode = '22023';
    end if;

    if p_start_date > p_end_date then
        raise exception 'leave_start_after_end' using errcode = '22007';
    end if;

    if p_start_date < current_date then
        raise exception 'leave_dates_cannot_be_in_the_past' using errcode = '22007';
    end if;

    if not exists (
        select 1
          from public.employees
         where id = p_employee_id
           and status = 'ACTIVE'
    ) then
        raise exception 'active_employee_required' using errcode = '42501';
    end if;

    v_requested_days := public.count_paid_leave_working_days(p_start_date, p_end_date);
    if v_requested_days <= 0 then
        raise exception 'leave_must_include_working_day' using errcode = '22007';
    end if;

    if exists (
        select 1
          from public.employee_leave_requests existing
         where existing.employee_id = p_employee_id
           and existing.id is distinct from p_ignore_request_id
           and existing.status in ('PENDING', 'APPROVED')
           and daterange(existing.start_date, existing.end_date, '[]')
               && daterange(p_start_date, p_end_date, '[]')
    ) then
        raise exception 'leave_dates_overlap_existing_request' using errcode = '23P01';
    end if;

    if exists (
        select 1
          from public.attendance existing_attendance
         where existing_attendance.employee_id = p_employee_id
           and existing_attendance.attendance_date between p_start_date and p_end_date
           and extract(isodow from existing_attendance.attendance_date)::integer <> 5
    ) then
        raise exception 'leave_dates_conflict_with_attendance' using errcode = '23P01';
    end if;

    for v_month in
        select month_start, working_days
          from public.count_paid_leave_working_days_by_month(p_start_date, p_end_date)
    loop
        select coalesce(sum(
            public.count_paid_leave_working_days(
                greatest(existing.start_date, v_month.month_start),
                least(existing.end_date, (v_month.month_start + interval '1 month - 1 day')::date)
            )
        ), 0)::integer
          into v_existing_days
          from public.employee_leave_requests existing
         where existing.employee_id = p_employee_id
           and existing.id is distinct from p_ignore_request_id
           and existing.status = 'APPROVED'
           and existing.start_date <= (v_month.month_start + interval '1 month - 1 day')::date
           and existing.end_date >= v_month.month_start;

        if v_existing_days + v_month.working_days > 2 then
            raise exception 'paid_leave_allowance_exceeded_for_month:%',
                to_char(v_month.month_start, 'YYYY-MM')
                using errcode = '23514';
        end if;
    end loop;

    return v_requested_days;
end;
$function$;

revoke all on function public.validate_paid_leave_request(uuid, date, date, uuid)
from public, anon, authenticated;

create or replace function public.request_employee_paid_leave(
    p_start_date date,
    p_end_date date,
    p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
    v_auth_user_id uuid := auth.uid();
    v_employee_id uuid;
    v_request_id uuid;
    v_requested_days integer;
    v_reason text := btrim(coalesce(p_reason, ''));
begin
    if v_auth_user_id is null then
        raise exception 'employee_authentication_required' using errcode = '42501';
    end if;

    if char_length(v_reason) not between 1 and 2000 then
        raise exception 'leave_reason_invalid' using errcode = '22023';
    end if;

    select id
      into v_employee_id
      from public.employees
     where auth_user_id = v_auth_user_id
       and status = 'ACTIVE'
     for update;

    if v_employee_id is null then
        raise exception 'active_employee_required' using errcode = '42501';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_employee_id::text, 0));

    v_requested_days := public.validate_paid_leave_request(
        v_employee_id,
        p_start_date,
        p_end_date,
        null
    );

    insert into public.employee_leave_requests (
        employee_id,
        leave_type,
        start_date,
        end_date,
        reason,
        requested_working_days,
        status
    ) values (
        v_employee_id,
        'PAID',
        p_start_date,
        p_end_date,
        v_reason,
        v_requested_days,
        'PENDING'
    )
    returning id into v_request_id;

    insert into public.audit_logs (
        actor_employee_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) values (
        v_employee_id,
        'LEAVE_REQUESTED',
        'employee_leave_request',
        v_request_id,
        jsonb_build_object(
            'employee_id', v_employee_id,
            'start_date', p_start_date,
            'end_date', p_end_date,
            'requested_working_days', v_requested_days
        )
    );

    return v_request_id;
end;
$function$;

revoke all on function public.request_employee_paid_leave(date, date, text)
from public, anon;

grant execute on function public.request_employee_paid_leave(date, date, text)
to authenticated;

create or replace function public.cancel_employee_leave_request(
    p_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
    v_auth_user_id uuid := auth.uid();
    v_employee_id uuid;
begin
    if v_auth_user_id is null or p_request_id is null then
        raise exception 'employee_authentication_required' using errcode = '42501';
    end if;

    select id
      into v_employee_id
      from public.employees
     where auth_user_id = v_auth_user_id
       and status = 'ACTIVE'
     for update;

    if v_employee_id is null then
        raise exception 'active_employee_required' using errcode = '42501';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_employee_id::text, 0));

    update public.employee_leave_requests
       set status = 'CANCELLED',
           cancelled_at = clock_timestamp(),
           updated_at = clock_timestamp()
     where id = p_request_id
       and employee_id = v_employee_id
       and status = 'PENDING';

    if not found then
        raise exception 'pending_leave_request_not_found' using errcode = '42501';
    end if;

    insert into public.audit_logs (
        actor_employee_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) values (
        v_employee_id,
        'LEAVE_CANCELLED',
        'employee_leave_request',
        p_request_id,
        jsonb_build_object('employee_id', v_employee_id)
    );

    return true;
end;
$function$;

revoke all on function public.cancel_employee_leave_request(uuid)
from public, anon;

grant execute on function public.cancel_employee_leave_request(uuid)
to authenticated;

create or replace function public.approve_employee_leave_request(
    p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
    v_actor_user_id uuid := auth.uid();
    v_request public.employee_leave_requests%rowtype;
    v_requested_days integer;
begin
    if v_actor_user_id is null or not public.is_active_admin() then
        raise exception 'admin_authorization_required' using errcode = '42501';
    end if;

    select *
      into v_request
      from public.employee_leave_requests
     where id = p_request_id
     for update;

    if not found or v_request.status <> 'PENDING' then
        raise exception 'pending_leave_request_not_found' using errcode = '42501';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_request.employee_id::text, 0));

    v_requested_days := public.validate_paid_leave_request(
        v_request.employee_id,
        v_request.start_date,
        v_request.end_date,
        v_request.id
    );

    update public.employee_leave_requests
       set status = 'APPROVED',
           requested_working_days = v_requested_days,
           approved_by = v_actor_user_id,
           approved_at = clock_timestamp(),
           rejection_reason = null,
           rejected_by = null,
           rejected_at = null,
           updated_at = clock_timestamp()
     where id = v_request.id
       and status = 'PENDING';

    if not found then
        raise exception 'pending_leave_request_not_found' using errcode = '42501';
    end if;

    insert into public.audit_logs (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) values (
        v_actor_user_id,
        'LEAVE_APPROVED',
        'employee_leave_request',
        v_request.id,
        jsonb_build_object(
            'employee_id', v_request.employee_id,
            'start_date', v_request.start_date,
            'end_date', v_request.end_date,
            'approved_working_days', v_requested_days
        )
    );

    return v_request.id;
end;
$function$;

revoke all on function public.approve_employee_leave_request(uuid)
from public, anon;

grant execute on function public.approve_employee_leave_request(uuid)
to authenticated;

create or replace function public.reject_employee_leave_request(
    p_request_id uuid,
    p_rejection_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
    v_actor_user_id uuid := auth.uid();
    v_request public.employee_leave_requests%rowtype;
    v_rejection_reason text := nullif(btrim(coalesce(p_rejection_reason, '')), '');
begin
    if v_actor_user_id is null or not public.is_active_admin() then
        raise exception 'admin_authorization_required' using errcode = '42501';
    end if;

    if v_rejection_reason is not null and char_length(v_rejection_reason) > 2000 then
        raise exception 'rejection_reason_invalid' using errcode = '22023';
    end if;

    select *
      into v_request
      from public.employee_leave_requests
     where id = p_request_id
     for update;

    if not found or v_request.status <> 'PENDING' then
        raise exception 'pending_leave_request_not_found' using errcode = '42501';
    end if;

    update public.employee_leave_requests
       set status = 'REJECTED',
           rejection_reason = v_rejection_reason,
           rejected_by = v_actor_user_id,
           rejected_at = clock_timestamp(),
           updated_at = clock_timestamp()
     where id = v_request.id
       and status = 'PENDING';

    if not found then
        raise exception 'pending_leave_request_not_found' using errcode = '42501';
    end if;

    insert into public.audit_logs (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) values (
        v_actor_user_id,
        'LEAVE_REJECTED',
        'employee_leave_request',
        v_request.id,
        jsonb_build_object(
            'employee_id', v_request.employee_id,
            'start_date', v_request.start_date,
            'end_date', v_request.end_date,
            'has_rejection_reason', v_rejection_reason is not null
        )
    );

    return v_request.id;
end;
$function$;

revoke all on function public.reject_employee_leave_request(uuid, text)
from public, anon;

grant execute on function public.reject_employee_leave_request(uuid, text)
to authenticated;

-- The existing admin deletion RPC uses explicit dependency deletion and the
-- employee FK is RESTRICT. Reinstall the same guarded RPC with leave requests
-- deleted before the employee row, preserving the existing behavior.
create or replace function public.delete_employee(p_employee_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
    v_actor_user_id uuid := auth.uid();
    v_employee_code text;
    v_full_name text;
    v_department_name text;
begin
    if v_actor_user_id is null
        or not public.is_active_admin() then
        raise exception 'admin_authorization_required' using errcode = '42501';
    end if;

    if p_employee_id is null then
        raise exception 'employee_id_required' using errcode = '22023';
    end if;

    select e.employee_code, e.full_name, d.name
      into v_employee_code, v_full_name, v_department_name
      from public.employees e
      left join public.departments d on d.id = e.department_id
     where e.id = p_employee_id
     for update of e;

    if not found then
        raise exception 'employee_not_found' using errcode = 'P0002';
    end if;

    delete from public.employee_leave_requests
     where employee_id = p_employee_id;

    delete from public.enrollment_samples
     where employee_id = p_employee_id
        or enrollment_session_id in (
            select id
              from public.enrollment_sessions
             where employee_id = p_employee_id
        );

    delete from public.biometric_templates
     where employee_id = p_employee_id;

    delete from public.attendance_events
     where employee_id = p_employee_id
        or attendance_id in (
            select id
              from public.attendance
             where employee_id = p_employee_id
        );

    delete from public.attendance_attempts
     where employee_id = p_employee_id
        or attendance_id in (
            select id
              from public.attendance
             where employee_id = p_employee_id
        );

    delete from public.enrollment_sessions
     where employee_id = p_employee_id;

    delete from public.attendance
     where employee_id = p_employee_id;

    delete from public.employees
     where id = p_employee_id;

    insert into public.audit_logs (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    )
    values (
        v_actor_user_id,
        'DELETE_EMPLOYEE',
        'employee',
        p_employee_id,
        jsonb_build_object(
            'employee_id', p_employee_id,
            'employee_code', v_employee_code,
            'employee_name', v_full_name,
            'department', v_department_name
        )
    );

    return jsonb_build_object(
        'deleted', true,
        'employee_id', p_employee_id
    );
end;
$function$;

revoke all on function public.delete_employee(uuid)
from public, anon, authenticated;

grant execute on function public.delete_employee(uuid)
to authenticated;

comment on table public.employee_leave_requests is
'Employee paid leave requests. Only approved requests count toward paid leave and salary.';

comment on column public.employee_leave_requests.requested_working_days is
'Server-calculated count excluding Fridays; never accepted from a client request.';
