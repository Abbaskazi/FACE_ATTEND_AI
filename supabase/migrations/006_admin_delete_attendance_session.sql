-- FaceAttend AI
-- Allow only active authenticated admins to delete one attendance session.
-- Related events and attempt references use ON DELETE SET NULL and remain as
-- audit history.

drop policy if exists "Admins can delete attendance" on public.attendance;

create policy "Admins can delete attendance"
on public.attendance
for delete
to authenticated
using (public.is_active_admin());
