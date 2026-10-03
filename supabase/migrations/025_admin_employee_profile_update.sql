-- FaceAttend AI
-- Phase 4 follow-up: admin-only employee profile editing.
-- This operation changes profile fields only. Auth identity and password state
-- remain owned by the existing Phase 1/Phase 4 server operations.

-- Profile writes now go through the validated RPC below. Keep employee
-- creation available to active admins, but remove the broad browser UPDATE
-- policy so protected/system columns cannot be changed by crafted requests.
drop policy if exists "Admins can update employees" on public.employees;

create or replace function public.admin_update_employee_profile(
    p_employee_id uuid,
    p_employee_code text,
    p_full_name text,
    p_email text,
    p_phone text,
    p_department_id uuid,
    p_designation text,
    p_joining_date date,
    p_salary numeric,
    p_status public.employee_status
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
    v_actor_user_id uuid := auth.uid();
    v_old public.employees%rowtype;
    v_employee_code text := upper(btrim(coalesce(p_employee_code, '')));
    v_full_name text := btrim(coalesce(p_full_name, ''));
    v_email text := lower(btrim(coalesce(p_email, '')));
    v_phone text := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g');
    v_designation text := nullif(btrim(coalesce(p_designation, '')), '');
    v_changed_fields text[] := array[]::text[];
begin
    if v_actor_user_id is null or not public.is_active_admin() then
        raise exception 'admin_authorization_required' using errcode = '42501';
    end if;

    if p_employee_id is null then
        raise exception 'employee_id_required' using errcode = '22023';
    end if;
    if v_employee_code = '' then
        raise exception 'employee_code_required' using errcode = '22023';
    end if;
    if char_length(v_employee_code) > 64 then
        raise exception 'employee_code_invalid' using errcode = '22023';
    end if;
    if v_full_name = '' then
        raise exception 'full_name_required' using errcode = '22023';
    end if;
    if char_length(v_full_name) > 200 then
        raise exception 'full_name_invalid' using errcode = '22023';
    end if;
    if v_email = '' then
        raise exception 'employee_email_required' using errcode = '22023';
    end if;
    if v_email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$' then
        raise exception 'employee_email_invalid' using errcode = '22023';
    end if;
    if v_phone = '' then
        raise exception 'employee_phone_required' using errcode = '22023';
    end if;
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
    v_phone := '+91' || v_phone;
    if p_salary is null or p_salary < 0 or p_salary > 9999999999.99 or p_salary <> round(p_salary, 2) then
        raise exception 'employee_salary_invalid' using errcode = '22023';
    end if;
    if p_status is null then
        raise exception 'employee_status_invalid' using errcode = '22023';
    end if;
    if v_designation is not null and char_length(v_designation) > 200 then
        raise exception 'employee_designation_invalid' using errcode = '22023';
    end if;

    if p_department_id is not null and not exists (
        select 1 from public.departments where id = p_department_id
    ) then
        raise exception 'department_invalid' using errcode = '22023';
    end if;

    select * into v_old
      from public.employees
     where id = p_employee_id
     for update;
    if not found then
        raise exception 'employee_not_found' using errcode = 'P0002';
    end if;

    if exists (
        select 1 from public.employees
         where upper(employee_code) = v_employee_code
           and id <> p_employee_id
    ) then
        raise exception 'employee_code_already_in_use' using errcode = '23505';
    end if;

    if v_old.employee_code is distinct from v_employee_code then v_changed_fields := array_append(v_changed_fields, 'employee_code'); end if;
    if v_old.full_name is distinct from v_full_name then v_changed_fields := array_append(v_changed_fields, 'full_name'); end if;
    if v_old.email is distinct from v_email then v_changed_fields := array_append(v_changed_fields, 'email'); end if;
    if v_old.phone is distinct from v_phone then v_changed_fields := array_append(v_changed_fields, 'phone'); end if;
    if v_old.department_id is distinct from p_department_id then v_changed_fields := array_append(v_changed_fields, 'department_id'); end if;
    if v_old.designation is distinct from v_designation then v_changed_fields := array_append(v_changed_fields, 'designation'); end if;
    if v_old.joining_date is distinct from p_joining_date then v_changed_fields := array_append(v_changed_fields, 'joining_date'); end if;
    if v_old.salary is distinct from p_salary then v_changed_fields := array_append(v_changed_fields, 'salary'); end if;
    if v_old.status is distinct from p_status then v_changed_fields := array_append(v_changed_fields, 'status'); end if;

    update public.employees
       set employee_code = v_employee_code,
           full_name = v_full_name,
           email = v_email,
           phone = v_phone,
           department_id = p_department_id,
           designation = v_designation,
           joining_date = p_joining_date,
           salary = p_salary,
           status = p_status
     where id = p_employee_id;

    insert into public.audit_logs (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    ) values (
        v_actor_user_id,
        'UPDATE_EMPLOYEE',
        'employee',
        p_employee_id,
        jsonb_build_object('fields_changed', to_jsonb(v_changed_fields))
    );

    return p_employee_id;
end;
$function$;

revoke all on function public.admin_update_employee_profile(
    uuid, text, text, text, text, uuid, text, date, numeric, public.employee_status
)
from public, anon, authenticated;

grant execute on function public.admin_update_employee_profile(
    uuid, text, text, text, text, uuid, text, date, numeric, public.employee_status
)
to authenticated;

comment on function public.admin_update_employee_profile(
    uuid, text, text, text, text, uuid, text, date, numeric, public.employee_status
) is
'Active-admin-only profile update. Does not modify auth_user_id, password state, ownership, or timestamps supplied by the caller.';
