\set ON_ERROR_STOP on
\ir campanha-upload-limpeza.test.sql
\ir ../../supabase/experimentos/20261029_campanha_upload_servico.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SELECT pasta_id AS folder FROM public.ienvia_criar_pasta_campanha('Seguro','imagem') \gset
SELECT * FROM public.ienvia_reservar_upload_campanha(:'folder','dddddddd-dddd-4ddd-8ddd-dddddddddddd',12);
DO $$ BEGIN
 BEGIN PERFORM public.ienvia_registrar_arquivo_campanha(gen_random_uuid(),gen_random_uuid(),'image/png',1,repeat('a',64));RAISE EXCEPTION 'cliente chamou RPC insegura';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM ienvia_private.registrar_arquivo_campanha(gen_random_uuid(),gen_random_uuid(),'image/png',1,repeat('a',64));RAISE EXCEPTION 'cliente chamou função privada insegura';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.ienvia_registrar_arquivo_campanha_servico(auth.uid(),gen_random_uuid(),gen_random_uuid(),'image/png',1,repeat('a',64),'teste.png');RAISE EXCEPTION 'cliente chamou serviço';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SET ROLE service_role;
SELECT count(*) AS registrado FROM public.ienvia_registrar_arquivo_campanha_servico('10000000-0000-0000-0000-000000000001',:'folder','dddddddd-dddd-4ddd-8ddd-dddddddddddd','image/png',12,repeat('a',64),'teste.png') \gset
\if :registrado
\else
\quit 1
\endif
RESET ROLE;
