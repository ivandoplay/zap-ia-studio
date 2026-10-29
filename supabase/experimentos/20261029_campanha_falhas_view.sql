-- Próxima pessoa quando a execução foi pausada por erro de preparação.
CREATE VIEW public.ienvia_campanha_proxima_falha WITH (security_invoker=true,security_barrier=true) AS
 SELECT c.owner_id,c.campanha_id,proximo.destinatario_id,proximo.nome,proximo.telefone,proximo.etapa
 FROM public.ienvia_campanhas_controle c
 CROSS JOIN LATERAL (
  SELECT d.destinatario_id,d.nome,d.telefone,x.etapa
  FROM public.ienvia_campanha_destinatarios d
  JOIN public.ienvia_campanha_checkpoints x ON x.owner_id=d.owner_id AND x.campanha_id=d.campanha_id AND x.destinatario_id=d.destinatario_id
  WHERE d.owner_id=c.owner_id AND d.campanha_id=c.campanha_id AND x.status='pendente' AND (c.destinatario_corrente IS NULL OR c.destinatario_corrente=d.destinatario_id)
  ORDER BY d.ordem,x.etapa LIMIT 1
 ) proximo WHERE c.status='pausada' AND c.falha_codigo IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM public.ienvia_campanha_checkpoints ocupado WHERE ocupado.owner_id=c.owner_id AND ocupado.campanha_id=c.campanha_id AND ocupado.status IN ('em_envio','incerta'));
REVOKE ALL ON public.ienvia_campanha_proxima_falha FROM PUBLIC;
GRANT SELECT ON public.ienvia_campanha_proxima_falha TO authenticated;
