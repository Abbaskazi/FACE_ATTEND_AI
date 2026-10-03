-- FaceAttend AI
-- Admin-managed, paid non-working calendar holidays.
-- Holiday dates are DATE values. They are never interpreted as timestamps.

create table public.holidays (
    id uuid primary key default gen_random_uuid(),
    holiday_date date not null unique,
    reason text not null,
    created_by uuid not null references public.admin_profiles(id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint holiday_reason_valid check (char_length(btrim(reason)) between 1 and 200)
);

create index idx_holidays_date on public.holidays(holiday_date);

create trigger holidays_updated_at
before update on public.holidays
for each row
execute function public.update_updated_at();

alter table public.holidays enable row level security;

revoke all on table public.holidays from public, anon, authenticated;
grant select on table public.holidays to authenticated;

create policy "Admins can view holidays"
on public.holidays
for select
to authenticated
using (public.is_active_admin());

create policy "Employees can view holidays"
on public.holidays
for select
to authenticated
using (exists (
    select 1
      from public.employees e
     where e.auth_user_id = auth.uid()
       and e.status = 'ACTIVE'
));

create or replace function public.admin_add_holiday(
    p_holiday_date date,
    p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
    v_actor_user_id uuid := auth.uid();
    v_reason text := btrim(coalesce(p_reason, ''));
    v_holiday_id uuid;
begin
    if v_actor_user_id is null or not public.is_active_admin() then
        raise exception 'admin_authorization_required' using errcode = '42501';
    end if;
    if p_holiday_date is null then
        raise exception 'holiday_date_required' using errcode = '22023';
    end if;
    if char_length(v_reason) not between 1 and 200 then
        raise exception 'holiday_reason_invalid' using errcode = '22023';
    end if;

    insert into public.holidays (holiday_date, reason, created_by)
    values (p_holiday_date, v_reason, v_actor_user_id)
    returning id into v_holiday_id;

    insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
    values (
        v_actor_user_id,
        'HOLIDAY_ADDED',
        'holiday',
        v_holiday_id,
        jsonb_build_object('holiday_date', p_holiday_date, 'reason', v_reason)
    );

    return v_holiday_id;
end;
$function$;

revoke all on function public.admin_add_holiday(date, text)
from public, anon, authenticated;
grant execute on function public.admin_add_holiday(date, text) to authenticated;

create or replace function public.admin_delete_holiday(
    p_holiday_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
    v_actor_user_id uuid := auth.uid();
    v_holiday public.holidays%rowtype;
begin
    if v_actor_user_id is null or not public.is_active_admin() then
        raise exception 'admin_authorization_required' using errcode = '42501';
    end if;
    if p_holiday_id is null then
        raise exception 'holiday_id_required' using errcode = '22023';
    end if;

    select * into v_holiday
      from public.holidays
     where id = p_holiday_id
     for update;
    if not found then
        raise exception 'holiday_not_found' using errcode = 'P0002';
    end if;

    delete from public.holidays where id = v_holiday.id;

    insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
    values (
        v_actor_user_id,
        'HOLIDAY_REMOVED',
        'holiday',
        v_holiday.id,
        jsonb_build_object('holiday_date', v_holiday.holiday_date, 'reason', v_holiday.reason)
    );

    return true;
end;
$function$;

revoke all on function public.admin_delete_holiday(uuid)
from public, anon, authenticated;
grant execute on function public.admin_delete_holiday(uuid) to authenticated;

-- These helpers remain the single server-side definition of an applicable
-- leave day: Friday is excluded, then admin holidays are excluded.
create or replace function public.count_paid_leave_working_days(
    p_start_date date,
    p_end_date date
)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
    select count(*)::integer
      from generate_series(p_start_date, p_end_date, interval '1 day') as dates(day)
     where extract(isodow from dates.day)::integer <> 5
       and not exists (
           select 1 from public.holidays h
            where h.holiday_date = dates.day::date
       );
$function$;

revoke all on function public.count_paid_leave_working_days(date, date)
from public, anon, authenticated;

create or replace function public.count_paid_leave_working_days_by_month(
    p_start_date date,
    p_end_date date
)
returns table (month_start date, working_days integer)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
    select date_trunc('month', dates.day)::date as month_start,
           count(*)::integer as working_days
      from generate_series(p_start_date, p_end_date, interval '1 day') as dates(day)
     where extract(isodow from dates.day)::integer <> 5
       and not exists (
           select 1 from public.holidays h
            where h.holiday_date = dates.day::date
       )
     group by date_trunc('month', dates.day)::date
     order by month_start;
$function$;

revoke all on function public.count_paid_leave_working_days_by_month(date, date)
from public, anon, authenticated;

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
    if not exists (select 1 from public.employees where id = p_employee_id and status = 'ACTIVE') then
        raise exception 'active_employee_required' using errcode = '42501';
    end if;

    v_requested_days := public.count_paid_leave_working_days(p_start_date, p_end_date);
    if v_requested_days <= 0 then
        raise exception 'leave_must_include_working_day' using errcode = '22007';
    end if;

    if exists (
        select 1 from public.employee_leave_requests existing
         where existing.employee_id = p_employee_id
           and existing.id is distinct from p_ignore_request_id
           and existing.status in ('PENDING', 'APPROVED')
           and daterange(existing.start_date, existing.end_date, '[]')
               && daterange(p_start_date, p_end_date, '[]')
    ) then
        raise exception 'leave_dates_overlap_existing_request' using errcode = '23P01';
    end if;

    if exists (
        select 1 from public.attendance existing_attendance
         where existing_attendance.employee_id = p_employee_id
           and existing_attendance.attendance_date between p_start_date and p_end_date
           and extract(isodow from existing_attendance.attendance_date)::integer <> 5
           and not exists (
               select 1 from public.holidays h
                where h.holiday_date = existing_attendance.attendance_date
           )
    ) then
        raise exception 'leave_dates_conflict_with_attendance' using errcode = '23P01';
    end if;

    for v_month in select month_start, working_days
                     from public.count_paid_leave_working_days_by_month(p_start_date, p_end_date)
    loop
        select coalesce(sum(public.count_paid_leave_working_days(
            greatest(existing.start_date, v_month.month_start),
            least(existing.end_date, (v_month.month_start + interval '1 month - 1 day')::date)
        )), 0)::integer
          into v_existing_days
          from public.employee_leave_requests existing
         where existing.employee_id = p_employee_id
           and existing.id is distinct from p_ignore_request_id
           and existing.status = 'APPROVED'
           and existing.start_date <= (v_month.month_start + interval '1 month - 1 day')::date
           and existing.end_date >= v_month.month_start;

        if v_existing_days + v_month.working_days > 2 then
            raise exception 'paid_leave_allowance_exceeded_for_month:%',
                to_char(v_month.month_start, 'YYYY-MM') using errcode = '23514';
        end if;
    end loop;

    return v_requested_days;
end;
$function$;

revoke all on function public.validate_paid_leave_request(uuid, date, date, uuid)
from public, anon, authenticated;

comment on table public.holidays is
'Admin-managed paid non-working calendar dates. Holiday dates are DATE values.';
