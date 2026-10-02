-- ============================================================
-- Employee salary
-- ============================================================
-- Salary is an admin-only employee attribute. Existing employees
-- receive the database default of zero when this column is added.

do $$
begin
    if not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'employees'
          and column_name = 'salary'
    ) then
        alter table public.employees
            add column salary numeric(12,2) not null default 0;
    else
        -- Keep this migration safe if salary was added outside this file.
        update public.employees
        set salary = 0
        where salary is null;

        alter table public.employees
            alter column salary set default 0,
            alter column salary set not null;
    end if;
end;
$$;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'employees_salary_non_negative'
          and conrelid = 'public.employees'::regclass
    ) then
        alter table public.employees
            add constraint employees_salary_non_negative
            check (salary >= 0);
    end if;
end;
$$;
