-- FaceAttend AI
-- Install the admin-only employee deletion RPC in the deployed schema.
--
-- Migration 018 contains the original implementation. This migration is
-- intentionally additive so it can be applied safely when 018 was created
-- locally but was not present in the target database/schema cache.

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

    -- Lock the employee row before deleting dependents. Foreign-key inserts
    -- take a key-share lock, so this prevents a concurrent owned-record insert
    -- from racing with the deletion transaction.
    select e.employee_code, e.full_name, d.name
      into v_employee_code, v_full_name, v_department_name
      from public.employees e
      left join public.departments d on d.id = e.department_id
     where e.id = p_employee_id
     for update of e;

    if not found then
        raise exception 'employee_not_found' using errcode = 'P0002';
    end if;

    -- enrollment_samples has both a direct employee FK and a session FK.
    -- Delete it explicitly before deleting either parent.
    delete from public.enrollment_samples
     where employee_id = p_employee_id
        or enrollment_session_id in (
            select id
              from public.enrollment_sessions
             where employee_id = p_employee_id
        );

    delete from public.biometric_templates
     where employee_id = p_employee_id;

    -- Events and attempts have employee and attendance references. Remove
    -- them before attendance rows; no audit/history row is retained here.
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

    -- audit_logs.entity_id is deliberately not an employee FK. Preserve the
    -- safe deletion event without retaining biometric data.
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

comment on function public.delete_employee(uuid) is
'Atomically permanently deletes an employee-owned application data set. Active-admin-only RPC; audit metadata excludes biometric data.';
