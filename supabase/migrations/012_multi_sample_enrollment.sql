-- Safer enrollment robustness improvement.
--
-- Each employee may retain up to five normalized ArcFace templates captured
-- under the same model/preprocessing contract. Matching remains fail-closed:
-- templates are grouped by employee before the existing top-two decision is
-- applied, so two templates belonging to one employee cannot create an
-- artificial cross-employee ambiguity.
--
-- This migration does not alter existing templates or attendance data.

alter table public.biometric_templates
    drop constraint if exists biometric_templates_employee_id_key;

alter table public.biometric_templates
    add column if not exists sample_index smallint not null default 0;

alter table public.biometric_templates
    drop constraint if exists biometric_template_sample_index_valid;

alter table public.biometric_templates
    add constraint biometric_template_sample_index_valid
        check (sample_index between 0 and 4);

create unique index if not exists biometric_templates_employee_sample_index_key
    on public.biometric_templates(employee_id, sample_index);

create table if not exists public.enrollment_samples (
    id uuid primary key default gen_random_uuid(),
    enrollment_session_id uuid not null
        references public.enrollment_sessions(id)
        on delete cascade,
    employee_id uuid not null
        references public.employees(id)
        on delete restrict,
    sample_index smallint not null
        check (sample_index between 0 and 4),
    embedding vector(512) not null,
    model_name text not null,
    model_version text not null,
    embedding_dimension integer not null default 512
        check (embedding_dimension = 512),
    device_id uuid not null
        references public.attendance_devices(id)
        on delete restrict,
    created_at timestamptz not null default now(),
    unique (enrollment_session_id, sample_index)
);

create index if not exists enrollment_samples_employee_idx
    on public.enrollment_samples(employee_id);

alter table public.enrollment_samples enable row level security;
revoke all on table public.enrollment_samples from public, anon, authenticated, service_role;

create or replace function public.complete_enrollment_sample(
    p_token_hash text,
    p_embedding vector(512),
    p_model_name text,
    p_model_version text,
    p_device_id uuid,
    p_app_version text,
    p_sample_index integer
)
returns table (
    accepted_sample_index integer,
    sample_count integer,
    completed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
    c_required_samples constant integer := 5;
    c_norm_tolerance constant double precision := 0.02;
    v_session public.enrollment_sessions%rowtype;
    v_device_id uuid;
    v_sample_count integer;
    v_completed_at timestamptz;
begin
    if p_token_hash is null
        or length(btrim(p_token_hash)) <> 64
        or p_embedding is null
        or p_sample_index is null
        or p_sample_index not between 0 and c_required_samples - 1
        or p_model_name is null
        or length(btrim(p_model_name)) not between 1 and 100
        or p_model_version is null
        or length(btrim(p_model_version)) not between 1 and 100
        or p_app_version is null
        or length(btrim(p_app_version)) not between 1 and 100 then
        raise exception 'invalid_enrollment_sample_request' using errcode = '22023';
    end if;

    if vector_dims(p_embedding) <> 512
        or -(p_embedding <#> p_embedding) <= 0
        or abs((-(p_embedding <#> p_embedding)) - 1) > c_norm_tolerance then
        raise exception 'enrollment_embedding_contract_invalid' using errcode = '22023';
    end if;

    select *
      into v_session
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

    select d.id
      into v_device_id
      from public.attendance_devices d
     where d.id = p_device_id
       and d.is_active = true;
    if not found then
        raise exception 'unauthorized_enrollment_device' using errcode = '42501';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_session.employee_id::text, 0)
    );

    if not exists (
        select 1
          from public.employees e
         where e.id = v_session.employee_id
           and e.status = 'ACTIVE'
    ) then
        raise exception 'employee_not_active';
    end if;

    if exists (
        select 1
          from public.biometric_templates bt
         where bt.employee_id = v_session.employee_id
    ) then
        raise exception 'employee_already_enrolled';
    end if;

    insert into public.enrollment_samples (
        enrollment_session_id, employee_id, sample_index, embedding,
        model_name, model_version, embedding_dimension, device_id
    ) values (
        v_session.id, v_session.employee_id, p_sample_index, p_embedding,
        p_model_name, p_model_version, 512, v_device_id
    )
    on conflict (enrollment_session_id, sample_index) do update
        set embedding = excluded.embedding,
            model_name = excluded.model_name,
            model_version = excluded.model_version,
            embedding_dimension = excluded.embedding_dimension,
            device_id = excluded.device_id;

    select count(*)::integer
      into v_sample_count
      from public.enrollment_samples es
     where es.enrollment_session_id = v_session.id;

    if p_sample_index = c_required_samples - 1 then
        if v_sample_count <> c_required_samples then
            raise exception 'enrollment_samples_incomplete';
        end if;

        if exists (
            select 1
              from public.enrollment_samples es
             where es.enrollment_session_id = v_session.id
               and (
                   es.model_name <> p_model_name
                   or es.model_version <> p_model_version
                   or es.embedding_dimension <> 512
               )
        ) then
            raise exception 'enrollment_model_contract_mismatch';
        end if;

        insert into public.biometric_templates (
            employee_id, sample_index, embedding, model_name, model_version,
            embedding_dimension, enrolled_by
        )
        select es.employee_id, es.sample_index, es.embedding, es.model_name,
               es.model_version, es.embedding_dimension, v_session.created_by
          from public.enrollment_samples es
         where es.enrollment_session_id = v_session.id
         order by es.sample_index;

        v_completed_at := clock_timestamp();
        update public.enrollment_sessions
           set status = 'USED', used_at = v_completed_at
         where id = v_session.id
           and status = 'PENDING';
        if not found then
            raise exception 'enrollment_session_reused';
        end if;

        insert into public.audit_logs (
            actor_user_id, action, entity_type, entity_id, metadata
        ) values (
            v_session.created_by, 'EMPLOYEE_ENROLLED', 'biometric_template',
            v_session.employee_id,
            jsonb_build_object(
                'enrollment_session_id', v_session.id,
                'employee_id', v_session.employee_id,
                'device_id', p_device_id,
                'sample_count', c_required_samples,
                'model_name', p_model_name,
                'model_version', p_model_version,
                'app_version', p_app_version
            )
        );

        delete from public.enrollment_samples
         where enrollment_session_id = v_session.id;
    end if;

    return query select p_sample_index, v_sample_count, v_completed_at;
end;
$function$;

revoke all on function public.complete_enrollment_sample(
    text, vector(512), text, text, uuid, text, integer
) from public, anon, authenticated;
grant execute on function public.complete_enrollment_sample(
    text, vector(512), text, text, uuid, text, integer
) to service_role;

-- The existing attendance matcher is preserved except that templates are
-- reduced to one best score per employee before top-two safety checks.
do $migration$
declare
    v_definition text;
begin
    select pg_get_functiondef(p.oid)
      into v_definition
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'record_attendance_from_face'
       and pg_get_function_identity_arguments(p.oid) =
           'p_device_id uuid, p_request_id uuid, p_embedding vector, p_action text, p_model_name text, p_model_version text, p_app_version text, p_challenge_id uuid';

    if v_definition is null then
        raise exception 'record_attendance_from_face RPC was not found';
    end if;

    if position('from candidates as candidate_rows' in v_definition) = 0
        or position('from employee_candidates' in v_definition) > 0 then
        raise exception 'unexpected attendance matcher candidate query';
    end if;

    v_definition := replace(
        v_definition,
        E'    ), ranked as (\n        select candidate_rows.employee_id,\n               candidate_rows.similarity,\n               row_number() over (order by candidate_rows.similarity desc, candidate_rows.employee_id) as candidate_rank,\n               count(*) over ()::integer as total_candidates\n          from candidates as candidate_rows\n    )',
        E'    ), employee_candidates as (\n        select candidates.employee_id,\n               max(candidates.similarity) as similarity\n          from candidates\n         group by candidates.employee_id\n    ), ranked as (\n        select employee_candidates.employee_id,\n               employee_candidates.similarity,\n               row_number() over (order by employee_candidates.similarity desc, employee_candidates.employee_id) as candidate_rank,\n               count(*) over ()::integer as total_candidates\n          from employee_candidates\n    )'
    );

    if position('employee_candidates as' in v_definition) = 0 then
        raise exception 'employee-level candidate grouping was not applied';
    end if;

    execute v_definition;
end
$migration$;
