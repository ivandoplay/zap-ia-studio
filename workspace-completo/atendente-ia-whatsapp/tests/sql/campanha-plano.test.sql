\set ON_ERROR_STOP on
\ir campanha-destinatarios.test.sql
\ir ../../supabase/experimentos/20261029_campanha_planos.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
DO $$
DECLARE plano jsonb := '{"nome":"Teste","chips":["slot_1","slot_2"],"modoChips":"rodizio","retomada":"manual","blocos":[{"id":"11111111-1111-4111-8111-111111111111","tipo":"texto","modo":"fixo","textos":["Olá {{nome}}"]},{"id":"22222222-2222-4222-8222-222222222222","tipo":"texto","modo":"fixo","textos":["Segunda"]}]}'::jsonb;
 novo jsonb; cid uuid; a uuid; b uuid; n bigint; rev bigint;
BEGIN
 SELECT campanha_id INTO cid FROM public.ienvia_criar_campanha(plano,'{}'::jsonb,'[{"telefone":"5586982222222","nome":"A"},{"telefone":"5586983333333","nome":"B"}]'::jsonb);
 IF cid IS NULL THEN RAISE EXCEPTION 'não criou'; END IF;
 SELECT destinatario_id INTO a FROM public.ienvia_campanha_destinatarios WHERE campanha_id=cid AND nome='A';
 SELECT destinatario_id INTO b FROM public.ienvia_campanha_destinatarios WHERE campanha_id=cid AND nome='B';
 SELECT count(*) INTO n FROM public.ienvia_campanha_checkpoints WHERE campanha_id=cid AND bloco_id IS NOT NULL AND bloco_config IS NOT NULL;
 IF n<>4 THEN RAISE EXCEPTION 'não gravou blocos por destinatário'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_alterar_status_campanha(cid,'ativa'); IF n<>1 THEN RAISE EXCEPTION 'não iniciou'; END IF;
 SELECT revisao INTO rev FROM public.ienvia_campanha_proxima_etapa WHERE campanha_id=cid;
 SELECT count(*) INTO n FROM public.ienvia_reservar_campanha(cid,a,0,'40000000-0000-0000-0000-000000000150','{"slotId":"slot_2","bloco":{"tipo":"texto","texto":"Olá A"}}',rev);
 IF n<>0 THEN RAISE EXCEPTION 'chip divergente foi aceito'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_reservar_campanha(cid,a,0,'40000000-0000-0000-0000-000000000150','{"slotId":"slot_1","bloco":{"tipo":"audio","texto":"Olá A"}}',rev);
 IF n<>0 THEN RAISE EXCEPTION 'tipo divergente foi aceito'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_reservar_campanha(cid,a,0,'40000000-0000-0000-0000-000000000150','{"slotId":"slot_1","bloco":{"tipo":"texto","texto":"Olá A"}}',rev);
 IF n<>1 THEN RAISE EXCEPTION 'não reservou'; END IF;
 novo=jsonb_set(plano,'{blocos,1,textos,0}',to_jsonb('Segunda editada'::text));
 novo=jsonb_set(novo,'{blocos}',(novo->'blocos')||'{"id":"33333333-3333-4333-8333-333333333333","tipo":"texto","modo":"fixo","textos":["Terceira"]}'::jsonb);
 SELECT count(*) INTO n FROM public.ienvia_editar_plano_campanha(cid,novo); IF n<>1 THEN RAISE EXCEPTION 'não editou'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_campanha_checkpoints WHERE campanha_id=cid AND destinatario_id=a AND status='em_envio' AND material->'bloco'->>'texto'='Olá A'; IF n<>1 THEN RAISE EXCEPTION 'alterou envio já iniciado'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_campanha_checkpoints WHERE campanha_id=cid AND destinatario_id=b AND bloco_id='33333333-3333-4333-8333-333333333333'; IF n<>1 THEN RAISE EXCEPTION 'não editou restante de B'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_confirmar_etapa(cid,a,0,'40000000-0000-0000-0000-000000000150'); IF n<>1 THEN RAISE EXCEPTION 'não confirmou'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_campanha_proxima_etapa WHERE campanha_id=cid AND destinatario_id=a AND bloco_config->'textos'->>0='Segunda editada'; IF n<>1 THEN RAISE EXCEPTION 'não selecionou bloco editado'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_reservar_campanha(cid,a,1,'40000000-0000-0000-0000-000000000151','{"slotId":"slot_1","bloco":{"tipo":"texto","texto":"Segunda"}}',rev); IF n<>0 THEN RAISE EXCEPTION 'aceitou revisão desatualizada'; END IF;
 BEGIN PERFORM public.ienvia_editar_plano_campanha(cid,jsonb_set(novo,'{blocos,2,id}',to_jsonb('11111111-1111-4111-8111-111111111111'::text))); RAISE EXCEPTION 'id repetido aceito'; EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 SELECT count(*) INTO n FROM public.ienvia_editar_plano_campanha(cid,novo); IF n<>0 THEN RAISE EXCEPTION 'outra conta editou'; END IF;
END $$;
RESET ROLE;
