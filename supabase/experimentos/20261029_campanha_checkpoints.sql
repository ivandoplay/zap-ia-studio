-- Experimento isolado de checkpoint por etapa. Não integra nem autoriza campanhas.
-- Não determina se uma mensagem foi entregue ou lida no telefone do destinatário.
CREATE SCHEMA IF NOT EXISTS ienvia_private;
REVOKE ALL ON SCHEMA ienvia_private FROM PUBLIC;
GRANT USAGE ON SCHEMA ienvia_private TO authenticated;

CREATE TABLE public.ienvia_campanha_checkpoints (
  owner_id uuid NOT NULL,
  campanha_id uuid NOT NULL,
  destinatario_id uuid NOT NULL,
  etapa integer NOT NULL CHECK (etapa >= 0 AND etapa < 100),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_envio','confirmada','incerta')),
  tentativa_id uuid,
  material jsonb,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id,campanha_id,destinatario_id,etapa),
  CHECK (material IS NULL OR (jsonb_typeof(material) = 'object' AND length(material::text) <= 16000)),
  -- Material preenchido em pendente significa tentativa incerta revisada como não enviada;
  -- deve ser preservado e reutilizado, em vez de sortear outra mídia ou mensagem.
  CHECK ((status = 'pendente' AND tentativa_id IS NULL) OR
         (status <> 'pendente' AND tentativa_id IS NOT NULL AND material IS NOT NULL))
);
-- Uma etapa em andamento/incerta por campanha impede passos simultâneos entre workers.
CREATE UNIQUE INDEX ienvia_checkpoint_unica_acao ON public.ienvia_campanha_checkpoints (owner_id,campanha_id)
  WHERE status IN ('em_envio','incerta');
ALTER TABLE public.ienvia_campanha_checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_campanha_checkpoints FROM PUBLIC;
GRANT SELECT, INSERT ON public.ienvia_campanha_checkpoints TO authenticated;
CREATE POLICY ienvia_checkpoint_read ON public.ienvia_campanha_checkpoints
  FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()) AND (SELECT public.zapia_is_user_active(auth.uid())));
CREATE POLICY ienvia_checkpoint_insert ON public.ienvia_campanha_checkpoints
  FOR INSERT TO authenticated WITH CHECK (
    owner_id = (SELECT auth.uid()) AND (SELECT public.zapia_is_user_active(auth.uid())) AND status = 'pendente' AND tentativa_id IS NULL AND material IS NULL
  );

-- SECURITY DEFINER é necessário aqui porque a atualização direta não é concedida ao cliente.
-- O corpo é privado, qualifica relações e valida explicitamente o proprietário via auth.uid().
CREATE FUNCTION ienvia_private.reservar_etapa(
  p_campanha uuid,p_destinatario uuid,p_etapa integer,p_tentativa uuid,p_material jsonb
) RETURNS SETOF public.ienvia_campanha_checkpoints
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.ienvia_campanha_checkpoints
     SET status='em_envio',tentativa_id=p_tentativa,material=COALESCE(material,p_material),atualizado_em=pg_catalog.now()
   WHERE owner_id=(SELECT auth.uid()) AND (SELECT public.zapia_is_user_active(auth.uid())) AND campanha_id=p_campanha AND destinatario_id=p_destinatario
     AND etapa=p_etapa AND status='pendente' AND p_tentativa IS NOT NULL
     AND pg_catalog.jsonb_typeof(p_material)='object' AND pg_catalog.length(p_material::text)<=16000
     AND (material IS NULL OR material=p_material)
     AND NOT EXISTS (
       SELECT 1 FROM public.ienvia_campanha_checkpoints ocupado
       WHERE ocupado.owner_id=(SELECT auth.uid()) AND ocupado.campanha_id=p_campanha
         AND ocupado.status IN ('em_envio','incerta')
     )
     AND p_etapa = (
       SELECT pg_catalog.count(*) FROM public.ienvia_campanha_checkpoints anteriores
       WHERE anteriores.owner_id=(SELECT auth.uid()) AND anteriores.campanha_id=p_campanha
         AND anteriores.destinatario_id=p_destinatario AND anteriores.etapa < p_etapa
         AND anteriores.status='confirmada'
     )
  RETURNING *;
$$;
REVOKE ALL ON FUNCTION ienvia_private.reservar_etapa(uuid,uuid,integer,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.reservar_etapa(uuid,uuid,integer,uuid,jsonb) TO authenticated;
CREATE FUNCTION public.ienvia_reservar_etapa(p_campanha uuid,p_destinatario uuid,p_etapa integer,p_tentativa uuid,p_material jsonb)
RETURNS SETOF public.ienvia_campanha_checkpoints
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM ienvia_private.reservar_etapa($1,$2,$3,$4,$5);
$$;
REVOKE ALL ON FUNCTION public.ienvia_reservar_etapa(uuid,uuid,integer,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_reservar_etapa(uuid,uuid,integer,uuid,jsonb) TO authenticated;

-- Confirma somente a tentativa que estava em envio. Confirmação do motor não é leitura.
CREATE FUNCTION ienvia_private.confirmar_etapa(
  p_campanha uuid,p_destinatario uuid,p_etapa integer,p_tentativa uuid
) RETURNS SETOF public.ienvia_campanha_checkpoints
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.ienvia_campanha_checkpoints
     SET status='confirmada',atualizado_em=pg_catalog.now()
   WHERE owner_id=(SELECT auth.uid()) AND (SELECT public.zapia_is_user_active(auth.uid())) AND campanha_id=p_campanha AND destinatario_id=p_destinatario
     AND etapa=p_etapa AND status='em_envio' AND tentativa_id=p_tentativa
  RETURNING *;
$$;
REVOKE ALL ON FUNCTION ienvia_private.confirmar_etapa(uuid,uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.confirmar_etapa(uuid,uuid,integer,uuid) TO authenticated;
CREATE FUNCTION public.ienvia_confirmar_etapa(p_campanha uuid,p_destinatario uuid,p_etapa integer,p_tentativa uuid)
RETURNS SETOF public.ienvia_campanha_checkpoints
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM ienvia_private.confirmar_etapa($1,$2,$3,$4);
$$;
REVOKE ALL ON FUNCTION public.ienvia_confirmar_etapa(uuid,uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_confirmar_etapa(uuid,uuid,integer,uuid) TO authenticated;

-- Somente a tentativa vigente passa a incerta; nunca libera reenvio automático.
CREATE FUNCTION ienvia_private.marcar_etapa_incerta(
  p_campanha uuid,p_destinatario uuid,p_etapa integer,p_tentativa uuid
) RETURNS SETOF public.ienvia_campanha_checkpoints
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.ienvia_campanha_checkpoints
     SET status='incerta',atualizado_em=pg_catalog.now()
   WHERE owner_id=(SELECT auth.uid()) AND (SELECT public.zapia_is_user_active(auth.uid()))
     AND campanha_id=p_campanha AND destinatario_id=p_destinatario AND etapa=p_etapa
     AND status='em_envio' AND tentativa_id=p_tentativa
  RETURNING *;
$$;
REVOKE ALL ON FUNCTION ienvia_private.marcar_etapa_incerta(uuid,uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.marcar_etapa_incerta(uuid,uuid,integer,uuid) TO authenticated;
CREATE FUNCTION public.ienvia_marcar_etapa_incerta(p_campanha uuid,p_destinatario uuid,p_etapa integer,p_tentativa uuid)
RETURNS SETOF public.ienvia_campanha_checkpoints LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT * FROM ienvia_private.marcar_etapa_incerta($1,$2,$3,$4);
$$;
REVOKE ALL ON FUNCTION public.ienvia_marcar_etapa_incerta(uuid,uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_marcar_etapa_incerta(uuid,uuid,integer,uuid) TO authenticated;

-- A decisão é manual e só deve ser exposta depois de avisar sobre possível duplicidade.
CREATE FUNCTION ienvia_private.resolver_etapa_incerta(
  p_campanha uuid,p_destinatario uuid,p_etapa integer,p_tentativa uuid,p_decisao text
) RETURNS SETOF public.ienvia_campanha_checkpoints
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.ienvia_campanha_checkpoints
     SET status=CASE WHEN p_decisao='confirmada' THEN 'confirmada' ELSE 'pendente' END,
         tentativa_id=CASE WHEN p_decisao='confirmada' THEN tentativa_id ELSE NULL END,
         atualizado_em=pg_catalog.now()
   WHERE owner_id=(SELECT auth.uid()) AND (SELECT public.zapia_is_user_active(auth.uid()))
     AND campanha_id=p_campanha AND destinatario_id=p_destinatario AND etapa=p_etapa
     AND status='incerta' AND tentativa_id=p_tentativa AND p_decisao IN ('confirmada','nao_enviada')
  RETURNING *;
$$;
REVOKE ALL ON FUNCTION ienvia_private.resolver_etapa_incerta(uuid,uuid,integer,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.resolver_etapa_incerta(uuid,uuid,integer,uuid,text) TO authenticated;
CREATE FUNCTION public.ienvia_resolver_etapa_incerta(p_campanha uuid,p_destinatario uuid,p_etapa integer,p_tentativa uuid,p_decisao text)
RETURNS SETOF public.ienvia_campanha_checkpoints LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT * FROM ienvia_private.resolver_etapa_incerta($1,$2,$3,$4,$5);
$$;
REVOKE ALL ON FUNCTION public.ienvia_resolver_etapa_incerta(uuid,uuid,integer,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_resolver_etapa_incerta(uuid,uuid,integer,uuid,text) TO authenticated;
