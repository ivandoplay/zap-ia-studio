\set ON_ERROR_STOP on
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE FUNCTION public.zapia_is_user_active(uid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT uid = auth.uid() AND coalesce(current_setting('ienvia_test.active',true),'1') = '1' $$;
\ir ../../supabase/experimentos/20261029_campanha_checkpoints.sql
\ir ../../supabase/experimentos/20261029_campanha_controle.sql
\ir ../../supabase/experimentos/20261029_campanha_insercao.sql
\ir ../../supabase/experimentos/20261029_campanha_destinatarios.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
INSERT INTO public.ienvia_campanhas_controle(owner_id,campanha_id,nome,blocos_total) VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000140','Destinatários',2);
DO $$ DECLARE n bigint; a uuid; b uuid; rev bigint; BEGIN
 SELECT count(*) INTO n FROM public.ienvia_adicionar_destinatarios('20000000-0000-0000-0000-000000000140','[{"telefone":"5586981234567","nome":"Pessoa A","campos":{"cidade":"Batalha"}},{"telefone":"5586987654321","nome":"Pessoa B","campos":{}}]');
 IF n<>2 THEN RAISE EXCEPTION 'não inseriu pessoas'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_campanha_checkpoints WHERE campanha_id='20000000-0000-0000-0000-000000000140'; IF n<>4 THEN RAISE EXCEPTION 'não criou blocos por pessoa'; END IF;
 SELECT destinatario_id INTO a FROM public.ienvia_campanha_destinatarios WHERE telefone='5586981234567'; SELECT destinatario_id INTO b FROM public.ienvia_campanha_destinatarios WHERE telefone='5586987654321';
 IF a=b OR a IS NULL OR b IS NULL THEN RAISE EXCEPTION 'identidades inválidas'; END IF;
 BEGIN
 PERFORM public.ienvia_adicionar_destinatarios('20000000-0000-0000-0000-000000000140','[{"telefone":"5586980000000","nome":"Novo"},{"telefone":"inválido","nome":"Incorreto"}]');
 RAISE EXCEPTION 'número inválido aceito';
 EXCEPTION WHEN check_violation THEN NULL; END;
 SELECT count(*) INTO n FROM public.ienvia_campanha_destinatarios; IF n<>2 THEN RAISE EXCEPTION 'inserção parcial indevida'; END IF;
 BEGIN
 PERFORM public.ienvia_adicionar_destinatarios('20000000-0000-0000-0000-000000000140','[{"telefone":"5586981234567","nome":"Duplicado"}]');
 RAISE EXCEPTION 'número duplicado aceito';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
 PERFORM public.ienvia_adicionar_destinatarios('20000000-0000-0000-0000-000000000140','[{"telefone":"5586980000000","campos":{"__proto__":"x"}}]');
 RAISE EXCEPTION 'campo perigoso aceito';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
 PERFORM public.ienvia_adicionar_destinatarios('20000000-0000-0000-0000-000000000140','[]');
 RAISE EXCEPTION 'lista vazia aceita';
 EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM set_config('ienvia_test.active','0',false);
 SELECT count(*) INTO n FROM public.ienvia_campanha_destinatarios; IF n<>0 THEN RAISE EXCEPTION 'perfil inativo leu destinatários'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_adicionar_destinatarios('20000000-0000-0000-0000-000000000140','[{"telefone":"5586981111111","nome":"Inativo"}]'); IF n<>0 THEN RAISE EXCEPTION 'perfil inativo inseriu'; END IF;
 PERFORM set_config('ienvia_test.active','1',false);
 BEGIN
 UPDATE public.ienvia_campanha_destinatarios SET nome='Outra' WHERE destinatario_id=a;
 RAISE EXCEPTION 'update direto permitido';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 SELECT count(*) INTO n FROM public.ienvia_alterar_status_campanha('20000000-0000-0000-0000-000000000140','ativa'); IF n<>1 THEN RAISE EXCEPTION 'não ativou'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_campanha_proxima_etapa WHERE destinatario_id=a AND etapa=0; IF n<>1 THEN RAISE EXCEPTION 'não selecionou primeira pessoa'; END IF;
 SELECT revisao INTO rev FROM public.ienvia_campanha_proxima_etapa WHERE destinatario_id=a;
 SELECT count(*) INTO n FROM public.ienvia_reservar_campanha('20000000-0000-0000-0000-000000000140',b,0,'40000000-0000-0000-0000-000000000140','{"texto":"B"}',rev); IF n<>0 THEN RAISE EXCEPTION 'não deve pular primeiro destinatário'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_reservar_campanha('20000000-0000-0000-0000-000000000140',a,0,'40000000-0000-0000-0000-000000000140','{"texto":"A"}',rev+1); IF n<>0 THEN RAISE EXCEPTION 'revisão desatualizada permitida'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_reservar_campanha('20000000-0000-0000-0000-000000000140',a,0,'40000000-0000-0000-0000-000000000140','{"texto":"A"}',rev); IF n<>1 THEN RAISE EXCEPTION 'não reservou'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_campanha_proxima_etapa; IF n<>0 THEN RAISE EXCEPTION 'ação em envio deve bloquear outra'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_confirmar_etapa('20000000-0000-0000-0000-000000000140',a,0,'40000000-0000-0000-0000-000000000140'); IF n<>1 THEN RAISE EXCEPTION 'não confirmou'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_campanha_proxima_etapa WHERE destinatario_id=a AND etapa=1; IF n<>1 THEN RAISE EXCEPTION 'não continuou a mesma pessoa'; END IF;
 SELECT revisao INTO rev FROM public.ienvia_campanha_proxima_etapa WHERE destinatario_id=a;
 SELECT count(*) INTO n FROM public.ienvia_reservar_campanha('20000000-0000-0000-0000-000000000140',a,1,'40000000-0000-0000-0000-000000000141','{"texto":"A1"}',rev); IF n<>1 THEN RAISE EXCEPTION 'não reservou segunda etapa'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_confirmar_etapa('20000000-0000-0000-0000-000000000140',a,1,'40000000-0000-0000-0000-000000000141'); IF n<>1 THEN RAISE EXCEPTION 'não confirmou segunda etapa'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_campanha_proxima_etapa WHERE destinatario_id=b AND etapa=0; IF n<>1 THEN RAISE EXCEPTION 'não avançou para segunda pessoa'; END IF;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 SELECT count(*) INTO n FROM public.ienvia_campanha_proxima_etapa; IF n<>0 THEN RAISE EXCEPTION 'outra conta viu próxima etapa'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_campanha_destinatarios; IF n<>0 THEN RAISE EXCEPTION 'vazamento de destinatários'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_adicionar_destinatarios('20000000-0000-0000-0000-000000000140','[{"telefone":"5586981111111","nome":"Terceiro"}]'); IF n<>0 THEN RAISE EXCEPTION 'outra conta inseriu'; END IF;
END $$;
RESET ROLE;
