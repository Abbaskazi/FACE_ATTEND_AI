-- FaceAttend AI
-- Phase 2 employee portal department display.
--
-- Employees already have an RLS-scoped employee row. This additive policy
-- exposes only the department attached to that same active employee row.
-- No department writes are granted.

drop policy if exists "Employees can view their own department" on public.departments;

create policy "Employees can view their own department"
on public.departments
for select
to authenticated
using (
    exists (
        select 1
          from public.employees e
         where e.department_id = public.departments.id
           and e.auth_user_id = auth.uid()
           and e.status = 'ACTIVE'
    )
);
