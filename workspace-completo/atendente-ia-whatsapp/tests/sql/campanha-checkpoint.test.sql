\set ON_ERROR_STOP on
CREATE SCHEMA auth;
CREATE ROLE authenticated NOLOGIN;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE FUNCTION public.zapia_is_user_active(uid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT uid = auth.uid() AND coalesce(current_setting('ienvia_test.active',true),'1') = '1' $$;
\ir ../../supabase/experimentos/20261029_campanha_checkpoints.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
INSERT INTO public.ienvia_campanha_checkpoints(owner_id,campanha_id,destinatario_id,etapa,status)
VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',0,'pendente');
DO $$ DECLARE c bigint; BEGIN
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',0,'40000000-0000-0000-0000-000000000001','{"texto":"Teste sintético"}');
 IF c<>1 THEN RAISE EXCEPTION 'reserva deve funcionar'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',0,'40000000-0000-0000-0000-000000000002','{"texto":"duplicação"}');
 IF c<>0 THEN RAISE EXCEPTION 'reserva duplicada'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
DO $$ DECLARE c bigint; BEGIN
 SELECT count(*) INTO c FROM public.ienvia_campanha_checkpoints;
 IF c<>0 THEN RAISE EXCEPTION 'isolamento de leitura falhou'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_confirmar_etapa('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',0,'40000000-0000-0000-0000-000000000001');
 IF c<>0 THEN RAISE EXCEPTION 'isolamento de confirmação falhou'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE c bigint; BEGIN
 SELECT count(*) INTO c FROM public.ienvia_confirmar_etapa('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',0,'40000000-0000-0000-0000-000000000002');
 IF c<>0 THEN RAISE EXCEPTION 'tentativa errada confirmou'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_confirmar_etapa('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',0,'40000000-0000-0000-0000-000000000001');
 IF c<>1 THEN RAISE EXCEPTION 'confirmação não aplicada'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_confirmar_etapa('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',0,'40000000-0000-0000-0000-000000000001');
 IF c<>0 THEN RAISE EXCEPTION 'confirmação duplicada'; END IF;
END $$;
INSERT INTO public.ienvia_campanha_checkpoints(owner_id,campanha_id,destinatario_id,etapa,status) VALUES
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000010','30000000-0000-0000-0000-000000000010',0,'pendente'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000010','30000000-0000-0000-0000-000000000010',1,'pendente'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000010','30000000-0000-0000-0000-000000000011',0,'pendente');
DO $$ DECLARE c bigint; BEGIN
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000010','30000000-0000-0000-0000-000000000010',1,'40000000-0000-0000-0000-000000000010','{"texto":"passo 2"}');
 IF c<>0 THEN RAISE EXCEPTION 'etapa fora de ordem permitida'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000010','30000000-0000-0000-0000-000000000010',0,'40000000-0000-0000-0000-000000000010','{"texto":"passo 1"}');
 IF c<>1 THEN RAISE EXCEPTION 'etapa inicial não reservada'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000010','30000000-0000-0000-0000-000000000011',0,'40000000-0000-0000-0000-000000000011','{"texto":"outra pessoa"}');
 IF c<>0 THEN RAISE EXCEPTION 'duas ações na mesma campanha'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_confirmar_etapa('20000000-0000-0000-0000-000000000010','30000000-0000-0000-0000-000000000010',0,'40000000-0000-0000-0000-000000000010');
 IF c<>1 THEN RAISE EXCEPTION 'não confirmou'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000010','30000000-0000-0000-0000-000000000010',1,'40000000-0000-0000-0000-000000000012','{"texto":"passo 2"}');
 IF c<>1 THEN RAISE EXCEPTION 'etapa seguinte não reservada'; END IF;
END $$;
INSERT INTO public.ienvia_campanha_checkpoints(owner_id,campanha_id,destinatario_id,etapa,status) VALUES
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000006','30000000-0000-0000-0000-000000000006',0,'pendente'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000007','30000000-0000-0000-0000-000000000007',0,'pendente');
SELECT count(*) FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000006','30000000-0000-0000-0000-000000000006',0,'40000000-0000-0000-0000-000000000006','{"texto":"teste"}');
SELECT set_config('ienvia_test.active','0',false);
DO $$ DECLARE c bigint; BEGIN
 SELECT count(*) INTO c FROM public.ienvia_campanha_checkpoints;
 IF c<>0 THEN RAISE EXCEPTION 'perfil inativo pode ler checkpoints'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_confirmar_etapa('20000000-0000-0000-0000-000000000006','30000000-0000-0000-0000-000000000006',0,'40000000-0000-0000-0000-000000000006');
 IF c<>0 THEN RAISE EXCEPTION 'perfil inativo pode confirmar'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000007','30000000-0000-0000-0000-000000000007',0,'40000000-0000-0000-0000-000000000007','{"texto":"teste"}');
 IF c<>0 THEN RAISE EXCEPTION 'perfil inativo pode reservar'; END IF;
 BEGIN
  INSERT INTO public.ienvia_campanha_checkpoints(owner_id,campanha_id,destinatario_id,etapa,status) VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000005',0,'pendente');
  RAISE EXCEPTION 'perfil inativo pode inserir';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
SELECT set_config('ienvia_test.active','1',false);
INSERT INTO public.ienvia_campanha_checkpoints(owner_id,campanha_id,destinatario_id,etapa,status) VALUES
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000020','30000000-0000-0000-0000-000000000020',0,'pendente');
DO $$ DECLARE c bigint; BEGIN
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000020','30000000-0000-0000-0000-000000000020',0,'40000000-0000-0000-0000-000000000020','{"texto":"material original"}');
 IF c<>1 THEN RAISE EXCEPTION 'reserva deve funcionar'; END IF;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 SELECT count(*) INTO c FROM public.ienvia_marcar_etapa_incerta('20000000-0000-0000-0000-000000000020','30000000-0000-0000-0000-000000000020',0,'40000000-0000-0000-0000-000000000020');
 IF c<>0 THEN RAISE EXCEPTION 'outra conta marcou etapa incerta'; END IF;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
 PERFORM set_config('ienvia_test.active','0',false);
 SELECT count(*) INTO c FROM public.ienvia_marcar_etapa_incerta('20000000-0000-0000-0000-000000000020','30000000-0000-0000-0000-000000000020',0,'40000000-0000-0000-0000-000000000020');
 IF c<>0 THEN RAISE EXCEPTION 'perfil inativo marcou etapa incerta'; END IF;
 PERFORM set_config('ienvia_test.active','1',false);
 SELECT count(*) INTO c FROM public.ienvia_marcar_etapa_incerta('20000000-0000-0000-0000-000000000020','30000000-0000-0000-0000-000000000020',0,'40000000-0000-0000-0000-000000000021');
 IF c<>0 THEN RAISE EXCEPTION 'tentativa errada marcou incerta'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_marcar_etapa_incerta('20000000-0000-0000-0000-000000000020','30000000-0000-0000-0000-000000000020',0,'40000000-0000-0000-0000-000000000020');
 IF c<>1 THEN RAISE EXCEPTION 'incerteza não registrada'; END IF;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 SELECT count(*) INTO c FROM public.ienvia_resolver_etapa_incerta('20000000-0000-0000-0000-000000000020','30000000-0000-0000-0000-000000000020',0,'40000000-0000-0000-0000-000000000020','nao_enviada');
 IF c<>0 THEN RAISE EXCEPTION 'outra conta resolveu etapa incerta'; END IF;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
 SELECT count(*) INTO c FROM public.ienvia_resolver_etapa_incerta('20000000-0000-0000-0000-000000000020','30000000-0000-0000-0000-000000000020',0,'40000000-0000-0000-0000-000000000021','nao_enviada');
 IF c<>0 THEN RAISE EXCEPTION 'resolução com tentativa errada'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000020','30000000-0000-0000-0000-000000000020',0,'40000000-0000-0000-0000-000000000022','{"texto":"material original"}');
 IF c<>0 THEN RAISE EXCEPTION 'etapa incerta não pode reenviar'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_resolver_etapa_incerta('20000000-0000-0000-0000-000000000020','30000000-0000-0000-0000-000000000020',0,'40000000-0000-0000-0000-000000000020','nao_enviada');
 IF c<>1 THEN RAISE EXCEPTION 'resolução manual não aplicada'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000020','30000000-0000-0000-0000-000000000020',0,'40000000-0000-0000-0000-000000000022','{"texto":"material diferente"}');
 IF c<>0 THEN RAISE EXCEPTION 'material já escolhido foi alterado'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000020','30000000-0000-0000-0000-000000000020',0,'40000000-0000-0000-0000-000000000022','{"texto":"material original"}');
 IF c<>1 THEN RAISE EXCEPTION 'material original não pôde ser reservado'; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE argumentos text; BEGIN
 SELECT pg_catalog.pg_get_function_arguments('public.ienvia_reservar_etapa(uuid,uuid,integer,uuid,jsonb)'::regprocedure) INTO argumentos;
 IF argumentos NOT LIKE '%p_campanha%' OR argumentos NOT LIKE '%p_material%' THEN RAISE EXCEPTION 'RPC precisa de parâmetros nomeados para PostgREST'; END IF;
END $$;
