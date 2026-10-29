-- Somente o serviço que verificou os bytes reais no Storage pode concluir uploads.
-- A RPC antiga exposta ao titular permitia declarar tamanho/hash falsos e burlar a quota.
ALTER TABLE public.ienvia_campanha_arquivos ADD COLUMN nome_original text NOT NULL DEFAULT '' CHECK (pg_catalog.length(nome_original)<=200);
REVOKE ALL ON FUNCTION public.ienvia_registrar_arquivo_campanha(uuid,uuid,text,bigint,text) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION ienvia_private.registrar_arquivo_campanha(uuid,uuid,text,bigint,text) FROM PUBLIC, authenticated;
CREATE FUNCTION public.ienvia_registrar_arquivo_campanha_servico(p_owner uuid,p_pasta uuid,p_arquivo uuid,p_mime text,p_tamanho bigint,p_sha256 text,p_nome text)
RETURNS SETOF public.ienvia_campanha_arquivos LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pasta public.ienvia_campanha_pastas; intencao public.ienvia_campanha_uploads; ordem integer;
BEGIN
 IF p_owner IS NULL OR (SELECT public.zapia_is_user_active(p_owner)) IS NOT TRUE THEN RETURN; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ienvia-upload:'||p_owner::text,0));
 SELECT * INTO pasta FROM public.ienvia_campanha_pastas AS p WHERE p.owner_id=p_owner AND p.pasta_id=p_pasta FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO intencao FROM public.ienvia_campanha_uploads AS u WHERE u.owner_id=p_owner AND u.pasta_id=p_pasta AND u.arquivo_id=p_arquivo AND u.status='pendente' AND u.expira_em>pg_catalog.clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF p_nome IS NULL OR pg_catalog.length(p_nome)>200 OR p_tamanho IS DISTINCT FROM intencao.tamanho OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_mime IS NULL OR
   (pasta.tipo='imagem' AND p_mime NOT IN ('image/jpeg','image/png','image/webp')) OR (pasta.tipo='audio' AND p_mime NOT IN ('audio/ogg','audio/mpeg','audio/mp4','audio/wav','audio/webm')) THEN RAISE EXCEPTION 'Arquivo inválido' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(pg_catalog.max(a.ordem),0)+1 INTO ordem FROM public.ienvia_campanha_arquivos AS a WHERE a.owner_id=p_owner AND a.pasta_id=p_pasta;
 IF ordem>10000 THEN RAISE EXCEPTION 'Limite de arquivos' USING ERRCODE='23514'; END IF;
 UPDATE public.ienvia_campanha_uploads AS u SET status='concluido' WHERE u.owner_id=p_owner AND u.arquivo_id=p_arquivo;
 RETURN QUERY INSERT INTO public.ienvia_campanha_arquivos(owner_id,pasta_id,arquivo_id,tipo,caminho,mime,tamanho,ordem,sha256,nome_original)
 VALUES (p_owner,p_pasta,p_arquivo,pasta.tipo,p_owner::text||'/'||p_pasta::text||'/'||p_arquivo::text,p_mime,p_tamanho,ordem,p_sha256,p_nome) RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.ienvia_registrar_arquivo_campanha_servico(uuid,uuid,uuid,text,bigint,text,text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_registrar_arquivo_campanha_servico(uuid,uuid,uuid,text,bigint,text,text) TO service_role;
