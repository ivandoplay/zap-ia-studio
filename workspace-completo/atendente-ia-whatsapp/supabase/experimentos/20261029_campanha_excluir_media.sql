-- Exclusão em duas etapas. Não libera quota antes da remoção do objeto no Storage.
-- O bloqueio da linha é compartilhado com a reserva da etapa de campanha.
CREATE FUNCTION ienvia_private.iniciar_exclusao_arquivo_campanha(p_arquivo uuid)
RETURNS SETOF public.ienvia_campanha_arquivos LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.ienvia_campanha_arquivos;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 SELECT a.* INTO f FROM public.ienvia_campanha_arquivos AS a WHERE a.owner_id=(SELECT auth.uid()) AND a.arquivo_id=p_arquivo FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF NOT f.excluindo AND EXISTS (
  SELECT 1 FROM public.ienvia_campanha_checkpoints x
  WHERE x.owner_id=f.owner_id AND x.status IN ('pendente','em_envio','incerta') AND x.material->'bloco'->>'arquivoId'=f.arquivo_id::text
 ) THEN RAISE EXCEPTION 'Arquivo está reservado por uma etapa pendente ou incerta; resolva a etapa antes de excluir.' USING ERRCODE='23514'; END IF;
 RETURN QUERY UPDATE public.ienvia_campanha_arquivos AS a SET excluindo=true WHERE a.owner_id=f.owner_id AND a.arquivo_id=f.arquivo_id RETURNING a.*;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.iniciar_exclusao_arquivo_campanha(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.iniciar_exclusao_arquivo_campanha(uuid) TO authenticated;
CREATE FUNCTION public.ienvia_iniciar_exclusao_arquivo_campanha(p_arquivo uuid) RETURNS SETOF public.ienvia_campanha_arquivos
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM ienvia_private.iniciar_exclusao_arquivo_campanha($1); $$;
REVOKE ALL ON FUNCTION public.ienvia_iniciar_exclusao_arquivo_campanha(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_iniciar_exclusao_arquivo_campanha(uuid) TO authenticated;

CREATE FUNCTION public.ienvia_finalizar_exclusao_arquivo_campanha_servico(p_owner uuid,p_arquivo uuid)
RETURNS SETOF public.ienvia_campanha_arquivos LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 DELETE FROM public.ienvia_campanha_arquivos AS a WHERE a.owner_id=p_owner AND a.arquivo_id=p_arquivo AND a.excluindo RETURNING a.*;
$$;
REVOKE ALL ON FUNCTION public.ienvia_finalizar_exclusao_arquivo_campanha_servico(uuid,uuid) FROM PUBLIC,authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_finalizar_exclusao_arquivo_campanha_servico(uuid,uuid) TO service_role;
