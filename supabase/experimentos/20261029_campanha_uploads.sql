-- Intenções de upload: limite conservador inclui objetos pendentes até limpeza.
CREATE TABLE public.ienvia_campanha_uploads (
 owner_id uuid NOT NULL, pasta_id uuid NOT NULL, arquivo_id uuid NOT NULL, tamanho bigint NOT NULL CHECK(tamanho BETWEEN 1 AND 36700160),
 status text NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','concluido')),
 criado_em timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(), expira_em timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()+interval '2 hours 15 minutes',
 PRIMARY KEY(owner_id,arquivo_id), FOREIGN KEY(owner_id,pasta_id) REFERENCES public.ienvia_campanha_pastas(owner_id,pasta_id) ON DELETE RESTRICT
);
ALTER TABLE public.ienvia_campanha_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_campanha_uploads FROM PUBLIC;
GRANT SELECT ON public.ienvia_campanha_uploads TO authenticated;
CREATE POLICY ienvia_uploads_own ON public.ienvia_campanha_uploads FOR SELECT TO authenticated USING(owner_id=(SELECT auth.uid()) AND (SELECT public.zapia_is_user_active(auth.uid())));
CREATE INDEX ienvia_uploads_pendentes_idx ON public.ienvia_campanha_uploads(owner_id,expira_em) WHERE status='pendente';
CREATE FUNCTION ienvia_private.reservar_upload_campanha(p_pasta uuid,p_arquivo uuid,p_tamanho bigint)
RETURNS SETOF public.ienvia_campanha_uploads LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existentes bigint; pendentes bigint;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 IF p_pasta IS NULL OR p_arquivo IS NULL OR p_tamanho IS NULL OR p_tamanho NOT BETWEEN 1 AND 36700160 THEN RAISE EXCEPTION 'Upload inválido' USING ERRCODE='23514'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ienvia-upload:'||(SELECT auth.uid())::text,0));
 PERFORM 1 FROM public.ienvia_campanha_pastas AS p WHERE p.owner_id=(SELECT auth.uid()) AND p.pasta_id=p_pasta FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT COALESCE(pg_catalog.sum(a.tamanho),0) INTO existentes FROM public.ienvia_campanha_arquivos AS a WHERE a.owner_id=(SELECT auth.uid());
 SELECT pg_catalog.count(*) INTO pendentes FROM public.ienvia_campanha_uploads AS u WHERE u.owner_id=(SELECT auth.uid()) AND u.status='pendente';
 IF pendentes>=20 OR existentes+(pendentes+1)*36700160>536870912 THEN RAISE EXCEPTION 'Limite de mídia atingido; aguarde a limpeza dos uploads pendentes' USING ERRCODE='23514'; END IF;
 RETURN QUERY INSERT INTO public.ienvia_campanha_uploads(owner_id,pasta_id,arquivo_id,tamanho) VALUES ((SELECT auth.uid()),p_pasta,p_arquivo,p_tamanho) RETURNING *;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.reservar_upload_campanha(uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.reservar_upload_campanha(uuid,uuid,bigint) TO authenticated;
CREATE FUNCTION public.ienvia_reservar_upload_campanha(p_pasta uuid,p_arquivo uuid,p_tamanho bigint) RETURNS SETOF public.ienvia_campanha_uploads
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM ienvia_private.reservar_upload_campanha($1,$2,$3); $$;
REVOKE ALL ON FUNCTION public.ienvia_reservar_upload_campanha(uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_reservar_upload_campanha(uuid,uuid,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION ienvia_private.registrar_arquivo_campanha(p_pasta uuid,p_arquivo uuid,p_mime text,p_tamanho bigint,p_sha256 text)
RETURNS SETOF public.ienvia_campanha_arquivos LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pasta public.ienvia_campanha_pastas; intencao public.ienvia_campanha_uploads; ordem integer;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ienvia-upload:'||(SELECT auth.uid())::text,0));
 SELECT * INTO pasta FROM public.ienvia_campanha_pastas AS p WHERE p.owner_id=(SELECT auth.uid()) AND p.pasta_id=p_pasta FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO intencao FROM public.ienvia_campanha_uploads AS u WHERE u.owner_id=(SELECT auth.uid()) AND u.pasta_id=p_pasta AND u.arquivo_id=p_arquivo AND u.status='pendente' AND u.expira_em>pg_catalog.clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF p_tamanho IS DISTINCT FROM intencao.tamanho OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_mime IS NULL OR
   (pasta.tipo='imagem' AND p_mime NOT IN ('image/jpeg','image/png','image/webp')) OR (pasta.tipo='audio' AND p_mime NOT IN ('audio/ogg','audio/mpeg','audio/mp4','audio/wav','audio/webm')) THEN RAISE EXCEPTION 'Arquivo inválido' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(pg_catalog.max(a.ordem),0)+1 INTO ordem FROM public.ienvia_campanha_arquivos AS a WHERE a.owner_id=(SELECT auth.uid()) AND a.pasta_id=p_pasta;
 IF ordem>10000 THEN RAISE EXCEPTION 'Limite de arquivos' USING ERRCODE='23514'; END IF;
 UPDATE public.ienvia_campanha_uploads AS u SET status='concluido' WHERE u.owner_id=(SELECT auth.uid()) AND u.arquivo_id=p_arquivo;
 RETURN QUERY INSERT INTO public.ienvia_campanha_arquivos(owner_id,pasta_id,arquivo_id,tipo,caminho,mime,tamanho,ordem,sha256)
 VALUES ((SELECT auth.uid()),p_pasta,p_arquivo,pasta.tipo,(SELECT auth.uid())::text||'/'||p_pasta::text||'/'||p_arquivo::text,p_mime,p_tamanho,ordem,p_sha256) RETURNING *;
END $$;
-- Uma limpeza privilegiada deve primeiro remover o objeto e somente depois
-- excluir a intenção; o titular não recebe permissão direta de DELETE.
CREATE VIEW public.ienvia_campanha_uploads_expirados WITH (security_invoker=true,security_barrier=true) AS
 SELECT owner_id,pasta_id,arquivo_id FROM public.ienvia_campanha_uploads
 WHERE status='pendente' AND expira_em<pg_catalog.clock_timestamp();
REVOKE ALL ON public.ienvia_campanha_uploads_expirados FROM PUBLIC;
GRANT SELECT ON public.ienvia_campanha_uploads_expirados TO authenticated;
GRANT SELECT,DELETE ON public.ienvia_campanha_uploads TO service_role;
