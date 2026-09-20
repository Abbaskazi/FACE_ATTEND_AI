-- ============================================================
-- FaceAttend AI
-- Initial Database Schema
-- ============================================================

-- ============================================================
-- EXTENSIONS
-- ============================================================

create extension if not exists "pgcrypto";
create extension if not exists "vector";


-- ============================================================
-- ENUM TYPES
-- ============================================================

create type public.employee_status as enum (
    'ACTIVE',
    'INACTIVE',
    'SUSPENDED'
);

create type public.attendance_status as enum (
    'PRESENT',
    'ABSENT',
    'HALF_DAY',
    'LEAVE'
);

create type public.enrollment_status as enum (
    'PENDING',
    'USED',
    'EXPIRED',
    'REVOKED'
);

create type public.attendance_event_type as enum (
    'CHECK_IN',
    'CHECK_OUT',
    'VERIFICATION'
);


-- ============================================================
-- DEPARTMENTS
-- ============================================================

create table public.departments (
    id uuid primary key default gen_random_uuid(),

    name text not null unique,

    code text not null unique,

    description text,

    is_active boolean not null default true,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now()
);


-- ============================================================
-- ADMIN PROFILES
-- One admin role only.
-- Connected to Supabase Auth.
-- ============================================================

create table public.admin_profiles (
    id uuid primary key references auth.users(id) on delete cascade,

    full_name text not null,

    is_active boolean not null default true,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now()
);


-- ============================================================
-- EMPLOYEES
-- Employees do not require Supabase Auth accounts.
-- ============================================================

create table public.employees (
    id uuid primary key default gen_random_uuid(),

    employee_code text not null unique,

    full_name text not null,

    email text,

    phone text,

    department_id uuid references public.departments(id)
        on delete set null,

    designation text,

    joining_date date,

    status public.employee_status not null default 'ACTIVE',

    created_by uuid references public.admin_profiles(id)
        on delete set null,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now()
);


-- ============================================================
-- BIOMETRIC TEMPLATES
-- Stores face embeddings, NOT raw face photographs.
--
-- 512 must match the final ArcFace model output.
-- ============================================================

create table public.biometric_templates (
    id uuid primary key default gen_random_uuid(),

    employee_id uuid not null unique
        references public.employees(id)
        on delete restrict,

    embedding vector(512) not null,

    model_name text not null,

    model_version text not null,

    embedding_dimension integer not null default 512,

    enrolled_by uuid references public.admin_profiles(id)
        on delete set null,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint biometric_embedding_dimension_valid
        check (embedding_dimension = 512)
);


-- ============================================================
-- VECTOR INDEX
-- Used for fast face similarity search.
-- ============================================================

create index idx_biometric_templates_embedding
on public.biometric_templates
using hnsw (embedding vector_cosine_ops);


-- ============================================================
-- ENROLLMENT SESSIONS
-- Admin authorizes employee enrollment.
-- ============================================================

create table public.enrollment_sessions (
    id uuid primary key default gen_random_uuid(),

    employee_id uuid not null
        references public.employees(id)
        on delete restrict,

    token_hash text not null unique,

    status public.enrollment_status not null default 'PENDING',

    expires_at timestamptz not null,

    used_at timestamptz,

    created_by uuid not null
        references public.admin_profiles(id)
        on delete restrict,

    created_at timestamptz not null default now()
);


-- ============================================================
-- ATTENDANCE
-- One attendance record per employee per day.
-- ============================================================

create table public.attendance (
    id uuid primary key default gen_random_uuid(),

    employee_id uuid not null
        references public.employees(id)
        on delete restrict,

    attendance_date date not null,

    check_in timestamptz,

    check_out timestamptz,

    status public.attendance_status not null default 'PRESENT',

    working_minutes integer,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint unique_employee_attendance_per_day
        unique (employee_id, attendance_date),

    constraint working_minutes_non_negative
        check (
            working_minutes is null
            or working_minutes >= 0
        ),

    constraint check_out_after_check_in
        check (
            check_out is null
            or check_in is null
            or check_out >= check_in
        )
);


-- ============================================================
-- ATTENDANCE EVENTS
-- Records verification attempts and attendance actions.
-- ============================================================

create table public.attendance_events (
    id uuid primary key default gen_random_uuid(),

    employee_id uuid not null
        references public.employees(id)
        on delete restrict,

    attendance_id uuid references public.attendance(id)
        on delete set null,

    event_type public.attendance_event_type not null,

    occurred_at timestamptz not null default now(),

    verification_score numeric(6,5),

    app_version text,

    model_version text,

    success boolean not null,

    failure_reason text,

    created_at timestamptz not null default now(),

    constraint verification_score_range
        check (
            verification_score is null
            or (
                verification_score >= 0
                and verification_score <= 1
            )
        )
);


-- ============================================================
-- AUDIT LOGS
-- Records important admin actions.
-- ============================================================

create table public.audit_logs (
    id uuid primary key default gen_random_uuid(),

    actor_user_id uuid
        references public.admin_profiles(id)
        on delete set null,

    action text not null,

    entity_type text,

    entity_id uuid,

    metadata jsonb,

    ip_address inet,

    user_agent text,

    created_at timestamptz not null default now()
);


-- ============================================================
-- INDEXES
-- ============================================================

create index idx_employees_department
    on public.employees(department_id);

create index idx_employees_status
    on public.employees(status);

create index idx_attendance_employee
    on public.attendance(employee_id);

create index idx_attendance_date
    on public.attendance(attendance_date);

create index idx_attendance_employee_date
    on public.attendance(employee_id, attendance_date);

create index idx_attendance_events_employee
    on public.attendance_events(employee_id);

create index idx_attendance_events_occurred_at
    on public.attendance_events(occurred_at);

create index idx_audit_logs_actor
    on public.audit_logs(actor_user_id);

create index idx_audit_logs_created_at
    on public.audit_logs(created_at);

create index idx_enrollment_employee
    on public.enrollment_sessions(employee_id);

create index idx_enrollment_status
    on public.enrollment_sessions(status);


-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

create or replace function public.update_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;


create trigger departments_updated_at
before update on public.departments
for each row
execute function public.update_updated_at();


create trigger admin_profiles_updated_at
before update on public.admin_profiles
for each row
execute function public.update_updated_at();


create trigger employees_updated_at
before update on public.employees
for each row
execute function public.update_updated_at();


create trigger biometric_templates_updated_at
before update on public.biometric_templates
for each row
execute function public.update_updated_at();


create trigger attendance_updated_at
before update on public.attendance
for each row
execute function public.update_updated_at();


-- ============================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================

alter table public.departments enable row level security;

alter table public.admin_profiles enable row level security;

alter table public.employees enable row level security;

alter table public.biometric_templates enable row level security;

alter table public.enrollment_sessions enable row level security;

alter table public.attendance enable row level security;

alter table public.attendance_events enable row level security;

alter table public.audit_logs enable row level security;


-- ============================================================
-- FACE MATCHING FUNCTION
-- ============================================================
-- Searches enrolled face embeddings using cosine similarity.
--
-- This function is intentionally NOT granted to anonymous users.
-- Controlled access will be added through the attendance service.
-- ============================================================

create or replace function public.match_employee_face(
    query_embedding vector(512),
    similarity_threshold double precision default 0.60
)
returns table (
    employee_id uuid,
    employee_code text,
    full_name text,
    similarity double precision
)
language sql
security definer
set search_path = public
as $$
    select
        e.id as employee_id,
        e.employee_code,
        e.full_name,
        1 - (bt.embedding <=> query_embedding) as similarity
    from public.biometric_templates bt
    join public.employees e
        on e.id = bt.employee_id
    where e.status = 'ACTIVE'
      and 1 - (bt.embedding <=> query_embedding) >= similarity_threshold
    order by bt.embedding <=> query_embedding
    limit 1;
$$;


-- ============================================================
-- RLS HELPER FUNCTION
-- ============================================================

create or replace function public.is_active_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
    select exists (
        select 1
        from public.admin_profiles
        where id = auth.uid()
          and is_active = true
    );
$$;


-- ============================================================
-- ADMIN RLS POLICIES
-- ============================================================

create policy "Admins can view departments"
on public.departments
for select
to authenticated
using (public.is_active_admin());


create policy "Admins can insert departments"
on public.departments
for insert
to authenticated
with check (public.is_active_admin());


create policy "Admins can update departments"
on public.departments
for update
to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());


create policy "Admins can view employees"
on public.employees
for select
to authenticated
using (public.is_active_admin());


create policy "Admins can insert employees"
on public.employees
for insert
to authenticated
with check (public.is_active_admin());


create policy "Admins can update employees"
on public.employees
for update
to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());


create policy "Admins can view enrollment sessions"
on public.enrollment_sessions
for select
to authenticated
using (public.is_active_admin());


create policy "Admins can create enrollment sessions"
on public.enrollment_sessions
for insert
to authenticated
with check (public.is_active_admin());


create policy "Admins can update enrollment sessions"
on public.enrollment_sessions
for update
to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());


create policy "Admins can view attendance"
on public.attendance
for select
to authenticated
using (public.is_active_admin());


create policy "Admins can update attendance"
on public.attendance
for update
to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());


create policy "Admins can view attendance events"
on public.attendance_events
for select
to authenticated
using (public.is_active_admin());


create policy "Admins can view audit logs"
on public.audit_logs
for select
to authenticated
using (public.is_active_admin());


-- ============================================================
-- ADMIN PROFILE POLICY
-- ============================================================

create policy "Admins can view their own profile"
on public.admin_profiles
for select
to authenticated
using (id = auth.uid());


-- ============================================================
-- FACE MATCHING FUNCTION ACCESS
-- ============================================================
-- No anonymous or normal authenticated access.
-- Access will be granted later through the controlled
-- attendance backend/service.
-- ============================================================

revoke all
on function public.match_employee_face(vector(512), double precision)
from public;

revoke all
on function public.match_employee_face(vector(512), double precision)
from anon;

revoke all
on function public.match_employee_face(vector(512), double precision)
from authenticated;