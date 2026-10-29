-- Execute num ambiente Postgres/Supabase de testes com privilégios para SET ROLE.
-- Testa a função real em tabela temporária; não altera contas reais e reverte tudo.
BEGIN;
CREATE TEMP TABLE teste_cota_chips (
  user_id uuid, username text, role text, is_active boolean, admin_notes text,
  customer_phone text, max_wa_slots integer, last_seen_at timestamptz
) ON COMMIT DROP;
CREATE TRIGGER teste_cota_chips_guard BEFORE INSERT OR UPDATE ON teste_cota_chips
  FOR EACH ROW EXECUTE FUNCTION public.prevent_zapia_users_privilege_escalation();
INSERT INTO teste_cota_chips VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','conta_sintetica','user',true,'','',1,now());
GRANT SELECT, INSERT, UPDATE ON teste_cota_chips TO authenticated, service_role;
DO $test$
DECLARE bloqueou_alteracao boolean := false; bloqueou_criacao boolean := false; n integer;
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    UPDATE pg_temp.teste_cota_chips SET max_wa_slots=3 WHERE username='conta_sintetica';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'Operacao negada:%' THEN bloqueou_alteracao := true; ELSE RAISE; END IF;
  END;
  IF NOT bloqueou_alteracao THEN RAISE EXCEPTION 'Falhou: cliente alterou a cota'; END IF;
  UPDATE pg_temp.teste_cota_chips SET last_seen_at=now() WHERE username='conta_sintetica';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'Falhou: atualizacao de login'; END IF;
  BEGIN
    INSERT INTO pg_temp.teste_cota_chips VALUES
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','conta_sintetica_2','user',true,'','',3,now());
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'Operacao negada:%' THEN bloqueou_criacao := true; ELSE RAISE; END IF;
  END;
  IF NOT bloqueou_criacao THEN RAISE EXCEPTION 'Falhou: cliente criou conta com cota elevada'; END IF;
  EXECUTE 'SET LOCAL ROLE service_role';
  UPDATE pg_temp.teste_cota_chips SET max_wa_slots=3 WHERE username='conta_sintetica';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'Falhou: servidor Master nao pode ajustar cota'; END IF;
  EXECUTE 'RESET ROLE';
END;
$test$;
ROLLBACK;
SELECT 'OK: bloqueio de cota e compatibilidade com login e Master' AS resultado;
