\set ON_ERROR_STOP on
\ir campanha-plano.test.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE p jsonb:='{"nome":"Retomada","chips":["slot_1"],"modoChips":"fixo","retomada":"manual","blocos":[{"id":"11111111-1111-4111-8111-111111111111","tipo":"texto","modo":"fixo","textos":["Olá"]}]}'::jsonb;
 cid uuid; d uuid; rev bigint; n bigint; m jsonb:='{"slotId":"slot_1","bloco":{"tipo":"texto","texto":"Olá"}}'::jsonb;
BEGIN
 SELECT campanha_id INTO cid FROM public.ienvia_criar_campanha(p,'{}','[{"telefone":"5586982222224"}]');
 SELECT destinatario_id INTO d FROM public.ienvia_campanha_destinatarios WHERE campanha_id=cid;
 PERFORM public.ienvia_alterar_status_campanha(cid,'ativa');
 SELECT revisao INTO rev FROM public.ienvia_campanha_proxima_etapa WHERE campanha_id=cid;
 SELECT count(*) INTO n FROM public.ienvia_reservar_campanha(cid,d,0,'40000000-0000-0000-0000-000000000155',m,rev);IF n<>1 THEN RAISE EXCEPTION 'primeira reserva falhou';END IF;
 PERFORM public.ienvia_marcar_etapa_incerta(cid,d,0,'40000000-0000-0000-0000-000000000155');
 PERFORM public.ienvia_resolver_etapa_incerta(cid,d,0,'40000000-0000-0000-0000-000000000155','nao_enviada');
 p:=jsonb_set(p,'{chips,0}',to_jsonb('slot_2'::text));
 PERFORM public.ienvia_editar_plano_campanha(cid,p);
 PERFORM public.ienvia_alterar_status_campanha(cid,'ativa');
 SELECT revisao INTO rev FROM public.ienvia_campanha_proxima_etapa WHERE campanha_id=cid;
 SELECT count(*) INTO n FROM public.ienvia_reservar_campanha(cid,d,0,'40000000-0000-0000-0000-000000000156',m,rev);
 IF n<>1 THEN RAISE EXCEPTION 'etapa previamente iniciada deve preservar material e chip'; END IF;
END $$;
RESET ROLE;
