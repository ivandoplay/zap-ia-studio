-- Apenas metadados experimentais. Uma aplicação segura deve registrar após
-- verificar o objeto no bucket privado; estas RPCs não provam sua existência.
ALTER TABLE public.ienvia_campanha_arquivos ADD COLUMN sha256 text CHECK (sha256 ~ '^[0-9a-f]{64}$');
CREATE FUNCTION ienvia_private.criar_pasta_campanha(p_nome text,p_tipo text)
RETURNS SETOF public.ienvia_campanha_pastas LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 IF p_nome IS NULL OR pg_catalog.length(pg_catalog.btrim(p_nome)) NOT BETWEEN 1 AND 120 OR p_tipo IS NULL OR p_tipo NOT IN ('imagem','audio') THEN RAISE EXCEPTION 'Pasta inválida' USING ERRCODE='23514'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ienvia-pastas:'||(SELECT auth.uid())::text,0));
 IF (SELECT pg_catalog.count(*) FROM public.ienvia_campanha_pastas AS p WHERE p.owner_id=(SELECT auth.uid()))>=2000 THEN RAISE EXCEPTION 'Limite de pastas' USING ERRCODE='23514'; END IF;
 RETURN QUERY INSERT INTO public.ienvia_campanha_pastas(owner_id,nome,tipo) VALUES ((SELECT auth.uid()),pg_catalog.btrim(p_nome),p_tipo) RETURNING *;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.criar_pasta_campanha(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.criar_pasta_campanha(text,text) TO authenticated;
CREATE FUNCTION public.ienvia_criar_pasta_campanha(p_nome text,p_tipo text) RETURNS SETOF public.ienvia_campanha_pastas
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM ienvia_private.criar_pasta_campanha($1,$2); $$;
REVOKE ALL ON FUNCTION public.ienvia_criar_pasta_campanha(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_criar_pasta_campanha(text,text) TO authenticated;

CREATE FUNCTION ienvia_private.registrar_arquivo_campanha(p_pasta uuid,p_arquivo uuid,p_mime text,p_tamanho bigint,p_sha256 text)
RETURNS SETOF public.ienvia_campanha_arquivos LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pasta public.ienvia_campanha_pastas; ordem integer;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 SELECT * INTO pasta FROM public.ienvia_campanha_pastas AS p WHERE p.owner_id=(SELECT auth.uid()) AND p.pasta_id=p_pasta FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF p_arquivo IS NULL OR p_tamanho IS NULL OR p_tamanho NOT BETWEEN 1 AND 36700160 OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_mime IS NULL OR
   (pasta.tipo='imagem' AND p_mime NOT IN ('image/jpeg','image/png','image/webp')) OR
   (pasta.tipo='audio' AND p_mime NOT IN ('audio/ogg','audio/mpeg','audio/mp4','audio/wav','audio/webm')) THEN RAISE EXCEPTION 'Arquivo inválido' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(pg_catalog.max(a.ordem),0)+1 INTO ordem FROM public.ienvia_campanha_arquivos AS a WHERE a.owner_id=(SELECT auth.uid()) AND a.pasta_id=p_pasta;
 IF ordem>10000 THEN RAISE EXCEPTION 'Limite de arquivos' USING ERRCODE='23514'; END IF;
 RETURN QUERY INSERT INTO public.ienvia_campanha_arquivos(owner_id,pasta_id,arquivo_id,tipo,caminho,mime,tamanho,ordem,sha256)
 VALUES ((SELECT auth.uid()),p_pasta,p_arquivo,pasta.tipo,(SELECT auth.uid())::text||'/'||p_pasta::text||'/'||p_arquivo::text,p_mime,p_tamanho,ordem,p_sha256) RETURNING *;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.registrar_arquivo_campanha(uuid,uuid,text,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.registrar_arquivo_campanha(uuid,uuid,text,bigint,text) TO authenticated;
CREATE FUNCTION public.ienvia_registrar_arquivo_campanha(p_pasta uuid,p_arquivo uuid,p_mime text,p_tamanho bigint,p_sha256 text) RETURNS SETOF public.ienvia_campanha_arquivos
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM ienvia_private.registrar_arquivo_campanha($1,$2,$3,$4,$5); $$;
REVOKE ALL ON FUNCTION public.ienvia_registrar_arquivo_campanha(uuid,uuid,text,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_registrar_arquivo_campanha(uuid,uuid,text,bigint,text) TO authenticated;
