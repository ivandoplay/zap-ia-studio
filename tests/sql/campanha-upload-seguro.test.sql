\set ON_ERROR_STOP on
\ir campanha-edicao-opcoes.test.sql
\ir ../../supabase/experimentos/20261029_campanha_uploads.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE pasta uuid; a uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; b uuid:='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; n integer;
BEGIN
 SELECT pasta_id INTO pasta FROM public.ienvia_criar_pasta_campanha('Novos','imagem');
 SELECT count(*) INTO n FROM public.ienvia_registrar_arquivo_campanha(pasta,a,'image/png',10,repeat('c',64)); IF n<>0 THEN RAISE EXCEPTION 'registrou sem intenção'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_reservar_upload_campanha(pasta,a,10);IF n<>1 THEN RAISE EXCEPTION 'não reservou upload';END IF;
 BEGIN PERFORM public.ienvia_registrar_arquivo_campanha(pasta,a,'image/png',11,repeat('c',64));RAISE EXCEPTION 'tamanho divergente aceito';EXCEPTION WHEN check_violation THEN NULL;END;
 SELECT count(*) INTO n FROM public.ienvia_registrar_arquivo_campanha(pasta,a,'image/png',10,repeat('c',64));IF n<>1 THEN RAISE EXCEPTION 'não registrou após reserva';END IF;
 SELECT count(*) INTO n FROM public.ienvia_registrar_arquivo_campanha(pasta,a,'image/png',10,repeat('c',64));IF n<>0 THEN RAISE EXCEPTION 'reutilizou intenção';END IF;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 SELECT count(*) INTO n FROM public.ienvia_reservar_upload_campanha(pasta,b,10);IF n<>0 THEN RAISE EXCEPTION 'conta estranha reservou';END IF;
 SELECT count(*) INTO n FROM public.ienvia_campanha_uploads WHERE pasta_id=pasta;IF n<>0 THEN RAISE EXCEPTION 'outra conta viu uploads';END IF;
END $$;
RESET ROLE;
