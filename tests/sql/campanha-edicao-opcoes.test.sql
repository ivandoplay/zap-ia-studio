\set ON_ERROR_STOP on
\ir campanha-media-plano.test.sql
\ir ../../supabase/experimentos/20261029_campanha_edicao.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE p jsonb:='{"nome":"Agendamento","chips":["slot_1"],"modoChips":"fixo","retomada":"manual","blocos":[{"id":"11111111-1111-4111-8111-111111111111","tipo":"texto","modo":"fixo","textos":["Olá"]}]}'::jsonb; cid uuid; n bigint; rev bigint;
BEGIN
 SELECT campanha_id INTO cid FROM public.ienvia_criar_campanha(p,'{}','[{"telefone":"5586980000012"}]');
 SELECT count(*) INTO n FROM public.ienvia_editar_configuracao_campanha(cid,p,'{"intervalo_min_ms":1000,"intervalo_max_ms":2000,"lote_min":8,"lote_max":12,"restricao_horaria":true,"dias":[1,2,3],"inicio":"09:00","fim":"18:00","fuso":"America/Fortaleza"}');IF n<>1 THEN RAISE EXCEPTION 'não editou';END IF;
 SELECT count(*) INTO n FROM public.ienvia_campanhas_controle WHERE campanha_id=cid AND intervalo_min_ms=1000 AND intervalo_max_ms=2000 AND lote_min=8 AND lote_max=12 AND restricao_horaria AND dias=ARRAY[1,2,3]::smallint[];IF n<>1 THEN RAISE EXCEPTION 'opções não salvas';END IF;
 SELECT revisao INTO rev FROM public.ienvia_campanhas_controle WHERE campanha_id=cid;
 BEGIN PERFORM public.ienvia_editar_configuracao_campanha(cid,jsonb_set(p,'{nome}',to_jsonb('Não deve gravar'::text)),'{"intervalo_min_ms":20000,"intervalo_max_ms":100}');RAISE EXCEPTION 'aceitou mínimo maior';EXCEPTION WHEN check_violation THEN NULL;END;
 SELECT count(*) INTO n FROM public.ienvia_campanhas_controle WHERE campanha_id=cid AND nome='Agendamento' AND revisao=rev;IF n<>1 THEN RAISE EXCEPTION 'edição parcial';END IF;
END $$;
RESET ROLE;
