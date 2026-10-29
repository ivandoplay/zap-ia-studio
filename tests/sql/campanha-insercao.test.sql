\set ON_ERROR_STOP on
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
INSERT INTO public.ienvia_campanhas_controle(owner_id,campanha_id,nome) VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000130','Inserção segura');
DO $$ DECLARE n integer; c bigint; BEGIN
 n=public.ienvia_adicionar_etapas('20000000-0000-0000-0000-000000000130','[{"destinatario_id":"30000000-0000-0000-0000-000000000130","etapa":0},{"destinatario_id":"30000000-0000-0000-0000-000000000130","etapa":1}]'::jsonb);
 IF n<>2 THEN RAISE EXCEPTION 'não inseriu etapas'; END IF;
 BEGIN
 INSERT INTO public.ienvia_campanha_checkpoints(owner_id,campanha_id,destinatario_id,etapa) VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000130','30000000-0000-0000-0000-000000000130',2);
 RAISE EXCEPTION 'insert direto não deve ser autorizado';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 SELECT count(*) INTO c FROM public.ienvia_alterar_status_campanha('20000000-0000-0000-0000-000000000130','ativa'); IF c<>1 THEN RAISE EXCEPTION 'não ativou'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000130','30000000-0000-0000-0000-000000000130',0,'40000000-0000-0000-0000-000000000130','{"texto":"A"}'); IF c<>1 THEN RAISE EXCEPTION 'não reservou'; END IF;
 BEGIN
 n=public.ienvia_adicionar_etapas('20000000-0000-0000-0000-000000000130','[{"destinatario_id":"30000000-0000-0000-0000-000000000130","etapa":2},{"destinatario_id":"30000000-0000-0000-0000-000000000131","etapa":0}]');
 RAISE EXCEPTION 'não deve editar pessoa já iniciada';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 SELECT count(*) INTO c FROM public.ienvia_campanha_checkpoints WHERE destinatario_id='30000000-0000-0000-0000-000000000131'; IF c<>0 THEN RAISE EXCEPTION 'inserção parcial proibida'; END IF;
 n=public.ienvia_adicionar_etapas('20000000-0000-0000-0000-000000000130','[{"destinatario_id":"30000000-0000-0000-0000-000000000131","etapa":0},{"destinatario_id":"30000000-0000-0000-0000-000000000131","etapa":1}]'); IF n<>2 THEN RAISE EXCEPTION 'não adicionou pessoa ainda não iniciada'; END IF;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 n=public.ienvia_adicionar_etapas('20000000-0000-0000-0000-000000000130','[{"destinatario_id":"30000000-0000-0000-0000-000000000132","etapa":0}]'); IF n<>0 THEN RAISE EXCEPTION 'outra conta alterou campanha'; END IF;
END $$;
RESET ROLE;
