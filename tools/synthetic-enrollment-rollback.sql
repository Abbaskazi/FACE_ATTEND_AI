-- Diagnostic-only SQL. The final exception rolls back every statement.
do $$
declare
  v_device uuid;
  v_admin uuid;
  v_employee uuid;
  v_session uuid;
  v_token_hash text := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text);
  v_a_vec vector(512);
  v_sample_index integer;
  v_accepted_index integer;
  v_sample_count integer;
  v_completed_at timestamptz;
  v_template_count integer;
  v_staging_count integer;
begin
  select id into v_device
    from public.attendance_devices
   where is_active = true
   order by id
   limit 1;
  select id into v_admin
    from public.admin_profiles
   where is_active = true
   order by id
   limit 1;
  if v_device is null or v_admin is null then
    raise exception 'required diagnostic context is unavailable';
  end if;

  insert into public.employees(employee_code, full_name, status)
  values ('__DIAG_ENROLL_' || substr(gen_random_uuid()::text, 1, 8), 'Diagnostic Enrollment Fixture', 'ACTIVE')
  returning id into v_employee;

  insert into public.enrollment_sessions(employee_id, token_hash, status, expires_at, created_by)
  values (v_employee, v_token_hash, 'PENDING', now() + interval '1 hour', v_admin)
  returning id into v_session;

  v_a_vec := ('[' || '1,' || repeat('0,', 510) || '0]')::vector(512);

  for v_sample_index in 0..4 loop
    select accepted_sample_index, sample_count, completed_at
      into v_accepted_index, v_sample_count, v_completed_at
      from public.complete_enrollment_sample(
        v_token_hash,
        v_a_vec,
        'w600k_mbf.onnx',
        '9cc6e4a75f0e2bf0b1aed94578f144d15175f357bdc05e815e5c4a02b319eb4f',
        v_device,
        'diagnostic',
        v_sample_index
      );
    if v_accepted_index <> v_sample_index then
      raise exception 'sample index mismatch';
    end if;
  end loop;

  select count(*) into v_template_count
    from public.biometric_templates
   where employee_id = v_employee;
  select count(*) into v_staging_count
    from public.enrollment_samples
   where enrollment_session_id = v_session;

  raise exception using
    errcode = 'P0001',
    message = json_build_object(
      'rolled_back', true,
      'sample_count_returned', v_sample_count,
      'completed', v_completed_at is not null,
      'committed_template_count', v_template_count,
      'staging_rows_after_commit', v_staging_count
    )::text;
end;
$$;
