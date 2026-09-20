-- ============================================================
-- FaceAttend AI
-- Secure employee enrollment backend
--
-- Additive only. Existing RLS policies and attendance functions remain
-- unchanged. These functions are the only server-side enrollment write path.
-- ============================================================

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
as $$
declare
    v_session_id uuid;
begin
    if length(btrim(p_token_hash)) <> 64 then
        raise exception 'invalid_enrollment_token_hash';
    end if;

    if p_expires_at <= now() then
        raise exception 'invalid_enrollment_expiry';
    end if;

    if not exists (
        select 1
        from public.employees
        where id = p_employee_id
          and status = 'ACTIVE'
    ) then
        raise exception 'employee_not_active';
    end if;

    if exists (
        select 1
        from public.biometric_templates
        where employee_id = p_employee_id
    ) then
        raise exception 'employee_already_enrolled';
    end if;

    -- Only one live capability is needed for an employee. Older pending
    -- capabilities are revoked before issuing a new one.
    update public.enrollment_sessions
    set status = 'REVOKED'
    where employee_id = p_employee_id
      and status = 'PENDING';

    insert into public.enrollment_sessions (
        employee_id,
        token_hash,
        status,
        expires_at,
        created_by
    )
    values (
        p_employee_id,
        p_token_hash,
        'PENDING',
        p_expires_at,
        p_created_by
    )
    returning id into v_session_id;

    insert into public.audit_logs (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
    )
    values (
        p_created_by,
        'ENROLLMENT_SESSION_CREATED',
        'enrollment_session',
        v_session_id,
        jsonb_build_object(
            'employee_id', p_employee_id,
            'expires_at', p_expires_at
        )
    );

    return query select v_session_id, p_expires_at;
end;
$$;


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
as $$
declare
    v_session public.enrollment_sessions%rowtype;
    v_template_id uuid;
    v_completed_at timestamptz;
begin
    select * into v_session
    from public.enrollment_sessions
    where token_hash = p_token_hash
    for update;

    if not found then
        raise exception 'enrollment_session_not_found';
    end if;

    if v_session.status <> 'PENDING' then
        raise exception 'enrollment_session_reused';
    end if;

    if v_session.expires_at <= now() then
        raise exception 'enrollment_session_expired';
    end if;

    -- Serialize enrollment attempts for the same employee. The existing
    -- unique employee_id constraint remains the final duplicate safeguard.
    perform pg_advisory_xact_lock(hashtext(v_session.employee_id::text));

    if not exists (
        select 1
        from public.employees
        where id = v_session.employee_id
          and status = 'ACTIVE'
    ) then
        raise exception 'employee_not_active';
    end if;

    if exists (
        select 1
        from public.biometric_templates
        where employee_id = v_session.employee_id
    ) then
        raise exception 'employee_already_enrolled';
    end if;

    insert into public.biometric_templates (
        employee_id,
        embedding,
        model_name,
        model_version,
        embedding_dimension,
        enrolled_by
    )
    values (
        v_session.employee_id,
        p_embedding,
        p_model_name,
        p_model_version,
        512,
        v_session.created_by
    )
    returning id into v_template_id;

    v_completed_at := now();

    update public.enrollment_sessions
    set status = 'USED', used_at = v_completed_at
    where id = v_session.id
      and status = 'PENDING';

    if not found then
        raise exception 'enrollment_session_reused';
    end if;

    insert into public.audit_logs (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        metadata
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
            'model_name', p_model_name,
            'model_version', p_model_version,
            'app_version', p_app_version
        )
    );

    return query select v_completed_at;
end;
$$;

revoke all on function public.create_enrollment_session(uuid, text, uuid, timestamptz)
from public, anon, authenticated;
grant execute on function public.create_enrollment_session(uuid, text, uuid, timestamptz)
to service_role;

revoke all on function public.complete_enrollment(text, vector(512), text, text, uuid, text)
from public, anon, authenticated;
grant execute on function public.complete_enrollment(text, vector(512), text, text, uuid, text)
to service_role;
