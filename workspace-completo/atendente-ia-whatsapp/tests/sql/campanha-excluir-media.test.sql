\set ON_ERROR_STOP on
\ir campanha-falhas.test.sql
\ir ../../supabase/experimentos/20261029_campanha_upload_servico.sql
\ir ../../supabase/experimentos/20261029_campanha_excluir_media.sql
INSERT INTO public.ienvia_campanha_pastas(owner_id,pasta_id,nome,tipo) VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-4000-8000-000000000111','Imagens','imagem');
INSERT INTO public.ienvia_campanha_arquivos(owner_id,pasta_id,arquivo_id,tipo,caminho,mime,tamanho,ordem,sha256)
VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-4000-8000-000000000111','30000000-0000-4000-8000-000000000111','imagem','10000000-0000-0000-0000-000000000001/20000000-0000-4000-8000-000000000111/30000000-0000-4000-8000-000000000111','image/png',12,1,repeat('a',64)),
('10000000-0000-0000-0000-000000000001','20000000-0000-4000-8000-000000000111','30000000-0000-4000-8000-000000000112','imagem','10000000-0000-0000-0000-000000000001/20000000-0000-4000-8000-000000000111/30000000-0000-4000-8000-000000000112','image/png',12,2,repeat('a',64));
INSERT INTO public.ienvia_campanha_pastas(owner_id,pasta_id,nome,tipo) VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-4000-8000-000000000222','Pasta em exclusão','imagem');
INSERT INTO public.ienvia_campanha_arquivos(owner_id,pasta_id,arquivo_id,tipo,caminho,mime,tamanho,ordem,sha256) VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-4000-8000-000000000222','30000000-0000-4000-8000-000000000222','imagem','10000000-0000-0000-0000-000000000001/20000000-0000-4000-8000-000000000222/30000000-0000-4000-8000-000000000222','image/png',12,1,repeat('a',64));
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.ienvia_iniciar_exclusao_arquivo_campanha('30000000-0000-4000-8000-000000000111')) THEN RAISE EXCEPTION 'outra conta excluiu';END IF; END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE c uuid;d uuid;r bigint;n bigint;pl jsonb:='{"nome":"Teste mídia","chips":["slot_1"],"modoChips":"fixo","retomada":"manual","blocos":[{"id":"11111111-1111-4111-8111-111111111111","tipo":"imagem","pastaId":"20000000-0000-4000-8000-000000000111","selecao":"sequencial"}]}'::jsonb; mat jsonb:='{"slotId":"slot_1","bloco":{"tipo":"imagem","pastaId":"20000000-0000-4000-8000-000000000111","arquivoId":"30000000-0000-4000-8000-000000000112"}}';
BEGIN
 SELECT campanha_id INTO c FROM public.ienvia_criar_campanha(pl,'{}','[{"telefone":"5586981110000"}]');PERFORM public.ienvia_alterar_status_campanha(c,'ativa');SELECT destinatario_id,revisao INTO d,r FROM public.ienvia_campanha_proxima_etapa WHERE campanha_id=c;
 PERFORM public.ienvia_registrar_worker_campanha('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaabb','teste');
 SELECT count(*) INTO n FROM public.ienvia_reservar_worker_campanha(c,d,0,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbaa',mat,r,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaabb');IF n<>1 THEN RAISE EXCEPTION 'reserva falhou';END IF;
 BEGIN PERFORM public.ienvia_iniciar_exclusao_arquivo_campanha('30000000-0000-4000-8000-000000000112');RAISE EXCEPTION 'permitiu exclusão de arquivo reservado';EXCEPTION WHEN check_violation THEN NULL;END;
 SELECT count(*) INTO n FROM public.ienvia_iniciar_exclusao_arquivo_campanha('30000000-0000-4000-8000-000000000111');IF n<>1 THEN RAISE EXCEPTION 'não iniciou exclusão';END IF;
 SELECT count(*) INTO n FROM public.ienvia_iniciar_exclusao_arquivo_campanha('30000000-0000-4000-8000-000000000111');IF n<>1 THEN RAISE EXCEPTION 'não permite retry';END IF;
 BEGIN PERFORM public.ienvia_finalizar_exclusao_arquivo_campanha_servico(auth.uid(),'30000000-0000-4000-8000-000000000111');RAISE EXCEPTION 'cliente liberou quota sem apagar Storage';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM public.ienvia_iniciar_exclusao_arquivo_campanha('30000000-0000-4000-8000-000000000222');
 pl:=jsonb_set(pl,'{blocos,0,pastaId}','"20000000-0000-4000-8000-000000000222"'::jsonb);
 SELECT campanha_id INTO c FROM public.ienvia_criar_campanha(pl,'{}','[{"telefone":"5586981110001"}]');
 SELECT count(*) INTO n FROM public.ienvia_alterar_status_campanha(c,'ativa');IF n<>0 THEN RAISE EXCEPTION 'iniciou campanha com único arquivo em exclusão';END IF;
END $$;
RESET ROLE;
SET ROLE service_role;
DO $$ DECLARE n bigint;BEGIN SELECT count(*) INTO n FROM public.ienvia_finalizar_exclusao_arquivo_campanha_servico('10000000-0000-0000-0000-000000000001','30000000-0000-4000-8000-000000000112');IF n<>0 THEN RAISE EXCEPTION 'apagou arquivo não marcado';END IF;SELECT count(*) INTO n FROM public.ienvia_finalizar_exclusao_arquivo_campanha_servico('10000000-0000-0000-0000-000000000001','30000000-0000-4000-8000-000000000111');IF n<>1 THEN RAISE EXCEPTION 'não finalizou';END IF;END $$;
RESET ROLE;
