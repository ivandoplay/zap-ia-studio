\set ON_ERROR_STOP on
\ir campanha-plano-preparado.test.sql
\ir ../../supabase/experimentos/20261029_campanha_media.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE pasta uuid; arquivo uuid:='55555555-5555-4555-8555-555555555555'; n bigint; caminho text;
BEGIN
 SELECT pasta_id INTO pasta FROM public.ienvia_criar_pasta_campanha('Áudios','audio'); IF pasta IS NULL THEN RAISE EXCEPTION 'não criou pasta'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_registrar_arquivo_campanha(pasta,arquivo,'audio/ogg',20,repeat('a',64)); IF n<>1 THEN RAISE EXCEPTION 'não registrou'; END IF;
 SELECT a.caminho INTO caminho FROM public.ienvia_campanha_arquivos a WHERE a.arquivo_id=arquivo;
 IF caminho<>auth.uid()::text||'/'||pasta::text||'/'||arquivo::text THEN RAISE EXCEPTION 'caminho não isolado'; END IF;
 BEGIN PERFORM public.ienvia_registrar_arquivo_campanha(pasta,'66666666-6666-4666-8666-666666666666','image/png',20,repeat('a',64));RAISE EXCEPTION 'tipo não rejeitado';EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN INSERT INTO public.ienvia_campanha_arquivos(owner_id,pasta_id,arquivo_id,tipo,caminho,mime,tamanho,ordem) VALUES (auth.uid(),pasta,'77777777-7777-4777-8777-777777777777','audio','arbitrario','audio/ogg',20,2);RAISE EXCEPTION 'insert direto permitido';EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 SELECT count(*) INTO n FROM public.ienvia_campanha_arquivos WHERE pasta_id=pasta;IF n<>0 THEN RAISE EXCEPTION 'vazamento';END IF;
 SELECT count(*) INTO n FROM public.ienvia_registrar_arquivo_campanha(pasta,'88888888-8888-4888-8888-888888888888','audio/ogg',20,repeat('a',64));IF n<>0 THEN RAISE EXCEPTION 'outra conta registrou';END IF;
END $$;
RESET ROLE;
