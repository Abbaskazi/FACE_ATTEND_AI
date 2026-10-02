-- Diagnostic-only calibration support.
-- Stores employee_code/similarity pairs for one-shot live samples.
-- No embeddings, images, attendance rows, or production decision rules are changed.

alter table public.attendance_match_diagnostics
    add column if not exists candidate_scores jsonb;

create or replace function public.diagnose_live_face_match(
    p_device_id uuid,
    p_request_id uuid,
    p_embedding vector(512),
    p_action text,
    p_model_name text,
    p_model_version text
)
returns table (
    claimed boolean,
    request_id uuid,
    candidate_count integer,
    top_employee_code text,
    top_score double precision,
    second_employee_code text,
    second_score double precision,
    score_margin double precision,
    threshold double precision,
    ambiguity_margin double precision,
    decision text,
    model_name text,
    model_version text,
    embedding_dimension integer,
    normalization_status text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
    c_threshold constant double precision := 0.60;
    c_ambiguity_margin constant double precision := 0.08;
    c_norm_tolerance constant double precision := 0.02;
    v_claim_id uuid;
    v_query_norm_squared double precision;
    v_candidate_count integer := 0;
    v_invalid_candidate_count integer := 0;
    v_top_employee_code text;
    v_top_score double precision;
    v_second_employee_code text;
    v_second_score double precision;
    v_score_margin double precision;
    v_candidate_scores jsonb := '[]'::jsonb;
    v_decision text;
    v_normalization_status text := 'VALID';
begin
    if p_device_id is null
        or p_request_id is null
        or p_embedding is null
        or p_action is null
        or p_model_name is null
        or p_model_version is null then
        raise exception 'invalid live match diagnostic request' using errcode = '22023';
    end if;

    if p_action not in ('CHECK_IN', 'CHECK_OUT') then
        raise exception 'invalid live match diagnostic action' using errcode = '22023';
    end if;

    if not exists (
        select 1
          from public.attendance_devices d
         where d.id = p_device_id
           and d.is_active = true
    ) then
        raise exception 'unauthorized attendance device' using errcode = '42501';
    end if;

    insert into public.attendance_match_diagnostics (
        claim_key, request_id, device_id, action, model_name, model_version,
        embedding_dimension, normalization_status, candidate_count,
        threshold, ambiguity_margin, decision
    ) values (
        'live-face-once', p_request_id, p_device_id, p_action, p_model_name, p_model_version,
        512, 'PENDING', 0, c_threshold, c_ambiguity_margin, 'PENDING'
    )
    on conflict (claim_key) do nothing
    returning id into v_claim_id;

    if v_claim_id is null then
        return query select
            false, p_request_id, 0, null::text, null::double precision,
            null::text, null::double precision, null::double precision,
            c_threshold, c_ambiguity_margin, 'DIAGNOSTIC_ALREADY_CLAIMED',
            p_model_name, p_model_version, 512, 'NOT_RUN';
        return;
    end if;

    v_query_norm_squared := -(p_embedding <#> p_embedding);
    if v_query_norm_squared is null
        or v_query_norm_squared <= 0
        or abs(v_query_norm_squared - 1) > c_norm_tolerance then
        v_normalization_status := 'INVALID_QUERY_NORMALIZATION';
        v_decision := 'NORMALIZATION_FAILURE';
    else
        select count(*) filter (
                   where vector_dims(bt.embedding) <> 512
                      or abs((-(bt.embedding <#> bt.embedding)) - 1) > c_norm_tolerance
               )::integer
          into v_invalid_candidate_count
          from public.biometric_templates bt
          join public.employees e on e.id = bt.employee_id
         where e.status = 'ACTIVE'
           and bt.model_name = p_model_name
           and bt.model_version = p_model_version;

        if v_invalid_candidate_count > 0 then
            v_normalization_status := 'INVALID_TEMPLATE_NORMALIZATION';
            v_decision := 'NORMALIZATION_FAILURE';
        else
            with candidates as (
                select e.employee_code,
                       1 - (bt.embedding <=> p_embedding) as similarity
                  from public.biometric_templates bt
                  join public.employees e on e.id = bt.employee_id
                 where e.status = 'ACTIVE'
                   and bt.model_name = p_model_name
                   and bt.model_version = p_model_version
            ), ranked as (
                select candidate_rows.employee_code,
                       candidate_rows.similarity,
                       row_number() over (
                           order by candidate_rows.similarity desc, candidate_rows.employee_code
                       ) as candidate_rank
                  from candidates as candidate_rows
            )
            select count(*)::integer,
                   (array_agg(ranked.employee_code order by ranked.candidate_rank))[1],
                   max(ranked.similarity) filter (where ranked.candidate_rank = 1),
                   (array_agg(ranked.employee_code order by ranked.candidate_rank))[2],
                   max(ranked.similarity) filter (where ranked.candidate_rank = 2),
                   coalesce(
                       jsonb_agg(
                           jsonb_build_object(
                               'employee_code', ranked.employee_code,
                               'similarity', ranked.similarity
                           ) order by ranked.candidate_rank
                       ),
                       '[]'::jsonb
                   )
              into v_candidate_count, v_top_employee_code, v_top_score,
                   v_second_employee_code, v_second_score, v_candidate_scores
              from ranked;

            v_candidate_count := coalesce(v_candidate_count, 0);
            v_score_margin := case
                when v_top_score is null or v_second_score is null then null
                else v_top_score - v_second_score
            end;

            if v_top_score is null then
                v_decision := 'NO_CANDIDATE';
            elsif v_top_score < c_threshold then
                v_decision := 'BELOW_THRESHOLD';
            elsif (v_second_score is not null and v_second_score >= c_threshold)
                or (v_score_margin is not null and v_score_margin <= c_ambiguity_margin) then
                v_decision := 'AMBIGUOUS_MATCH';
            else
                v_decision := 'ACCEPTED';
            end if;
        end if;
    end if;

    update public.attendance_match_diagnostics
       set normalization_status = v_normalization_status,
           candidate_count = v_candidate_count,
           top_employee_code = v_top_employee_code,
           top_score = v_top_score,
           second_employee_code = v_second_employee_code,
           second_score = v_second_score,
           score_margin = v_score_margin,
           candidate_scores = v_candidate_scores,
           decision = v_decision
     where id = v_claim_id;

    return query select
        true, p_request_id, v_candidate_count, v_top_employee_code, v_top_score,
        v_second_employee_code, v_second_score, v_score_margin,
        c_threshold, c_ambiguity_margin, v_decision,
        p_model_name, p_model_version, 512, v_normalization_status;
end;
$function$;

revoke all on function public.diagnose_live_face_match(
    uuid, uuid, vector(512), text, text, text
) from public, anon, authenticated;

grant execute on function public.diagnose_live_face_match(
    uuid, uuid, vector(512), text, text, text
) to service_role;
