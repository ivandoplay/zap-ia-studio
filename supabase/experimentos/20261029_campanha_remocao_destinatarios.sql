-- Exclusão manual do RESTANTE: nunca interrompe uma etapa em envio ou incerta.
-- Preserva registros já confirmados, não cria bloqueio global e usa o lock da campanha.
ALTER TABLE public.ienvia_campanha_destinatarios ADD COLUMN excluido boolean NOT NULL DEFAULT false;
CREATE VIEW public.ienvia_campanha_lista_destinatarios WITH (security_invoker=true,security_barrier=true) AS
 SELECT d.owner_id,d.campanha_id,d.destinatario_id,d.nome,d.telefone,d.ordem,d.excluido,
  NOT d.excluido AND EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints x WHERE x.owner_id=d.owner_id AND x.campanha_id=d.campanha_id AND x.destinatario_id=d.destinatario_id AND x.status='pendente')
  AND NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints x WHERE x.owner_id=d.owner_id AND x.campanha_id=d.campanha_id AND x.destinatario_id=d.destinatario_id AND x.status IN ('em_envio','incerta')) AS pode_excluir
 FROM public.ienvia_campanha_destinatarios d;
REVOKE ALL ON public.ienvia_campanha_lista_destinatarios FROM PUBLIC;
GRANT SELECT ON public.ienvia_campanha_lista_destinatarios TO authenticated;
CREATE OR REPLACE VIEW public.ienvia_campanha_resumo WITH (security_invoker=true,security_barrier=true) AS
 SELECT d.owner_id,d.campanha_id,pg_catalog.count(*)::bigint AS total,
  pg_catalog.count(*) FILTER (WHERE NOT d.excluido AND NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints x WHERE x.owner_id=d.owner_id AND x.campanha_id=d.campanha_id AND x.destinatario_id=d.destinatario_id AND x.status<>'confirmada'))::bigint AS concluidos,
  pg_catalog.count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints x WHERE x.owner_id=d.owner_id AND x.campanha_id=d.campanha_id AND x.destinatario_id=d.destinatario_id AND x.status='incerta'))::bigint AS incertos,
  pg_catalog.count(*) FILTER (WHERE d.excluido)::bigint AS excluidos
 FROM public.ienvia_campanha_destinatarios d GROUP BY d.owner_id,d.campanha_id;
CREATE FUNCTION ienvia_private.remover_destinatario_campanha(p_campanha uuid,p_destinatario uuid)
RETURNS TABLE(owner_id uuid,campanha_id uuid,destinatario_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.ienvia_campanhas_controle; houve_envio boolean; restante boolean; atraso bigint; numero integer;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 SELECT * INTO c FROM public.ienvia_campanhas_controle x WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha FOR UPDATE;
 IF NOT FOUND OR c.status='concluida' THEN RETURN; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_destinatarios d WHERE d.owner_id=c.owner_id AND d.campanha_id=p_campanha AND d.destinatario_id=p_destinatario AND NOT d.excluido) OR
    NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints x WHERE x.owner_id=c.owner_id AND x.campanha_id=p_campanha AND x.destinatario_id=p_destinatario AND x.status='pendente') OR
    EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints x WHERE x.owner_id=c.owner_id AND x.campanha_id=p_campanha AND x.destinatario_id=p_destinatario AND x.status IN ('em_envio','incerta')) THEN RETURN; END IF;
 SELECT EXISTS(SELECT 1 FROM public.ienvia_campanha_checkpoints x WHERE x.owner_id=c.owner_id AND x.campanha_id=p_campanha AND x.destinatario_id=p_destinatario AND x.status='confirmada') INTO houve_envio;
 DELETE FROM public.ienvia_campanha_checkpoints x WHERE x.owner_id=c.owner_id AND x.campanha_id=p_campanha AND x.destinatario_id=p_destinatario AND x.status='pendente';
 UPDATE public.ienvia_campanha_destinatarios d SET excluido=true WHERE d.owner_id=c.owner_id AND d.campanha_id=p_campanha AND d.destinatario_id=p_destinatario;
 SELECT EXISTS(SELECT 1 FROM public.ienvia_campanha_checkpoints x WHERE x.owner_id=c.owner_id AND x.campanha_id=p_campanha AND x.status<>'confirmada') INTO restante;
 IF c.status IN ('ativa','pausada') AND NOT restante THEN
  UPDATE public.ienvia_campanhas_controle x SET status='concluida',destinatario_corrente=NULL,pausa_tipo=NULL,revisao=x.revisao+1 WHERE x.owner_id=c.owner_id AND x.campanha_id=p_campanha;
 ELSIF houve_envio AND c.destinatario_corrente=p_destinatario THEN
  numero=c.pessoas_no_lote+1;
  IF numero>=c.lote_meta THEN
   atraso=c.pausa_lote_min_ms+pg_catalog.floor(pg_catalog.random()*(c.pausa_lote_max_ms-c.pausa_lote_min_ms+1))::bigint;
   UPDATE public.ienvia_campanhas_controle x SET pessoas_no_lote=0,lote_meta=c.lote_min+pg_catalog.floor(pg_catalog.random()*(c.lote_max-c.lote_min+1))::integer,destinatario_corrente=NULL,pausa_tipo='lote',proxima_acao_em=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>atraso::double precision/1000),revisao=x.revisao+1 WHERE x.owner_id=c.owner_id AND x.campanha_id=p_campanha;
  ELSE
   atraso=c.intervalo_min_ms+pg_catalog.floor(pg_catalog.random()*(c.intervalo_max_ms-c.intervalo_min_ms+1))::bigint;
   UPDATE public.ienvia_campanhas_controle x SET pessoas_no_lote=numero,destinatario_corrente=NULL,pausa_tipo='pessoa',proxima_acao_em=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>atraso::double precision/1000),revisao=x.revisao+1 WHERE x.owner_id=c.owner_id AND x.campanha_id=p_campanha;
  END IF;
 ELSE
  UPDATE public.ienvia_campanhas_controle x SET revisao=x.revisao+1 WHERE x.owner_id=c.owner_id AND x.campanha_id=p_campanha;
 END IF;
 RETURN QUERY SELECT c.owner_id,p_campanha,p_destinatario;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.remover_destinatario_campanha(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.remover_destinatario_campanha(uuid,uuid) TO authenticated;
CREATE FUNCTION public.ienvia_remover_destinatario_campanha(p_campanha uuid,p_destinatario uuid) RETURNS TABLE(owner_id uuid,campanha_id uuid,destinatario_id uuid)
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM ienvia_private.remover_destinatario_campanha($1,$2); $$;
REVOKE ALL ON FUNCTION public.ienvia_remover_destinatario_campanha(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_remover_destinatario_campanha(uuid,uuid) TO authenticated;
