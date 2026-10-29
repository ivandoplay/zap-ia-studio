\set ON_ERROR_STOP on
\ir campanha-media.test.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE pasta uuid; arquivo uuid:='99999999-9999-4999-8999-999999999999'; cid uuid; d uuid; rev bigint; n bigint; p jsonb; material jsonb;
BEGIN
 SELECT pasta_id INTO pasta FROM public.ienvia_criar_pasta_campanha('Imagens','imagem');
 p:=jsonb_build_object('nome','Imagem','chips',jsonb_build_array('slot_1'),'modoChips','fixo','retomada','manual','blocos',jsonb_build_array(jsonb_build_object('id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','tipo','imagem','pastaId',pasta::text,'selecao','sequencial')));
 SELECT campanha_id INTO cid FROM public.ienvia_criar_campanha(p,'{}','[{"telefone":"5586982222225"}]');
 SELECT count(*) INTO n FROM public.ienvia_alterar_status_campanha(cid,'ativa');IF n<>0 THEN RAISE EXCEPTION 'ativou com pasta vazia'; END IF;
 PERFORM public.ienvia_registrar_arquivo_campanha(pasta,arquivo,'image/png',200,repeat('b',64));
 SELECT count(*) INTO n FROM public.ienvia_alterar_status_campanha(cid,'ativa');IF n<>1 THEN RAISE EXCEPTION 'não ativou com imagem registrada'; END IF;
 SELECT destinatario_id,revisao INTO d,rev FROM public.ienvia_campanha_proxima_etapa WHERE campanha_id=cid;
 material:=jsonb_build_object('slotId','slot_1','bloco',jsonb_build_object('tipo','imagem','arquivoId','88888888-8888-4888-8888-888888888888','pastaId',pasta::text));
 SELECT count(*) INTO n FROM public.ienvia_reservar_campanha(cid,d,0,'40000000-0000-0000-0000-000000000157',material,rev);IF n<>0 THEN RAISE EXCEPTION 'aceitou arquivo não autorizado'; END IF;
 material:=jsonb_set(material,'{bloco,arquivoId}',to_jsonb(arquivo::text));
 SELECT count(*) INTO n FROM public.ienvia_reservar_campanha(cid,d,0,'40000000-0000-0000-0000-000000000157',material,rev);IF n<>1 THEN RAISE EXCEPTION 'não reservou imagem'; END IF;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 BEGIN PERFORM public.ienvia_criar_campanha(p,'{}','[{"telefone":"5586982222226"}]');RAISE EXCEPTION 'outra conta usou pasta';EXCEPTION WHEN check_violation THEN NULL;END;
END $$;
RESET ROLE;
