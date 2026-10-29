\set ON_ERROR_STOP on
\ir campanha-remover-destinatario.test.sql
\ir ../../supabase/experimentos/20261029_campanha_falhas.sql
\ir ../../supabase/experimentos/20261029_campanha_falhas_view.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE p jsonb:='{"nome":"Falha","chips":["slot_1"],"modoChips":"fixo","retomada":"manual","blocos":[{"id":"11111111-1111-4111-8111-111111111111","tipo":"texto","modo":"fixo","textos":["Oi"]}]}'::jsonb;c uuid;n int;
BEGIN
 SELECT campanha_id INTO c FROM public.ienvia_criar_campanha(p,'{}','[{"telefone":"5586981000001"}]');PERFORM public.ienvia_alterar_status_campanha(c,'ativa');
 SELECT count(*) INTO n FROM public.ienvia_registrar_falha_campanha(c,'contato_restrito');IF n<>1 THEN RAISE EXCEPTION 'não pausou';END IF;
 SELECT count(*) INTO n FROM public.ienvia_campanhas_controle WHERE campanha_id=c AND status='pausada' AND falha_codigo='contato_restrito';IF n<>1 THEN RAISE EXCEPTION 'erro não gravado';END IF;
 SELECT count(*) INTO n FROM public.ienvia_campanha_proxima_falha WHERE campanha_id=c AND telefone='5586981000001';IF n<>1 THEN RAISE EXCEPTION 'pessoa pendente não visível';END IF;
 PERFORM public.ienvia_alterar_status_campanha(c,'ativa');
 SELECT count(*) INTO n FROM public.ienvia_campanhas_controle WHERE campanha_id=c AND status='ativa' AND falha_codigo IS NULL;IF n<>1 THEN RAISE EXCEPTION 'falha antiga não foi limpa';END IF;
 BEGIN PERFORM public.ienvia_registrar_falha_campanha(c,'SQL pessoal secreto');RAISE EXCEPTION 'código livre aceito';EXCEPTION WHEN check_violation THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 SELECT count(*) INTO n FROM public.ienvia_registrar_falha_campanha(c,'preparacao');IF n<>0 THEN RAISE EXCEPTION 'outra conta pausou';END IF;
END $$;
RESET ROLE;
