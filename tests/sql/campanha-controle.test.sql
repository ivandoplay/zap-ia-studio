\set ON_ERROR_STOP on
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE FUNCTION public.zapia_is_user_active(uid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT uid = auth.uid() AND coalesce(current_setting('ienvia_test.active',true),'1') = '1' $$;
\ir ../../supabase/experimentos/20261029_campanha_checkpoints.sql
\ir ../../supabase/experimentos/20261029_campanha_controle.sql
\ir ../../supabase/experimentos/20261029_campanha_insercao.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
INSERT INTO public.ienvia_campanhas_controle(owner_id,campanha_id,nome,status,proxima_acao_em)
VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000100','Campanha sintética','rascunho',now()),
('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000101','Agendada','rascunho',now()+interval '1 hour');
SELECT public.ienvia_adicionar_etapas('20000000-0000-0000-0000-000000000100','[{"destinatario_id":"30000000-0000-0000-0000-000000000100","etapa":0}]');
SELECT public.ienvia_adicionar_etapas('20000000-0000-0000-0000-000000000101','[{"destinatario_id":"30000000-0000-0000-0000-000000000101","etapa":0}]');
DO $$ DECLARE c bigint; BEGIN
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000100','30000000-0000-0000-0000-000000000100',0,'40000000-0000-0000-0000-000000000100','{"texto":"simulação"}');
 IF c<>0 THEN RAISE EXCEPTION 'rascunho não pode reservar'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_alterar_status_campanha('20000000-0000-0000-0000-000000000100','ativa');
 IF c<>1 THEN RAISE EXCEPTION 'não ativou'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_alterar_status_campanha('20000000-0000-0000-0000-000000000101','ativa');
 IF c<>1 THEN RAISE EXCEPTION 'não ativou agendada'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000101','30000000-0000-0000-0000-000000000101',0,'40000000-0000-0000-0000-000000000101','{"texto":"simulação"}');
 IF c<>0 THEN RAISE EXCEPTION 'agendamento futuro ignorado'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_pular_pausa_campanha('20000000-0000-0000-0000-000000000101');
 IF c<>0 THEN RAISE EXCEPTION 'agendamento inicial não pode ser pulado'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000100','30000000-0000-0000-0000-000000000100',0,'40000000-0000-0000-0000-000000000100','{"texto":"simulação"}');
 IF c<>1 THEN RAISE EXCEPTION 'campanha ativa não reservou'; END IF;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 SELECT count(*) INTO c FROM public.ienvia_alterar_status_campanha('20000000-0000-0000-0000-000000000100','pausada');
 IF c<>0 THEN RAISE EXCEPTION 'outra conta pausou'; END IF;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
 SELECT count(*) INTO c FROM public.ienvia_alterar_status_campanha('20000000-0000-0000-0000-000000000100','pausada');
 IF c<>1 THEN RAISE EXCEPTION 'não pausou'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_marcar_etapa_incerta('20000000-0000-0000-0000-000000000100','30000000-0000-0000-0000-000000000100',0,'40000000-0000-0000-0000-000000000100');
 IF c<>1 THEN RAISE EXCEPTION 'não marcou incerteza'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_alterar_status_campanha('20000000-0000-0000-0000-000000000100','ativa');
 IF c<>0 THEN RAISE EXCEPTION 'campanha incerta não deve retomar'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_resolver_etapa_incerta('20000000-0000-0000-0000-000000000100','30000000-0000-0000-0000-000000000100',0,'40000000-0000-0000-0000-000000000100','nao_enviada');
 IF c<>1 THEN RAISE EXCEPTION 'não resolveu incerteza'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000100','30000000-0000-0000-0000-000000000100',0,'40000000-0000-0000-0000-000000000102','{"texto":"simulação"}');
 IF c<>0 THEN RAISE EXCEPTION 'pausada não pode reservar'; END IF;
END $$;
INSERT INTO public.ienvia_campanhas_controle(owner_id,campanha_id,nome,restricao_horaria,fuso,dias,inicio,fim)
VALUES
('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000102','Permitida',true,'America/Fortaleza',ARRAY[0,1,2,3,4,5,6]::smallint[],(timezone('America/Fortaleza',now())::time-interval '1 minute')::time,(timezone('America/Fortaleza',now())::time+interval '1 minute')::time),
('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000103','Fora do dia',true,'America/Fortaleza',ARRAY[((extract(dow from timezone('America/Fortaleza',now()))::int+1)%7)::smallint],(timezone('America/Fortaleza',now())::time-interval '1 minute')::time,(timezone('America/Fortaleza',now())::time+interval '1 minute')::time);
SELECT public.ienvia_adicionar_etapas('20000000-0000-0000-0000-000000000102','[{"destinatario_id":"30000000-0000-0000-0000-000000000102","etapa":0}]');
SELECT public.ienvia_adicionar_etapas('20000000-0000-0000-0000-000000000103','[{"destinatario_id":"30000000-0000-0000-0000-000000000103","etapa":0}]');
DO $$ DECLARE c bigint; BEGIN
 SELECT count(*) INTO c FROM public.ienvia_alterar_status_campanha('20000000-0000-0000-0000-000000000102','ativa'); IF c<>1 THEN RAISE EXCEPTION 'não ativou'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_alterar_status_campanha('20000000-0000-0000-0000-000000000103','ativa'); IF c<>1 THEN RAISE EXCEPTION 'não ativou'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000102','30000000-0000-0000-0000-000000000102',0,'40000000-0000-0000-0000-000000000102','{"texto":"simulação"}');
 IF c<>1 THEN RAISE EXCEPTION 'janela válida rejeitada'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000103','30000000-0000-0000-0000-000000000103',0,'40000000-0000-0000-0000-000000000103','{"texto":"simulação"}');
 IF c<>0 THEN RAISE EXCEPTION 'janela fora do dia permitida'; END IF;
 BEGIN
 INSERT INTO public.ienvia_campanhas_controle(owner_id,campanha_id,nome,restricao_horaria,fuso,dias,inicio,fim)
 VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000104','Fuso inválido',true,'NaoExiste/Fuso',ARRAY[1]::smallint[],'08:00','10:00');
 RAISE EXCEPTION 'fuso inválido aceito';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
DO $$ BEGIN
 IF NOT ienvia_private.permitido_no_instante(true,'America/New_York',ARRAY[0]::smallint[],'01:00','03:00','2024-03-10 06:30:00+00') THEN RAISE EXCEPTION 'antes da mudança de verão deveria permitir'; END IF;
 IF ienvia_private.permitido_no_instante(true,'America/New_York',ARRAY[0]::smallint[],'01:00','03:00','2024-03-10 07:30:00+00') THEN RAISE EXCEPTION 'após mudança de verão deveria barrar'; END IF;
 IF NOT ienvia_private.permitido_no_instante(true,'America/New_York',ARRAY[0]::smallint[],'01:00','02:00','2024-11-03 05:30:00+00') OR NOT ienvia_private.permitido_no_instante(true,'America/New_York',ARRAY[0]::smallint[],'01:00','02:00','2024-11-03 06:30:00+00') THEN RAISE EXCEPTION 'horário repetido deveria permitir ambas ocorrências'; END IF;
 IF NOT ienvia_private.permitido_no_instante(true,'America/Fortaleza',ARRAY[1]::smallint[],'23:00','02:00','2024-01-02 04:00:00+00') THEN RAISE EXCEPTION 'janela segunda para terça incorreta'; END IF;
 IF ienvia_private.permitido_no_instante(true,'America/Fortaleza',ARRAY[1]::smallint[],'23:00','02:00','2024-01-02 05:00:00+00') THEN RAISE EXCEPTION 'fim da janela deve ser exclusivo'; END IF;
END $$;
RESET ROLE;
