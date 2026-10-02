-- Restore the original single-sample enrollment contract.
--
-- Migration 012 added a five-template staging flow. That flow is no longer
-- active: the enrollment API and Android client use one validated embedding
-- and this migration enforces one active template per employee. Existing
-- templates are preserved; re-enrollment atomically replaces only the
-- selected employee's template after all validation succeeds.

do $migration$
begin
    if exists (
        select 1
          from public.biometric_templates
         group by employee_id
        having count(*) > 1
    ) then
        raise exception 'cannot_restore_single_template_contract_duplicate_employee_templates';
    end if;
end
$migration$;

create unique index if not exists biometric_templates_employee_single_active_key
    on public.biometric_templates(employee_id);

create or replace function public.create_enrollment_session(
    p_employee_id uuid,
    p_token_hash text,
    p_created_by uuid,
    p_expires_at timestamptz
)
returns table (
    session_id uuid,
    expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
    v_session_id uuid;
begin
    if p_employee_id is null
        or p_created_by is null
        or p_token_hash is null
        or length(btrim(p_token_hash)) <> 64
        or p_expires_at is null
        or p_expires_at <= now() then
        raise exception 'invalid_enrollment_session_request' using errcode = '22023';
    end if;

    if not exists (
        select 1
          from public.employees
         where id = p_employee_id
           and status = 'ACTIVE'
    ) then
        raise exception 'employee_not_active';
    end if;

    -- Re-enrollment is allowed; older pending capabilities are revoked.
    update public.enrollment_sessions
       set status = 'REVOKED'
     where employee_id = p_employee_id
       and status = 'PENDING';

    insert into public.enrollment_sessions (
        employee_id, token_hash, status, expires_at, created_by
    )
    values (
        p_employee_id, p_token_hash, 'PENDING', p_expires_at, p_created_by
    )
    returning id into v_session_id;

    insert into public.audit_logs (
        actor_user_id, action, entity_type, entity_id, metadata
    )
    values (
        p_created_by,
        'ENROLLMENT_SESSION_CREATED',
        'enrollment_session',
        v_session_id,
        jsonb_build_object('employee_id', p_employee_id, 'expires_at', p_expires_at)
    );

    return query select v_session_id, p_expires_at;
end;
$function$;

create or replace function public.complete_enrollment(
    p_token_hash text,
    p_embedding vector(512),
    p_model_name text,
    p_model_version text,
    p_device_id uuid,
    p_app_version text
)
returns table (
    completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
    v_session public.enrollment_sessions%rowtype;
    v_template_id uuid;
    v_completed_at timestamptz;
begin
    if p_token_hash is null
        or length(btrim(p_token_hash)) <> 64
        or p_embedding is null
        or p_model_name is null
        or length(btrim(p_model_name)) not between 1 and 100
        or p_model_version is null
        or length(btrim(p_model_version)) not between 1 and 100
        or p_device_id is null
        or p_app_version is null
        or length(btrim(p_app_version)) not between 1 and 100 then
        raise exception 'invalid_enrollment_request' using errcode = '22023';
    end if;

    if vector_dims(p_embedding) <> 512
        or -(p_embedding <#> p_embedding) <= 0
        or abs((-(p_embedding <#> p_embedding)) - 1) > 0.02 then
        raise exception 'enrollment_embedding_contract_invalid' using errcode = '22023';
    end if;

    select * into v_session
      from public.enrollment_sessions
     where token_hash = p_token_hash
     for update;

    if not found then raise exception 'enrollment_session_not_found'; end if;
    if v_session.status <> 'PENDING' then raise exception 'enrollment_session_reused'; end if;
    if v_session.expires_at <= now() then raise exception 'enrollment_session_expired'; end if;

    if not exists (
        select 1 from public.attendance_devices d
         where d.id = p_device_id and d.is_active = true
    ) then
        raise exception 'unauthorized_enrollment_device' using errcode = '42501';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_session.employee_id::text, 0)
    );

    if not exists (
        select 1 from public.employees e
         where e.id = v_session.employee_id and e.status = 'ACTIVE'
    ) then
        raise exception 'employee_not_active';
    end if;

    -- All validation precedes this atomic replacement. Any later failure
    -- rolls back and leaves the previous template untouched.
    insert into public.biometric_templates (
        employee_id, sample_index, embedding, model_name, model_version,
        embedding_dimension, enrolled_by
    )
    values (
        v_session.employee_id, 0, p_embedding, p_model_name, p_model_version,
        512, v_session.created_by
    )
    on conflict (employee_id) do update
        set sample_index = 0,
            embedding = excluded.embedding,
            model_name = excluded.model_name,
            model_version = excluded.model_version,
            embedding_dimension = excluded.embedding_dimension,
            enrolled_by = excluded.enrolled_by,
            updated_at = now()
    returning id into v_template_id;

    v_completed_at := clock_timestamp();
    update public.enrollment_sessions
       set status = 'USED', used_at = v_completed_at
     where id = v_session.id and status = 'PENDING';
    if not found then raise exception 'enrollment_session_reused'; end if;

    insert into public.audit_logs (
        actor_user_id, action, entity_type, entity_id, metadata
    )
    values (
        v_session.created_by,
        'EMPLOYEE_ENROLLED',
        'biometric_template',
        v_template_id,
        jsonb_build_object(
            'enrollment_session_id', v_session.id,
            'employee_id', v_session.employee_id,
            'device_id', p_device_id,
            'sample_count', 1,
            'model_name', p_model_name,
            'model_version', p_model_version,
            'app_version', p_app_version
        )
    );

    return query select v_completed_at;
end;
$function$;

revoke all on function public.create_enrollment_session(uuid, text, uuid, timestamptz)
from public, anon, authenticated;
grant execute on function public.create_enrollment_session(uuid, text, uuid, timestamptz)
to service_role;

revoke all on function public.complete_enrollment(text, vector(512), text, text, uuid, text)
from public, anon, authenticated;
grant execute on function public.complete_enrollment(text, vector(512), text, text, uuid, text)
to service_role;

-- Keep the Migration 012 objects for compatibility and historical data, but
-- remove the service-role entry point so the five-sample path cannot remain an
-- active enrollment API.
revoke all on function public.complete_enrollment_sample(
    text, vector(512), text, text, uuid, text, integer
) from public, anon, authenticated, service_role;
