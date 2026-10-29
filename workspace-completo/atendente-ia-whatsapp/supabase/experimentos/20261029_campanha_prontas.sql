-- Seleção apenas indicativa: a reserva RPC revalida tudo sob lock.
CREATE VIEW public.ienvia_campanha_recuperaveis WITH (security_invoker=true,security_barrier=true) AS
 SELECT c.owner_id,c.campanha_id,c.proxima_acao_em FROM public.ienvia_campanhas_controle c
 WHERE c.ultimo_worker IS NOT NULL AND (c.status='ativa' OR (c.status='pausada' AND EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints x WHERE x.owner_id=c.owner_id AND x.campanha_id=c.campanha_id AND x.status='em_envio')));
REVOKE ALL ON public.ienvia_campanha_recuperaveis FROM PUBLIC;GRANT SELECT ON public.ienvia_campanha_recuperaveis TO authenticated;
CREATE VIEW public.ienvia_campanha_prontas WITH (security_invoker=true,security_barrier=true) AS
 SELECT c.owner_id,c.campanha_id,c.proxima_acao_em FROM public.ienvia_campanhas_controle c
 WHERE c.status='ativa' AND c.plano IS NOT NULL AND c.proxima_acao_em<=pg_catalog.clock_timestamp()
   AND ienvia_private.permitido_no_instante(c.restricao_horaria,c.fuso,c.dias,c.inicio,c.fim,pg_catalog.clock_timestamp())
   AND EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints x WHERE x.owner_id=c.owner_id AND x.campanha_id=c.campanha_id AND x.status='pendente')
   AND NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints x WHERE x.owner_id=c.owner_id AND x.campanha_id=c.campanha_id AND x.status IN ('em_envio','incerta'));
REVOKE ALL ON public.ienvia_campanha_prontas FROM PUBLIC;GRANT SELECT ON public.ienvia_campanha_prontas TO authenticated;
