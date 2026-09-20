-- ============================================================
-- FaceAttend AI
-- Secure attendance backend phase 1
--
-- This migration is additive. It intentionally does not modify
-- 001_initial_schema.sql, its RLS policies, or the existing
-- match_employee_face function privileges.
-- ============================================================

-- ============================================================
-- ATTENDANCE DEVICES
--
-- A device is authenticated through Supabase Auth, but is not an
-- admin profile and must not inherit administrator table access.
-- ============================================================

create table public.attendance_devices (
    id uuid primary key default gen_random_uuid(),

    auth_user_id uuid not null unique
        references auth.users(id)
        on delete cascade,

    device_name text not null,

    is_active boolean not null default true,

    timezone text not null default 'UTC',

    last_seen_at timestamptz,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint attendance_devices_name_valid
        check (length(btrim(device_name)) between 1 and 200),

    constraint attendance_devices_timezone_valid
        check (length(btrim(timezone)) between 1 and 100)
);

create index idx_attendance_devices_active
    on public.attendance_devices(is_active);

create trigger attendance_devices_updated_at
before update on public.attendance_devices
for each row
execute function public.update_updated_at();


-- ============================================================
-- ATTENDANCE CHALLENGES
--
-- The challenge is optional in the phase-1 operation while the
-- challenge-issuance endpoint is being added. When supplied, the
-- private attendance function validates and consumes it atomically.
-- Only a hash of the nonce is stored.
-- ============================================================

create table public.attendance_challenges (
    id uuid primary key default gen_random_uuid(),

    device_id uuid not null
        references public.attendance_devices(id)
        on delete cascade,

    nonce_hash text not null unique,

    expires_at timestamptz not null,

    used_at timestamptz,

    created_at timestamptz not null default now(),

    constraint attendance_challenges_nonce_hash_valid
        check (length(btrim(nonce_hash)) between 32 and 256),

    constraint attendance_challenges_expiry_valid
        check (expires_at > created_at)
);

create index idx_attendance_challenges_device_expiry
    on public.attendance_challenges(device_id, expires_at);

create index idx_attendance_challenges_unused
    on public.attendance_challenges(device_id, used_at)
    where used_at is null;


-- ============================================================
-- ATTENDANCE ATTEMPTS
--
-- This table is the idempotency and backend-attempt ledger. It may
-- contain a null employee_id for a failed/unknown face match. It
-- never stores an embedding or a raw photograph.
-- ============================================================

create table public.attendance_attempts (
    id uuid primary key default gen_random_uuid(),

    device_id uuid not null
        references public.attendance_devices(id)
        on delete restrict,

    request_id uuid not null,

    challenge_id uuid
        references public.attendance_challenges(id)
        on delete set null,

    outcome text not null,

    employee_id uuid
        references public.employees(id)
        on delete set null,

    attendance_id uuid
        references public.attendance(id)
        on delete set null,

    verification_score numeric(6,5),

    model_name text not null,

    model_version text not null,

    app_version text not null,

    failure_code text,

    created_at timestamptz not null default now(),

    constraint attendance_attempts_device_request_unique
        unique (device_id, request_id),

    constraint attendance_attempts_outcome_valid
        check (outcome in ('CHECK_IN_RECORDED', 'CHECK_OUT_RECORDED', 'NOT_RECORDED')),

    constraint attendance_attempts_score_valid
        check (
            verification_score is null
            or (
                verification_score >= 0
                and verification_score <= 1
            )
        ),

    constraint attendance_attempts_model_name_valid
        check (length(btrim(model_name)) between 1 and 100),

    constraint attendance_attempts_model_version_valid
        check (length(btrim(model_version)) between 1 and 100),

    constraint attendance_attempts_app_version_valid
        check (length(btrim(app_version)) between 1 and 100),

    constraint attendance_attempts_failure_code_consistent
        check (
            (outcome = 'NOT_RECORDED' and failure_code is not null)
            or (outcome <> 'NOT_RECORDED' and failure_code is null)
        )
);

create index idx_attendance_attempts_device_created
    on public.attendance_attempts(device_id, created_at desc);

create index idx_attendance_attempts_challenge
    on public.attendance_attempts(challenge_id)
    where challenge_id is not null;

create index idx_attendance_attempts_employee_created
    on public.attendance_attempts(employee_id, created_at desc)
    where employee_id is not null;


-- ============================================================
-- RLS AND PRIVILEGES
--
-- There are intentionally no client policies. The service role is
-- used only inside the Edge Function runtime for device lookup,
-- rate-limit reads, and last-seen updates. Attendance writes and
-- biometric reads happen through the private function below.
-- ============================================================

alter table public.attendance_devices enable row level security;
alter table public.attendance_challenges enable row level security;
alter table public.attendance_attempts enable row level security;

revoke all on table public.attendance_devices from public, anon, authenticated;
revoke all on table public.attendance_challenges from public, anon, authenticated;
revoke all on table public.attendance_attempts from public, anon, authenticated;

-- Restrict the Edge Function's direct table access to the exact columns
-- it uses. The SECURITY DEFINER function remains the only write path for
-- attendance, attendance_events, and biometric_templates.
revoke all on table public.attendance_devices from service_role;
revoke all on table public.attendance_attempts from service_role;

grant select (id, auth_user_id, is_active, timezone)
    on table public.attendance_devices to service_role;
grant update (last_seen_at)
    on table public.attendance_devices to service_role;
grant select (id, device_id, request_id, outcome, created_at)
    on table public.attendance_attempts to service_role;


-- ============================================================
-- PRIVATE ATOMIC ATTENDANCE OPERATION
--
-- This function is deliberately not granted to anon or
-- authenticated. The attendance-submit Edge Function invokes it
-- with the server-only service_role credential.
--
-- It performs the match itself rather than exposing or calling the
-- existing public function from a client path. The model name and
-- version are used to prevent comparisons across incompatible
-- embedding models. The threshold is server-controlled and must be
-- calibrated before production use.
-- ============================================================

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
    server_time timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
    -- 0.60 is an initial operational placeholder, not a production
    -- decision. Calibrate it against genuine/impostor data first.
    c_similarity_threshold constant double precision := 0.60;

    v_now timestamptz := clock_timestamp();
    v_timezone text;
    v_attendance_date date;
    v_existing_attempt public.attendance_attempts%rowtype;
    v_challenge_id uuid;
    v_match_employee_id uuid;
    v_match_score double precision;
    v_employee_status public.employee_status;
    v_attendance_id uuid;
    v_check_in timestamptz;
    v_check_out timestamptz;
    v_working_minutes integer;
    v_outcome text;
    v_failure_code text;
begin
    -- Defense in depth: the Edge Function also validates these fields,
    -- but the database function must not trust an internal caller with
    -- malformed control values.
    if p_device_id is null
        or p_request_id is null
        or p_embedding is null
        or p_action is null
        or p_model_name is null
        or p_model_version is null
        or p_app_version is null then
        raise exception 'invalid attendance request'
            using errcode = '22023';
    end if;

    if p_action not in ('CHECK_IN', 'CHECK_OUT') then
        raise exception 'invalid attendance action'
            using errcode = '22023';
    end if;

    if length(btrim(p_model_name)) not between 1 and 100
        or length(btrim(p_model_version)) not between 1 and 100
        or length(btrim(p_app_version)) not between 1 and 100 then
        raise exception 'invalid model or app metadata'
            using errcode = '22023';
    end if;

    -- Device identity is server-derived by the Edge Function, then
    -- checked again here before any biometric work is performed.
    select d.timezone
      into v_timezone
      from public.attendance_devices d
     where d.id = p_device_id
       and d.is_active = true;

    if not found then
        raise exception 'unauthorized attendance device'
            using errcode = '42501';
    end if;

    if not exists (
        select 1
          from pg_catalog.pg_timezone_names tz
         where tz.name = v_timezone
    ) then
        raise exception 'invalid device timezone'
            using errcode = '22023';
    end if;

    v_attendance_date := (v_now at time zone v_timezone)::date;

    -- Serialize concurrent retries with the same idempotency key. A
    -- plain SELECT cannot lock a row that does not exist yet.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            p_device_id::text || ':' || p_request_id::text,
            0
        )
    );

    -- A retry returns the original minimal result and cannot perform a
    -- second check-in/check-out transition.
    select a.*
      into v_existing_attempt
      from public.attendance_attempts a
     where a.device_id = p_device_id
       and a.request_id = p_request_id;

    if found then
        return query
        select v_existing_attempt.outcome,
               v_existing_attempt.request_id,
               v_existing_attempt.created_at;
        return;
    end if;

    -- Challenge validation is ready for the challenge-issuance flow.
    -- Phase 1 permits a null challenge_id; once challenge issuance is
    -- enabled, the Edge Function should require this field.
    if p_challenge_id is not null then
        select c.id
          into v_challenge_id
          from public.attendance_challenges c
         where c.id = p_challenge_id
           and c.device_id = p_device_id
           and c.used_at is null
           and c.expires_at > v_now
         for update;

        if not found then
            insert into public.attendance_attempts (
                device_id,
                request_id,
                challenge_id,
                outcome,
                model_name,
                model_version,
                app_version,
                failure_code,
                created_at
            ) values (
                p_device_id,
                p_request_id,
                null,
                'NOT_RECORDED',
                p_model_name,
                p_model_version,
                p_app_version,
                'CHALLENGE_INVALID',
                v_now
            );

            return query
            select 'NOT_RECORDED'::text, p_request_id, v_now;
            return;
        end if;

        update public.attendance_challenges
           set used_at = v_now
         where id = v_challenge_id;
    end if;

    -- Internal 1:N match. No employee identity or score leaves this
    -- function. Only active employees and the requested model are
    -- eligible for comparison.
    select bt.employee_id,
           1 - (bt.embedding <=> p_embedding)
      into v_match_employee_id, v_match_score
      from public.biometric_templates bt
      join public.employees e
        on e.id = bt.employee_id
     where e.status = 'ACTIVE'
       and bt.model_name = p_model_name
       and bt.model_version = p_model_version
       and 1 - (bt.embedding <=> p_embedding) >= c_similarity_threshold
     order by bt.embedding <=> p_embedding
     limit 1;

    if not found then
        insert into public.attendance_attempts (
            device_id,
            request_id,
            challenge_id,
            outcome,
            verification_score,
            model_name,
            model_version,
            app_version,
            failure_code,
            created_at
        ) values (
            p_device_id,
            p_request_id,
            p_challenge_id,
            'NOT_RECORDED',
            null,
            p_model_name,
            p_model_version,
            p_app_version,
            'FACE_NOT_ACCEPTED',
            v_now
        );

        return query
        select 'NOT_RECORDED'::text, p_request_id, v_now;
        return;
    end if;

    -- Keep persisted scores inside the existing attendance_events
    -- constraint even if floating-point arithmetic produces a tiny
    -- value outside the mathematical cosine-similarity bounds.
    v_match_score := least(1::double precision, greatest(0::double precision, v_match_score));

    -- Re-check and lock the employee after matching so an activation
    -- change cannot be ignored by the attendance mutation.
    select e.status
      into v_employee_status
      from public.employees e
     where e.id = v_match_employee_id
     for update;

    if not found or v_employee_status <> 'ACTIVE' then
        insert into public.attendance_attempts (
            device_id,
            request_id,
            challenge_id,
            outcome,
            employee_id,
            verification_score,
            model_name,
            model_version,
            app_version,
            failure_code,
            created_at
        ) values (
            p_device_id,
            p_request_id,
            p_challenge_id,
            'NOT_RECORDED',
            v_match_employee_id,
            v_match_score::numeric(6,5),
            p_model_name,
            p_model_version,
            p_app_version,
            'FACE_NOT_ACCEPTED',
            v_now
        );

        return query
        select 'NOT_RECORDED'::text, p_request_id, v_now;
        return;
    end if;

    -- Refresh the server timestamp after the employee lock. This keeps
    -- the mutation and event timestamps accurate if matching or locking
    -- took noticeable time.
    v_now := clock_timestamp();
    v_attendance_date := (v_now at time zone v_timezone)::date;

    if p_action = 'CHECK_IN' then
        -- ON CONFLICT makes simultaneous first scans safe. The unique
        -- employee/date constraint remains the final duplicate guard.
        insert into public.attendance (
            employee_id,
            attendance_date,
            check_in,
            status,
            created_at,
            updated_at
        ) values (
            v_match_employee_id,
            v_attendance_date,
            v_now,
            'PRESENT',
            v_now,
            v_now
        )
        on conflict (employee_id, attendance_date) do nothing
        returning id into v_attendance_id;

        if v_attendance_id is null then
            select a.id, a.check_in, a.check_out
              into v_attendance_id, v_check_in, v_check_out
              from public.attendance a
             where a.employee_id = v_match_employee_id
               and a.attendance_date = v_attendance_date
             for update;

            v_outcome := 'NOT_RECORDED';
            v_failure_code := 'ATTENDANCE_NOT_AVAILABLE';

            insert into public.attendance_events (
                employee_id,
                attendance_id,
                event_type,
                occurred_at,
                verification_score,
                app_version,
                model_version,
                success,
                failure_reason,
                created_at
            ) values (
                v_match_employee_id,
                v_attendance_id,
                'CHECK_IN',
                v_now,
                v_match_score::numeric(6,5),
                p_app_version,
                p_model_version,
                false,
                v_failure_code,
                v_now
            );
        else
            v_outcome := 'CHECK_IN_RECORDED';
            v_failure_code := null;

            insert into public.attendance_events (
                employee_id,
                attendance_id,
                event_type,
                occurred_at,
                verification_score,
                app_version,
                model_version,
                success,
                failure_reason,
                created_at
            ) values (
                v_match_employee_id,
                v_attendance_id,
                'CHECK_IN',
                v_now,
                v_match_score::numeric(6,5),
                p_app_version,
                p_model_version,
                true,
                null,
                v_now
            );
        end if;
    else
        select a.id, a.check_in, a.check_out
          into v_attendance_id, v_check_in, v_check_out
          from public.attendance a
         where a.employee_id = v_match_employee_id
           and a.attendance_date = v_attendance_date
         for update;

        v_now := clock_timestamp();
        if v_check_in is not null and v_check_out is null then
            v_now := greatest(v_now, v_check_in);
        end if;

        if not found or v_check_in is null or v_check_out is not null then
            v_outcome := 'NOT_RECORDED';
            v_failure_code := 'ATTENDANCE_NOT_AVAILABLE';

            insert into public.attendance_events (
                employee_id,
                attendance_id,
                event_type,
                occurred_at,
                verification_score,
                app_version,
                model_version,
                success,
                failure_reason,
                created_at
            ) values (
                v_match_employee_id,
                v_attendance_id,
                'CHECK_OUT',
                v_now,
                v_match_score::numeric(6,5),
                p_app_version,
                p_model_version,
                false,
                v_failure_code,
                v_now
            );
        else
            v_working_minutes := greatest(
                0,
                floor(extract(epoch from (v_now - v_check_in)) / 60)::integer
            );

            update public.attendance
               set check_out = v_now,
                   working_minutes = v_working_minutes,
                   updated_at = v_now
             where id = v_attendance_id;

            v_outcome := 'CHECK_OUT_RECORDED';
            v_failure_code := null;

            insert into public.attendance_events (
                employee_id,
                attendance_id,
                event_type,
                occurred_at,
                verification_score,
                app_version,
                model_version,
                success,
                failure_reason,
                created_at
            ) values (
                v_match_employee_id,
                v_attendance_id,
                'CHECK_OUT',
                v_now,
                v_match_score::numeric(6,5),
                p_app_version,
                p_model_version,
                true,
                null,
                v_now
            );
        end if;
    end if;

    insert into public.attendance_attempts (
        device_id,
        request_id,
        challenge_id,
        outcome,
        employee_id,
        attendance_id,
        verification_score,
        model_name,
        model_version,
        app_version,
        failure_code,
        created_at
    ) values (
        p_device_id,
        p_request_id,
        p_challenge_id,
        v_outcome,
        v_match_employee_id,
        v_attendance_id,
        v_match_score::numeric(6,5),
        p_model_name,
        p_model_version,
        p_app_version,
        v_failure_code,
        v_now
    );

    return query
    select v_outcome, p_request_id, v_now;
end;
$function$;

comment on function public.record_attendance_from_face(
    uuid,
    uuid,
    vector(512),
    text,
    text,
    text,
    text,
    uuid
) is
'Private server-side attendance operation. Performs model-scoped 1:N matching, active-employee verification, atomic check-in/check-out, idempotency, and event recording. It must never be exposed to anon or normal authenticated clients.';

revoke all on function public.record_attendance_from_face(
    uuid,
    uuid,
    vector(512),
    text,
    text,
    text,
    text,
    uuid
) from public, anon, authenticated;

grant execute on function public.record_attendance_from_face(
    uuid,
    uuid,
    vector(512),
    text,
    text,
    text,
    text,
    uuid
) to service_role;
