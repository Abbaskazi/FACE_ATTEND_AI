-- Fix the proven Migration 007 candidate-ranking ambiguity.
-- The existing RPC body is preserved; only references in the ranked CTE
-- projection are qualified so RETURNS TABLE.employee_id cannot collide.

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

    if position('(array_agg(employee_id order by candidate_rank))[1]' in v_definition) = 0 then
        raise exception 'expected ambiguous candidate-ranking expression was not found';
    end if;

    v_definition := replace(
        v_definition,
        E'select employee_id,\n               similarity,\n               row_number() over (order by similarity desc, employee_id) as candidate_rank,',
        E'select candidate_rows.employee_id,\n               candidate_rows.similarity,\n               row_number() over (order by candidate_rows.similarity desc, candidate_rows.employee_id) as candidate_rank,'
    );

    v_definition := replace(
        v_definition,
        E'          from candidates\n    )\n    select max(total_candidates),',
        E'          from candidates as candidate_rows\n    )\n    select max(ranked.total_candidates),'
    );

    v_definition := replace(
        v_definition,
        '(array_agg(employee_id order by candidate_rank))[1]',
        '(array_agg(ranked.employee_id order by ranked.candidate_rank))[1]'
    );

    v_definition := replace(
        v_definition,
        'max(similarity) filter (where candidate_rank = 1)',
        'max(ranked.similarity) filter (where ranked.candidate_rank = 1)'
    );

    v_definition := replace(
        v_definition,
        'max(similarity) filter (where candidate_rank = 2)',
        'max(ranked.similarity) filter (where ranked.candidate_rank = 2)'
    );

    if position('array_agg(employee_id order by candidate_rank)' in v_definition) > 0
        or position(E'from candidates\n    )\n    select max(total_candidates)' in v_definition) > 0 then
        raise exception 'candidate-ranking qualification was incomplete';
    end if;

    execute v_definition;
end
$migration$;
