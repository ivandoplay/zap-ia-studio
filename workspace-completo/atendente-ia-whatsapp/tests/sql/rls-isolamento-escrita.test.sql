-- Executar em transação reversível, sem sockets nem envios. As duas contas devem existir e estar ativas.
BEGIN;
SET LOCAL lock_timeout = '2s';
DO $test$
DECLARE actors uuid[]; actor uuid; other uuid; tab text; n bigint; denied boolean; synthetic_chat text;
BEGIN
  SELECT array_agg(user_id) INTO actors FROM (SELECT user_id FROM public.zapia_users WHERE is_active ORDER BY user_id LIMIT 2) a;
  IF array_length(actors,1) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'Duas contas ativas necessárias'; END IF;
  EXECUTE 'SET LOCAL ROLE authenticated';
  FOREACH actor IN ARRAY actors LOOP
    other := CASE WHEN actor=actors[1] THEN actors[2] ELSE actors[1] END;
    PERFORM set_config('request.jwt.claim.sub',actor::text,true);
    FOREACH tab IN ARRAY ARRAY['zapia_users','zapia_commands','zapia_contacts','zapia_wa_runtime','zapia_wa_slots','zapia_worker_devices','zapia_workspaces'] LOOP
      EXECUTE format('UPDATE public.%I SET user_id = user_id WHERE user_id = $1',tab) USING other;
      GET DIAGNOSTICS n=ROW_COUNT;
      IF n<>0 THEN RAISE EXCEPTION 'UPDATE entre contas autorizado em %',tab; END IF;
    END LOOP;
    UPDATE public.zapia_users SET last_seen_at=last_seen_at WHERE user_id=actor;
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n<>1 THEN RAISE EXCEPTION 'UPDATE do perfil próprio não funcionou'; END IF;
    synthetic_chat := 'teste-rls-'||gen_random_uuid()::text;
    INSERT INTO public.zapia_contacts(user_id,chat_id,data) VALUES (actor,synthetic_chat,'{}'::jsonb);
    DELETE FROM public.zapia_contacts WHERE user_id=actor AND chat_id=synthetic_chat;
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n<>1 THEN RAISE EXCEPTION 'DELETE do contato sintético próprio falhou'; END IF;
    denied := false;
    BEGIN
      INSERT INTO public.zapia_contacts(user_id,chat_id,data) VALUES (other,synthetic_chat,'{}'::jsonb);
    EXCEPTION WHEN insufficient_privilege THEN denied := true;
    END;
    IF NOT denied THEN RAISE EXCEPTION 'INSERT entre contas foi autorizado'; END IF;
  END LOOP;
  EXECUTE 'RESET ROLE';
END;
$test$;
ROLLBACK;
SELECT 'OK: UPDATE entre contas negado em sete tabelas; INSERT cruzado negado; escrita própria testada e revertida' AS resultado;
