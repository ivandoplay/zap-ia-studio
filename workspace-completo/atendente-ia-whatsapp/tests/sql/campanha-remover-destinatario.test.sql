\set ON_ERROR_STOP on
\ir campanha-recuperacao-lote.test.sql
\ir ../../supabase/experimentos/20261029_campanha_remocao_destinatarios.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE p jsonb:='{"nome":"Lista segura","chips":["slot_1"],"modoChips":"fixo","retomada":"manual","blocos":[{"id":"11111111-1111-4111-8111-111111111111","tipo":"texto","modo":"fixo","textos":["Oi"]}]}'::jsonb; c uuid; d1 uuid;d2 uuid;rev bigint;n int;w uuid:='77777777-7777-4777-8777-777777777777';
BEGIN
 SELECT campanha_id INTO c FROM public.ienvia_criar_campanha(p,'{}','[{"telefone":"5586981000001"},{"telefone":"5586981000002"}]');
 SELECT destinatario_id INTO d1 FROM public.ienvia_campanha_destinatarios WHERE campanha_id=c AND ordem=1;
 SELECT destinatario_id INTO d2 FROM public.ienvia_campanha_destinatarios WHERE campanha_id=c AND ordem=2;
 PERFORM public.ienvia_alterar_status_campanha(c,'ativa');PERFORM public.ienvia_registrar_worker_campanha(w,'ficticio');
 SELECT revisao INTO rev FROM public.ienvia_campanhas_controle WHERE campanha_id=c;
 PERFORM public.ienvia_reservar_worker_campanha(c,d1,0,'88888888-8888-4888-8888-888888888888','{"slotId":"slot_1","bloco":{"tipo":"texto","texto":"Oi"}}',rev,w);
 SELECT count(*) INTO n FROM public.ienvia_remover_destinatario_campanha(c,d1);IF n<>0 THEN RAISE EXCEPTION 'removeu etapa iniciada';END IF;
 SELECT count(*) INTO n FROM public.ienvia_remover_destinatario_campanha(c,d2);IF n<>1 THEN RAISE EXCEPTION 'não removeu pendente';END IF;
 SELECT count(*) INTO n FROM public.ienvia_campanha_destinatarios WHERE campanha_id=c AND destinatario_id=d2 AND excluido;IF n<>1 THEN RAISE EXCEPTION 'destinatário não marcado excluído';END IF;
 SELECT count(*) INTO n FROM public.ienvia_campanha_checkpoints WHERE campanha_id=c AND destinatario_id=d2;IF n<>0 THEN RAISE EXCEPTION 'etapas permanecem';END IF;
 SELECT count(*) INTO n FROM public.ienvia_campanhas_controle WHERE campanha_id=c AND revisao>rev;IF n<>1 THEN RAISE EXCEPTION 'revisão não mudou';END IF;
 -- Completar uma pessoa e remover a última pendente deve concluir a campanha.
 SELECT campanha_id INTO c FROM public.ienvia_criar_campanha(p,'{}','[{"telefone":"5586981000003"},{"telefone":"5586981000004"}]');
 SELECT destinatario_id INTO d1 FROM public.ienvia_campanha_destinatarios WHERE campanha_id=c AND ordem=1;
 SELECT destinatario_id INTO d2 FROM public.ienvia_campanha_destinatarios WHERE campanha_id=c AND ordem=2;
 PERFORM public.ienvia_alterar_status_campanha(c,'ativa');SELECT revisao INTO rev FROM public.ienvia_campanhas_controle WHERE campanha_id=c;
 PERFORM public.ienvia_reservar_worker_campanha(c,d1,0,'99999999-9999-4999-8999-999999999999','{"slotId":"slot_1","bloco":{"tipo":"texto","texto":"Oi"}}',rev,w);
 PERFORM public.ienvia_confirmar_etapa(c,d1,0,'99999999-9999-4999-8999-999999999999');
 PERFORM public.ienvia_remover_destinatario_campanha(c,d2);
 SELECT count(*) INTO n FROM public.ienvia_campanhas_controle WHERE campanha_id=c AND status='concluida';IF n<>1 THEN RAISE EXCEPTION 'não concluiu ao excluir último pendente';END IF;
 -- Preserva etapa confirmada e cancela somente o restante da mesma pessoa.
 p=jsonb_set(p,'{blocos}',p->'blocos'||'[{"id":"22222222-2222-4222-8222-222222222222","tipo":"texto","modo":"fixo","textos":["Depois"]}]'::jsonb);
 SELECT campanha_id INTO c FROM public.ienvia_criar_campanha(p,'{"lote_min":8,"lote_max":8,"intervalo_min_ms":3000,"intervalo_max_ms":3000}','[{"telefone":"5586981000005"},{"telefone":"5586981000006"}]');
 SELECT destinatario_id INTO d1 FROM public.ienvia_campanha_destinatarios WHERE campanha_id=c AND ordem=1;
 SELECT destinatario_id INTO d2 FROM public.ienvia_campanha_destinatarios WHERE campanha_id=c AND ordem=2;
 PERFORM public.ienvia_alterar_status_campanha(c,'ativa');SELECT revisao INTO rev FROM public.ienvia_campanhas_controle WHERE campanha_id=c;
 PERFORM public.ienvia_reservar_worker_campanha(c,d1,0,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{"slotId":"slot_1","bloco":{"tipo":"texto","texto":"Oi"}}',rev,w);
 PERFORM public.ienvia_confirmar_etapa(c,d1,0,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 SELECT count(*) INTO n FROM public.ienvia_remover_destinatario_campanha(c,d1);IF n<>1 THEN RAISE EXCEPTION 'não cancelou restante';END IF;
 SELECT count(*) INTO n FROM public.ienvia_campanha_checkpoints WHERE campanha_id=c AND destinatario_id=d1 AND status='confirmada';IF n<>1 THEN RAISE EXCEPTION 'histórico confirmado perdido';END IF;
 SELECT count(*) INTO n FROM public.ienvia_campanha_checkpoints WHERE campanha_id=c AND destinatario_id=d1 AND status='pendente';IF n<>0 THEN RAISE EXCEPTION 'restante não cancelado';END IF;
 SELECT count(*) INTO n FROM public.ienvia_campanhas_controle WHERE campanha_id=c AND destinatario_corrente IS NULL AND pausa_tipo='pessoa' AND pessoas_no_lote=1 AND proxima_acao_em>=clock_timestamp()+interval '2 seconds';IF n<>1 THEN RAISE EXCEPTION 'intervalo após exclusão parcial incorreto';END IF;
 SELECT count(*) INTO n FROM public.ienvia_campanha_resumo WHERE campanha_id=c AND total=2 AND concluidos=0 AND excluidos=1;IF n<>1 THEN RAISE EXCEPTION 'resumo de exclusões incorreto';END IF;
 p=jsonb_set(p,'{blocos}',p->'blocos'||'[{"id":"33333333-3333-4333-8333-333333333333","tipo":"texto","modo":"fixo","textos":["Mais tarde"]}]'::jsonb);
 PERFORM public.ienvia_editar_plano_campanha(c,p);
 SELECT count(*) INTO n FROM public.ienvia_campanha_checkpoints WHERE campanha_id=c AND destinatario_id=d1 AND status='pendente';IF n<>0 THEN RAISE EXCEPTION 'edição ressuscitou pessoa excluída';END IF;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 SELECT count(*) INTO n FROM public.ienvia_remover_destinatario_campanha(c,d1);IF n<>0 THEN RAISE EXCEPTION 'outra conta removeu destinatário';END IF;
END $$;
RESET ROLE;
