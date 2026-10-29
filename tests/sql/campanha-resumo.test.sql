\set ON_ERROR_STOP on
\ir campanha-upload-limpeza.test.sql
\ir ../../supabase/experimentos/20261029_campanha_resumo.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE p jsonb:='{"nome":"Resumo","chips":["slot_1"],"modoChips":"fixo","retomada":"manual","blocos":[{"id":"11111111-1111-4111-8111-111111111111","tipo":"texto","modo":"fixo","textos":["Olá"]}]}'::jsonb; cid uuid; d uuid; rev bigint; n int;
BEGIN
 SELECT campanha_id INTO cid FROM public.ienvia_criar_campanha(p,'{}','[{"telefone":"5586980000021"},{"telefone":"5586980000022"}]');
 SELECT count(*) INTO n FROM public.ienvia_campanha_resumo WHERE campanha_id=cid AND total=2 AND concluidos=0 AND incertos=0;IF n<>1 THEN RAISE EXCEPTION 'resumo inicial';END IF;
 PERFORM public.ienvia_alterar_status_campanha(cid,'ativa');SELECT destinatario_id,revisao INTO d,rev FROM public.ienvia_campanha_proxima_etapa WHERE campanha_id=cid;
 PERFORM public.ienvia_reservar_campanha(cid,d,0,'40000000-0000-0000-0000-000000000158','{"slotId":"slot_1","bloco":{"tipo":"texto","texto":"Olá"}}',rev);
 PERFORM public.ienvia_confirmar_etapa(cid,d,0,'40000000-0000-0000-0000-000000000158');
 SELECT count(*) INTO n FROM public.ienvia_campanha_resumo WHERE campanha_id=cid AND total=2 AND concluidos=1 AND incertos=0;IF n<>1 THEN RAISE EXCEPTION 'resumo após confirmação';END IF;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 SELECT count(*) INTO n FROM public.ienvia_campanha_resumo WHERE campanha_id=cid;IF n<>0 THEN RAISE EXCEPTION 'vazamento de resumo';END IF;
END $$;
RESET ROLE;
