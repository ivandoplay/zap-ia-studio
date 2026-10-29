\set ON_ERROR_STOP on
\ir campanha-upload-seguro.test.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SELECT pasta_id AS folder FROM public.ienvia_criar_pasta_campanha('Expirados','imagem') \gset
SELECT * FROM public.ienvia_reservar_upload_campanha(:'folder','cccccccc-cccc-4ccc-8ccc-cccccccccccc',10);
RESET ROLE;
UPDATE public.ienvia_campanha_uploads SET expira_em=clock_timestamp()-interval '1 second' WHERE arquivo_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
SET ROLE authenticated;
DO $$ DECLARE n int; BEGIN
 SELECT count(*) INTO n FROM public.ienvia_campanha_uploads_expirados WHERE arquivo_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';IF n<>1 THEN RAISE EXCEPTION 'expirado não visível';END IF;
 BEGIN DELETE FROM public.ienvia_campanha_uploads WHERE arquivo_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';RAISE EXCEPTION 'cliente apagou intenção';EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 SELECT count(*) INTO n FROM public.ienvia_campanha_uploads_expirados WHERE arquivo_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';IF n<>0 THEN RAISE EXCEPTION 'vazamento';END IF;
END $$;
RESET ROLE;
SET ROLE service_role;
DELETE FROM public.ienvia_campanha_uploads WHERE arquivo_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
RESET ROLE;
