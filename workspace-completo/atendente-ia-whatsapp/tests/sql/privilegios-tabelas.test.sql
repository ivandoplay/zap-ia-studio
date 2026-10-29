-- Verifica privilégios sem alterar dados ou assumir o papel de usuários reais.
DO $test$
DECLARE
  t text; r text; p text;
  nomes text[] := ARRAY['zapia_commands','zapia_contacts','zapia_users','zapia_wa_runtime','zapia_wa_slots','zapia_worker_devices','zapia_workspaces'];
BEGIN
  FOREACH t IN ARRAY nomes LOOP
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOREACH p IN ARRAY ARRAY['TRUNCATE','TRIGGER','REFERENCES','MAINTAIN'] LOOP
        IF has_table_privilege(r, 'public.' || t, p) THEN
          RAISE EXCEPTION 'Privilégio excessivo: papel %, tabela %, operação %', r, t, p;
        END IF;
      END LOOP;
    END LOOP;
    FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      IF NOT has_table_privilege('authenticated', 'public.' || t, p) THEN
        RAISE EXCEPTION 'CRUD do usuário autenticado alterado: tabela %, operação %', t, p;
      END IF;
      IF NOT has_table_privilege('service_role', 'public.' || t, p) THEN
        RAISE EXCEPTION 'CRUD administrativo alterado: tabela %, operação %', t, p;
      END IF;
    END LOOP;
  END LOOP;
END;
$test$;
SELECT 'OK: privilégios extra revogados; CRUD autenticado e service_role preservados' AS resultado;
