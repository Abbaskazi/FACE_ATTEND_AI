-- FaceAttend AI
-- Phase 3 follow-up: serialize leave transitions with employee-owned writes.
--
-- Request creation, cancellation, and attendance submission already lock the
-- employee row before taking the employee advisory lock. Approval and
-- rejection must use the same order so approval validation cannot race an
-- attendance insert and leave state transitions cannot deadlock each other.

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
    v_employee_id uuid;
    v_request public.employee_leave_requests%rowtype;
    v_requested_days integer;
begin
    if v_actor_user_id is null or not public.is_active_admin() then
        raise exception 'admin_authorization_required' using errcode = '42501';
    end if;

    -- Read the owner first, then acquire locks in the same order used by
    -- request_employee_paid_leave, cancel_employee_leave_request, and the
    -- attendance backend: employee row, employee advisory lock, request row.
    select employee_id
      into v_employee_id
      from public.employee_leave_requests
     where id = p_request_id;

    if v_employee_id is null then
        raise exception 'pending_leave_request_not_found' using errcode = '42501';
    end if;

    select e.id
      into v_employee_id
      from public.employees e
     where e.id = v_employee_id
     for update;

    if not found then
        raise exception 'pending_leave_request_not_found' using errcode = '42501';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_employee_id::text, 0));

    select *
      into v_request
      from public.employee_leave_requests
     where id = p_request_id
     for update;

    if not found or v_request.status <> 'PENDING' then
        raise exception 'pending_leave_request_not_found' using errcode = '42501';
    end if;

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
    v_employee_id uuid;
    v_request public.employee_leave_requests%rowtype;
    v_rejection_reason text := nullif(btrim(coalesce(p_rejection_reason, '')), '');
begin
    if v_actor_user_id is null or not public.is_active_admin() then
        raise exception 'admin_authorization_required' using errcode = '42501';
    end if;

    if v_rejection_reason is not null and char_length(v_rejection_reason) > 2000 then
        raise exception 'rejection_reason_invalid' using errcode = '22023';
    end if;

    select employee_id
      into v_employee_id
      from public.employee_leave_requests
     where id = p_request_id;

    if v_employee_id is null then
        raise exception 'pending_leave_request_not_found' using errcode = '42501';
    end if;

    select e.id
      into v_employee_id
      from public.employees e
     where e.id = v_employee_id
     for update;

    if not found then
        raise exception 'pending_leave_request_not_found' using errcode = '42501';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_employee_id::text, 0));

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
