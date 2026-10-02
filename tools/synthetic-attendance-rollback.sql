-- Diagnostic-only SQL. The final exception rolls back every statement.
do $$
declare
  v_device uuid;
  v_a uuid;
  v_b uuid;
  v_a_vec vector(512);
  v_a2_vec vector(512);
  v_b_vec vector(512);
  v_out1 text;
  v_out2 text;
  v_out3 text;
  v_out4 text;
  v_out5 text;
  v_code1 text;
  v_code2 text;
  v_code3 text;
  v_code4 text;
  v_code5 text;
begin
  select id into v_device
    from public.attendance_devices
   where is_active = true
   order by id
   limit 1;

  if v_device is null then
    raise exception 'no active diagnostic device';
  end if;

  insert into public.employees(employee_code, full_name, status)
  values ('__DIAG_A_' || substr(gen_random_uuid()::text, 1, 8), 'Diagnostic Fixture A', 'ACTIVE')
  returning id into v_a;

  insert into public.employees(employee_code, full_name, status)
  values ('__DIAG_B_' || substr(gen_random_uuid()::text, 1, 8), 'Diagnostic Fixture B', 'ACTIVE')
  returning id into v_b;

  v_a_vec := ('[' || '1,' || repeat('0,', 510) || '0]')::vector(512);
  v_a2_vec := ('[' || '0.99,0.1410673593,' || repeat('0,', 509) || '0]')::vector(512);
  v_b_vec := ('[0,1,' || repeat('0,', 509) || '0]')::vector(512);

  insert into public.biometric_templates(
      employee_id, sample_index, embedding, model_name, model_version, embedding_dimension
  ) values
    (v_a, 0, v_a_vec, 'w600k_mbf.onnx', '9cc6e4a75f0e2bf0b1aed94578f144d15175f357bdc05e815e5c4a02b319eb4f', 512),
    (v_a, 1, v_a2_vec, 'w600k_mbf.onnx', '9cc6e4a75f0e2bf0b1aed94578f144d15175f357bdc05e815e5c4a02b319eb4f', 512),
    (v_b, 0, v_b_vec, 'w600k_mbf.onnx', '9cc6e4a75f0e2bf0b1aed94578f144d15175f357bdc05e815e5c4a02b319eb4f', 512);

  select r.outcome, e.employee_code into v_out1, v_code1
    from public.record_attendance_from_face(
      v_device, gen_random_uuid(), v_a_vec, 'CHECK_IN', 'w600k_mbf.onnx',
      '9cc6e4a75f0e2bf0b1aed94578f144d15175f357bdc05e815e5c4a02b319eb4f', 'diagnostic', null
    ) r left join public.employees e on e.id = r.employee_id;

  select r.outcome, e.employee_code into v_out2, v_code2
    from public.record_attendance_from_face(
      v_device, gen_random_uuid(), v_a_vec, 'CHECK_IN', 'w600k_mbf.onnx',
      '9cc6e4a75f0e2bf0b1aed94578f144d15175f357bdc05e815e5c4a02b319eb4f', 'diagnostic', null
    ) r left join public.employees e on e.id = r.employee_id;

  select r.outcome, e.employee_code into v_out3, v_code3
    from public.record_attendance_from_face(
      v_device, gen_random_uuid(), v_a_vec, 'CHECK_OUT', 'w600k_mbf.onnx',
      '9cc6e4a75f0e2bf0b1aed94578f144d15175f357bdc05e815e5c4a02b319eb4f', 'diagnostic', null
    ) r left join public.employees e on e.id = r.employee_id;

  select r.outcome, e.employee_code into v_out4, v_code4
    from public.record_attendance_from_face(
      v_device, gen_random_uuid(), v_a_vec, 'CHECK_OUT', 'w600k_mbf.onnx',
      '9cc6e4a75f0e2bf0b1aed94578f144d15175f357bdc05e815e5c4a02b319eb4f', 'diagnostic', null
    ) r left join public.employees e on e.id = r.employee_id;

  select r.outcome, e.employee_code into v_out5, v_code5
    from public.record_attendance_from_face(
      v_device, gen_random_uuid(), v_a_vec, 'CHECK_IN', 'w600k_mbf.onnx',
      '9cc6e4a75f0e2bf0b1aed94578f144d15175f357bdc05e815e5c4a02b319eb4f', 'diagnostic', null
    ) r left join public.employees e on e.id = r.employee_id;

  raise exception using
    errcode = 'P0001',
    message = json_build_object(
      'rolled_back', true,
      'multi_template_rows', 3,
      'results', json_build_array(
        json_build_object('step', 'CHECK_IN_1', 'outcome', v_out1, 'employee_code', v_code1),
        json_build_object('step', 'CHECK_IN_2', 'outcome', v_out2, 'employee_code', v_code2),
        json_build_object('step', 'CHECK_OUT_1', 'outcome', v_out3, 'employee_code', v_code3),
        json_build_object('step', 'CHECK_OUT_2', 'outcome', v_out4, 'employee_code', v_code4),
        json_build_object('step', 'CHECK_IN_3', 'outcome', v_out5, 'employee_code', v_code5)
      )
    )::text;
end;
$$;
