-- Local development credentials only. The Supabase CLI applies this file on `start`/`reset`
-- before migrations and never on remote `db push` (which requires the explicit --include-roles flag).
do $$
begin
  if not exists (select from pg_roles where rolname = 'app_runtime') then
    execute $role$create role app_runtime login password 'app_runtime_local' nosuperuser nocreatedb nocreaterole nobypassrls$role$;
  else
    execute $role$alter role app_runtime login password 'app_runtime_local' nocreatedb nocreaterole nobypassrls$role$;
  end if;
end $$;
