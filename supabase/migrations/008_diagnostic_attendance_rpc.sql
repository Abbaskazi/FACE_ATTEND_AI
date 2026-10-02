-- Temporary, safe diagnostics for the attendance RPC.
-- This migration does not change attendance behavior or data. It only records
-- the execution stage and PostgreSQL error metadata in server logs, then
-- re-raises the original exception.

create or replace function public.record_attendance_from_face(
    p_device_id uuid,
    p_request_id uuid,
    p_embedding vector(512),
    p_action text,
    p_model_name text,
    p_model_version text,
    p_app_version text,
    p_challenge_id uuid default null
)
returns table (
    outcome text,
    request_id uuid,
    server_time timestamptz,
    employee_id uuid,
    attendance_id uuid,
    check_in_time timestamptz,
    check_out_time timestamptz,
    session_working_minutes integer,
    today_total_working_minutes integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
    c_similarity_threshold constant double precision := 0.60;
    c_ambiguity_margin constant double precision := 0.08;
    c_normalized_norm_tolerance constant double precision := 0.02;
    v_now timestamptz := clock_timestamp();
    v_timezone text;
    v_attendance_date date;
    v_existing_attempt public.attendance_attempts%rowtype;
    v_challenge_id uuid;
    v_match_employee_id uuid;
    v_match_score double precision;
    v_second_score double precision;
    v_score_margin double precision;
    v_candidate_count integer := 0;
    v_invalid_candidate_count integer := 0;
    v_query_norm_squared double precision;
    v_employee_status public.employee_status;
    v_attendance_id uuid;
    v_check_in timestamptz;
    v_check_out timestamptz;
    v_working_minutes integer;
    v_today_total integer;
    v_outcome text;
    v_failure_code text;
    v_stage text := 'INPUT_VALIDATION';
    v_sqlstate text;
    v_message text;
    v_table_name text;
    v_constraint_name text;
begin
    v_stage := 'INPUT_VALIDATION';
    if p_device_id is null
        or p_request_id is null
        or p_embedding is null
        or p_action is null
        or p_model_name is null
        or p_model_version is null
        or p_app_version is null then
        raise exception 'invalid attendance request' using errcode = '22023';
    end if;

    if p_action not in ('CHECK_IN', 'CHECK_OUT') then
        raise exception 'invalid attendance action' using errcode = '22023';
    end if;

    if length(btrim(p_model_name)) not between 1 and 100
        or length(btrim(p_model_version)) not between 1 and 100
        or length(btrim(p_app_version)) not between 1 and 100 then
        raise exception 'invalid model or app metadata' using errcode = '22023';
    end if;

    v_stage := 'DEVICE_AUTH';
    select d.timezone
      into v_timezone
      from public.attendance_devices d
     where d.id = p_device_id
       and d.is_active = true;

    if not found then
        raise exception 'unauthorized attendance device' using errcode = '42501';
    end if;

    if not exists (
        select 1 from pg_catalog.pg_timezone_names tz where tz.name = v_timezone
    ) then
        raise exception 'invalid device timezone' using errcode = '22023';
    end if;

    v_attendance_date := (v_now at time zone v_timezone)::date;

    v_stage := 'IDEMPOTENCY';
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_device_id::text || ':' || p_request_id::text, 0)
    );

    select a.*
      into v_existing_attempt
      from public.attendance_attempts a
     where a.device_id = p_device_id
       and a.request_id = p_request_id;

    if found then
        v_stage := 'RESPONSE';
        return query
        select v_existing_attempt.outcome,
               v_existing_attempt.request_id,
               v_existing_attempt.created_at,
               v_existing_attempt.employee_id,
               v_existing_attempt.attendance_id,
               v_existing_attempt.check_in_time,
               v_existing_attempt.check_out_time,
               v_existing_attempt.session_working_minutes,
               v_existing_attempt.today_total_working_minutes;
        return;
    end if;

    if p_challenge_id is not null then
        v_stage := 'CHALLENGE_VALIDATION';
        select c.id
          into v_challenge_id
          from public.attendance_challenges c
         where c.id = p_challenge_id
           and c.device_id = p_device_id
           and c.used_at is null
           and c.expires_at > v_now
         for update;

        if not found then
            v_stage := 'ATTEMPT_INSERT';
            insert into public.attendance_attempts (
                device_id, request_id, challenge_id, outcome,
                model_name, model_version, app_version, failure_code, created_at
            ) values (
                p_device_id, p_request_id, p_challenge_id, 'NOT_RECORDED',
                p_model_name, p_model_version, p_app_version, 'CHALLENGE_INVALID', v_now
            );
            v_stage := 'RESPONSE';
            return query select
                'NOT_RECORDED'::text, p_request_id, v_now, null::uuid, null::uuid,
                null::timestamptz, null::timestamptz, null::integer, null::integer;
            return;
        end if;

        update public.attendance_challenges set used_at = v_now where id = v_challenge_id;
    end if;

    v_stage := 'CANDIDATE_MATCH';
    v_query_norm_squared := -(p_embedding <#> p_embedding);
    if v_query_norm_squared is null
        or v_query_norm_squared <= 0
        or abs(v_query_norm_squared - 1) > c_normalized_norm_tolerance then
        v_stage := 'ATTEMPT_INSERT';
        insert into public.attendance_attempts (
            device_id, request_id, challenge_id, outcome, model_name,
            model_version, app_version, failure_code, created_at
        ) values (
            p_device_id, p_request_id, p_challenge_id, 'RECOGNITION_FAILED',
            p_model_name, p_model_version, p_app_version,
            'EMBEDDING_CONTRACT_INVALID', v_now
        );
        v_stage := 'RESPONSE';
        return query select
            'RECOGNITION_FAILED'::text, p_request_id, v_now, null::uuid, null::uuid,
            null::timestamptz, null::timestamptz, null::integer, null::integer;
        return;
    end if;

    select count(*) filter (
               where vector_dims(bt.embedding) <> 512
                  or abs((-(bt.embedding <#> bt.embedding)) - 1) > c_normalized_norm_tolerance
           )::integer
      into v_invalid_candidate_count
      from public.biometric_templates bt
      join public.employees e on e.id = bt.employee_id
     where e.status = 'ACTIVE'
       and bt.model_name = p_model_name
       and bt.model_version = p_model_version;

    if v_invalid_candidate_count > 0 then
        v_stage := 'ATTEMPT_INSERT';
        insert into public.attendance_attempts (
            device_id, request_id, challenge_id, outcome, model_name,
            model_version, app_version, failure_code, created_at
        ) values (
            p_device_id, p_request_id, p_challenge_id, 'RECOGNITION_FAILED',
            p_model_name, p_model_version, p_app_version,
            'CANDIDATE_CONTRACT_INVALID', v_now
        );
        v_stage := 'RESPONSE';
        return query select
            'RECOGNITION_FAILED'::text, p_request_id, v_now, null::uuid, null::uuid,
            null::timestamptz, null::timestamptz, null::integer, null::integer;
        return;
    end if;

    with candidates as (
        select bt.employee_id,
               1 - (bt.embedding <=> p_embedding) as similarity
          from public.biometric_templates bt
          join public.employees e on e.id = bt.employee_id
         where e.status = 'ACTIVE'
           and bt.model_name = p_model_name
           and bt.model_version = p_model_version
    ), ranked as (
        select employee_id,
               similarity,
               row_number() over (order by similarity desc, employee_id) as candidate_rank,
               count(*) over ()::integer as total_candidates
          from candidates
    )
    select max(total_candidates),
           (array_agg(employee_id order by candidate_rank))[1],
           max(similarity) filter (where candidate_rank = 1),
           max(similarity) filter (where candidate_rank = 2)
      into v_candidate_count, v_match_employee_id, v_match_score, v_second_score
      from ranked;

    v_candidate_count := coalesce(v_candidate_count, 0);
    v_score_margin := case
        when v_match_score is null or v_second_score is null then null
        else v_match_score - v_second_score
    end;

    if v_match_score is null or v_match_score < c_similarity_threshold then
        v_stage := 'ATTEMPT_INSERT';
        insert into public.attendance_attempts (
            device_id, request_id, challenge_id, outcome, verification_score,
            model_name, model_version, app_version, failure_code, created_at
        ) values (
            p_device_id, p_request_id, p_challenge_id, 'RECOGNITION_FAILED', null,
            p_model_name, p_model_version, p_app_version, 'FACE_NOT_ACCEPTED', v_now
        );
        v_stage := 'RESPONSE';
        return query select
            'RECOGNITION_FAILED'::text, p_request_id, v_now, null::uuid, null::uuid,
            null::timestamptz, null::timestamptz, null::integer, null::integer;
        return;
    end if;

    if (v_second_score is not null and v_second_score >= c_similarity_threshold)
        or (v_score_margin is not null and v_score_margin <= c_ambiguity_margin) then
        v_stage := 'ATTEMPT_INSERT';
        insert into public.attendance_attempts (
            device_id, request_id, challenge_id, outcome, verification_score,
            model_name, model_version, app_version, failure_code, created_at
        ) values (
            p_device_id, p_request_id, p_challenge_id, 'AMBIGUOUS_MATCH',
            null, p_model_name, p_model_version, p_app_version,
            'AMBIGUOUS_MATCH', v_now
        );
        v_stage := 'RESPONSE';
        return query select
            'AMBIGUOUS_MATCH'::text, p_request_id, v_now, null::uuid, null::uuid,
            null::timestamptz, null::timestamptz, null::integer, null::integer;
        return;
    end if;

    v_match_score := least(1::double precision, greatest(0::double precision, v_match_score));

    v_stage := 'EMPLOYEE_LOCK';
    select e.status
      into v_employee_status
      from public.employees e
     where e.id = v_match_employee_id
     for update;

    if not found or v_employee_status <> 'ACTIVE' then
        v_stage := 'ATTEMPT_INSERT';
        insert into public.attendance_attempts (
            device_id, request_id, challenge_id, outcome, employee_id,
            verification_score, model_name, model_version, app_version,
            failure_code, created_at
        ) values (
            p_device_id, p_request_id, p_challenge_id, 'RECOGNITION_FAILED', v_match_employee_id,
            v_match_score::numeric(6,5), p_model_name, p_model_version, p_app_version,
            'FACE_NOT_ACCEPTED', v_now
        );
        v_stage := 'RESPONSE';
        return query select
            'RECOGNITION_FAILED'::text, p_request_id, v_now, v_match_employee_id, null::uuid,
            null::timestamptz, null::timestamptz, null::integer, null::integer;
        return;
    end if;

    v_now := clock_timestamp();
    v_attendance_date := (v_now at time zone v_timezone)::date;

    if p_action = 'CHECK_IN' then
        v_stage := 'OPEN_SESSION_CHECK';
        select a.id, a.check_in
          into v_attendance_id, v_check_in
          from public.attendance a
         where a.employee_id = v_match_employee_id
           and a.attendance_date = v_attendance_date
           and a.check_out is null
         order by a.check_in desc
         limit 1
         for update;

        if found then
            v_outcome := 'ALREADY_CHECKED_IN';
            v_failure_code := 'ALREADY_CHECKED_IN';
        else
            v_stage := 'ATTENDANCE_INSERT';
            insert into public.attendance (
                employee_id, attendance_date, check_in, status, created_at, updated_at
            ) values (
                v_match_employee_id, v_attendance_date, v_now, 'PRESENT', v_now, v_now
            )
            returning id, check_in into v_attendance_id, v_check_in;
            v_outcome := 'CHECK_IN_RECORDED';
            v_failure_code := null;
        end if;

        v_stage := 'TOTAL_CALCULATION';
        select coalesce(sum(a.working_minutes), 0)::integer
          into v_today_total
          from public.attendance a
         where a.employee_id = v_match_employee_id
           and a.attendance_date = v_attendance_date
           and a.check_out is not null;

        v_stage := 'EVENT_INSERT';
        insert into public.attendance_events (
            employee_id, attendance_id, event_type, occurred_at, verification_score,
            app_version, model_version, success, failure_reason, created_at
        ) values (
            v_match_employee_id, v_attendance_id, 'CHECK_IN', v_now, v_match_score::numeric(6,5),
            p_app_version, p_model_version, v_outcome = 'CHECK_IN_RECORDED', v_failure_code, v_now
        );
    else
        v_stage := 'OPEN_SESSION_CHECK';
        select a.id, a.check_in
          into v_attendance_id, v_check_in
          from public.attendance a
         where a.employee_id = v_match_employee_id
           and a.attendance_date = v_attendance_date
           and a.check_out is null
         order by a.check_in desc
         limit 1
         for update;

        if not found then
            v_outcome := 'NOT_CHECKED_IN';
            v_failure_code := 'NOT_CHECKED_IN';
            v_stage := 'TOTAL_CALCULATION';
            select coalesce(sum(a.working_minutes), 0)::integer
              into v_today_total
              from public.attendance a
             where a.employee_id = v_match_employee_id
               and a.attendance_date = v_attendance_date
               and a.check_out is not null;
        else
            v_now := greatest(v_now, v_check_in);
            v_working_minutes := greatest(
                0, floor(extract(epoch from (v_now - v_check_in)) / 60)::integer
            );
            v_check_out := v_now;

            v_stage := 'ATTENDANCE_UPDATE';
            update public.attendance
               set check_out = v_check_out,
                   working_minutes = v_working_minutes,
                   updated_at = v_now
             where id = v_attendance_id;

            v_stage := 'TOTAL_CALCULATION';
            select coalesce(sum(a.working_minutes), 0)::integer
              into v_today_total
              from public.attendance a
             where a.employee_id = v_match_employee_id
               and a.attendance_date = v_attendance_date
               and a.check_out is not null;

            v_outcome := 'CHECK_OUT_RECORDED';
            v_failure_code := null;
        end if;

        v_stage := 'EVENT_INSERT';
        insert into public.attendance_events (
            employee_id, attendance_id, event_type, occurred_at, verification_score,
            app_version, model_version, success, failure_reason, created_at
        ) values (
            v_match_employee_id, v_attendance_id, 'CHECK_OUT', v_now, v_match_score::numeric(6,5),
            p_app_version, p_model_version, v_outcome = 'CHECK_OUT_RECORDED', v_failure_code, v_now
        );
    end if;

    v_stage := 'ATTEMPT_INSERT';
    insert into public.attendance_attempts (
        device_id, request_id, challenge_id, outcome, employee_id, attendance_id,
        verification_score, model_name, model_version, app_version, failure_code,
        created_at, check_in_time, check_out_time, session_working_minutes,
        today_total_working_minutes
    ) values (
        p_device_id, p_request_id, p_challenge_id, v_outcome, v_match_employee_id, v_attendance_id,
        v_match_score::numeric(6,5), p_model_name, p_model_version, p_app_version, v_failure_code,
        v_now, v_check_in, v_check_out, v_working_minutes, v_today_total
    );

    v_stage := 'RESPONSE';
    return query select
        v_outcome, p_request_id, v_now, v_match_employee_id, v_attendance_id,
        v_check_in, v_check_out, v_working_minutes, v_today_total;
exception when others then
    get stacked diagnostics
        v_sqlstate = returned_sqlstate,
        v_message = message_text,
        v_table_name = table_name,
        v_constraint_name = constraint_name;

    raise log 'attendance_rpc_diagnostic request_id=% stage=% sqlstate=% table=% constraint=% message=%',
        coalesce(p_request_id::text, 'none'),
        v_stage,
        coalesce(v_sqlstate, 'none'),
        coalesce(v_table_name, 'none'),
        coalesce(v_constraint_name, 'none'),
        left(regexp_replace(coalesce(v_message, 'none'), '[[:cntrl:]]', ' ', 'g'), 240);
    raise;
end;
$function$;

comment on function public.record_attendance_from_face(
    uuid, uuid, vector(512), text, text, text, text, uuid
) is
'Private attendance operation with temporary safe stage/error diagnostics. The diagnostic handler re-raises the original error and does not alter attendance behavior.';

revoke all on function public.record_attendance_from_face(
    uuid, uuid, vector(512), text, text, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.record_attendance_from_face(
    uuid, uuid, vector(512), text, text, text, text, uuid
) to service_role;
