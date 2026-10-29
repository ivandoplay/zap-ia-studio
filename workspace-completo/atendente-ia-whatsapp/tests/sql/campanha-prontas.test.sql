\set ON_ERROR_STOP on
\ir campanha-recuperacao-casos.test.sql
\ir ../../supabase/experimentos/20261029_campanha_prontas.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE p jsonb:='{"nome":"Agenda","chips":["slot_1"],"modoChips":"fixo","retomada":"manual","blocos":[{"id":"11111111-1111-4111-8111-111111111111","tipo":"texto","modo":"fixo","textos":["Olá"]}]}'::jsonb; cid uuid; n int;
BEGIN
 SELECT campanha_id INTO cid FROM public.ienvia_criar_campanha(p,jsonb_build_object('inicio_em',(clock_timestamp()+interval '1 hour')::text),'[{"telefone":"5586980000091"}]');
 PERFORM public.ienvia_alterar_status_campanha(cid,'ativa');
 SELECT count(*) INTO n FROM public.ienvia_campanha_prontas WHERE campanha_id=cid;IF n<>0 THEN RAISE EXCEPTION 'campanha agendada apareceu pronta';END IF;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 SELECT count(*) INTO n FROM public.ienvia_campanha_prontas WHERE campanha_id=cid;IF n<>0 THEN RAISE EXCEPTION 'outra conta viu campanha';END IF;
END $$;
RESET ROLE;
