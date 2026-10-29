-- Somente leitura em duas contas ativas existentes; não cria, edita ou apaga dados.
-- Requer execução pelo administrador do projeto, em transação revertida.
BEGIN;
DO $test$
DECLARE actor uuid; actors uuid[]; t text; n bigint;
BEGIN
  SELECT array_agg(user_id) INTO actors FROM (SELECT user_id FROM public.zapia_users WHERE is_active ORDER BY user_id LIMIT 2) u;
  IF COALESCE(array_length(actors,1),0) < 2 THEN RAISE EXCEPTION 'São necessárias duas contas ativas para o teste'; END IF;
  EXECUTE 'SET LOCAL ROLE authenticated';
  FOREACH actor IN ARRAY actors LOOP
    PERFORM set_config('request.jwt.claim.sub',actor::text,true);
    IF auth.uid() IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Contexto de identidade incorreto'; END IF;
    SELECT count(*) INTO n FROM public.zapia_users WHERE user_id=actor;
    IF n<>1 THEN RAISE EXCEPTION 'Conta própria não está visível'; END IF;
    FOREACH t IN ARRAY ARRAY['zapia_users','zapia_commands','zapia_contacts','zapia_wa_runtime','zapia_wa_slots','zapia_worker_devices','zapia_workspaces'] LOOP
      EXECUTE format('SELECT count(*) FROM public.%I WHERE user_id <> $1',t) INTO n USING actor;
      IF n<>0 THEN RAISE EXCEPTION 'Isolamento de leitura falhou em %',t; END IF;
    END LOOP;
  END LOOP;
  EXECUTE 'RESET ROLE';
END;
$test$;
ROLLBACK;
SELECT 'OK: leitura de duas identidades isolada nas sete tabelas' AS resultado;
