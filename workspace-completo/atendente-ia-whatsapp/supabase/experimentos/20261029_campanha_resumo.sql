-- Resumo calculado, sob RLS de destinatários e etapas; não indica entrega ou leitura.
CREATE VIEW public.ienvia_campanha_resumo WITH (security_invoker=true,security_barrier=true) AS
 SELECT d.owner_id,d.campanha_id,pg_catalog.count(*)::bigint AS total,
  pg_catalog.count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints x WHERE x.owner_id=d.owner_id AND x.campanha_id=d.campanha_id AND x.destinatario_id=d.destinatario_id AND x.status<>'confirmada'))::bigint AS concluidos,
  pg_catalog.count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints x WHERE x.owner_id=d.owner_id AND x.campanha_id=d.campanha_id AND x.destinatario_id=d.destinatario_id AND x.status='incerta'))::bigint AS incertos
 FROM public.ienvia_campanha_destinatarios d GROUP BY d.owner_id,d.campanha_id;
REVOKE ALL ON public.ienvia_campanha_resumo FROM PUBLIC;
GRANT SELECT ON public.ienvia_campanha_resumo TO authenticated;
