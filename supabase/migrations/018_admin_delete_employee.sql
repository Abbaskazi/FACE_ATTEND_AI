-- FaceAttend AI
-- Permanently delete one employee and all application data owned by that employee.
-- The operation is deliberately exposed only through this admin-checked RPC.

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

    -- Lock the parent row before deleting dependents. This prevents a
    -- concurrent employee-owned insert from racing with this operation.
    select e.employee_code, e.full_name, d.name
      into v_employee_code, v_full_name, v_department_name
      from public.employees e
      left join public.departments d on d.id = e.department_id
     where e.id = p_employee_id
     for update of e;

    if not found then
        raise exception 'employee_not_found' using errcode = 'P0002';
    end if;

    -- Samples can be linked by either the employee or the employee's session.
    -- Delete them explicitly before sessions so this remains correct even if
    -- a historical row has inconsistent duplicated ownership metadata.
    delete from public.enrollment_samples
     where employee_id = p_employee_id
        or enrollment_session_id in (
            select id
            from public.enrollment_sessions
            where employee_id = p_employee_id
        );

    delete from public.biometric_templates
     where employee_id = p_employee_id;

    -- Events and attempts are removed when they identify the employee or are
    -- attached to one of the employee's attendance sessions.
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

    -- audit_logs.entity_id is intentionally not an FK, so the security record
    -- survives permanent employee deletion without retaining biometric data.
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

-- The function itself verifies public.is_active_admin() semantics using auth.uid().
-- Granting to authenticated permits the browser RPC call while still denying
-- anonymous and ordinary authenticated users inside the function.
grant execute on function public.delete_employee(uuid)
to authenticated;

comment on function public.delete_employee(uuid) is
'Atomically permanently deletes an employee-owned application data set. Active-admin-only RPC; audit metadata excludes biometric data.';
