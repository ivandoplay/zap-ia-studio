-- Experimento: destinatários privados e checkpoints criados na mesma transação.
-- Ainda não inclui blocos, mídia, API, UI ou worker de produção.
ALTER TABLE public.ienvia_campanhas_controle ADD COLUMN blocos_total integer NOT NULL DEFAULT 1 CHECK (blocos_total BETWEEN 1 AND 100);
CREATE TABLE public.ienvia_campanha_destinatarios (
 owner_id uuid NOT NULL,
 campanha_id uuid NOT NULL,
 destinatario_id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
 telefone text NOT NULL CHECK (telefone ~ '^[1-9][0-9]{7,14}$'),
 nome text NOT NULL DEFAULT '' CHECK (pg_catalog.length(nome)<=200),
 campos jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_catalog.jsonb_typeof(campos)='object' AND pg_catalog.length(campos::text)<=8000),
 ordem bigint NOT NULL CHECK (ordem BETWEEN 1 AND 10000),
 PRIMARY KEY (owner_id,campanha_id,destinatario_id),
 UNIQUE (owner_id,campanha_id,telefone),
 UNIQUE (owner_id,campanha_id,ordem),
 FOREIGN KEY (owner_id,campanha_id) REFERENCES public.ienvia_campanhas_controle(owner_id,campanha_id) ON DELETE CASCADE
);
ALTER TABLE public.ienvia_campanha_destinatarios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_campanha_destinatarios FROM PUBLIC;
GRANT SELECT ON public.ienvia_campanha_destinatarios TO authenticated;
CREATE POLICY ienvia_destinatarios_read ON public.ienvia_campanha_destinatarios FOR SELECT TO authenticated
 USING (owner_id=(SELECT auth.uid()) AND (SELECT public.zapia_is_user_active(auth.uid())));
CREATE INDEX ienvia_checkpoint_restantes_idx ON public.ienvia_campanha_checkpoints (owner_id,campanha_id,destinatario_id) WHERE status<>'confirmada';
ALTER TABLE public.ienvia_campanha_checkpoints ADD CONSTRAINT ienvia_checkpoint_destinatario_fk
 FOREIGN KEY (owner_id,campanha_id,destinatario_id) REFERENCES public.ienvia_campanha_destinatarios(owner_id,campanha_id,destinatario_id) ON DELETE CASCADE;
-- Somente a função de destinatários cria checkpoints com um destinatário existente.
REVOKE ALL ON FUNCTION public.ienvia_adicionar_etapas(uuid,jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION ienvia_private.adicionar_etapas(uuid,jsonb) FROM authenticated;
CREATE FUNCTION ienvia_private.adicionar_destinatarios(p_campanha uuid,p_lista jsonb)
RETURNS SETOF public.ienvia_campanha_destinatarios LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE controle public.ienvia_campanhas_controle%ROWTYPE; registro jsonb; destino public.ienvia_campanha_destinatarios%ROWTYPE; ordem_atual bigint;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 SELECT c.* INTO controle FROM public.ienvia_campanhas_controle AS c WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha FOR UPDATE;
 IF NOT FOUND OR controle.status='concluida' THEN RETURN; END IF;
 IF p_lista IS NULL OR pg_catalog.jsonb_typeof(p_lista)<>'array' THEN RAISE EXCEPTION 'Lista inválida' USING ERRCODE='23514'; END IF;
 IF pg_catalog.jsonb_array_length(p_lista) NOT BETWEEN 1 AND 500 OR pg_catalog.length(p_lista::text)>500000 THEN RAISE EXCEPTION 'Lista fora do limite' USING ERRCODE='23514'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_lista) AS v(e)
   WHERE pg_catalog.jsonb_typeof(v.e) IS DISTINCT FROM 'object'
      OR pg_catalog.jsonb_typeof(v.e->'telefone') IS DISTINCT FROM 'string'
      OR (v.e->>'telefone') !~ '^[1-9][0-9]{7,14}$'
      OR (v.e ? 'nome' AND pg_catalog.jsonb_typeof(v.e->'nome') IS DISTINCT FROM 'string')
      OR pg_catalog.length(COALESCE(v.e->>'nome',''))>200
      OR (v.e ? 'campos' AND pg_catalog.jsonb_typeof(v.e->'campos') IS DISTINCT FROM 'object')
      OR (v.e-'telefone'-'nome'-'campos')<>'{}'::jsonb)
 THEN RAISE EXCEPTION 'Destinatário inválido' USING ERRCODE='23514'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_lista) AS v(e)
   CROSS JOIN LATERAL pg_catalog.jsonb_each(COALESCE(v.e->'campos','{}'::jsonb)) AS f(chave,valor)
   WHERE f.chave !~ '^[a-z0-9_]{1,60}$' OR f.chave IN ('__proto__','prototype','constructor','nome','telefone')
      OR pg_catalog.jsonb_typeof(f.valor)<>'string' OR pg_catalog.length(f.valor#>>'{}')>2000)
 THEN RAISE EXCEPTION 'Campo personalizado inválido' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(max(d.ordem),0) INTO ordem_atual FROM public.ienvia_campanha_destinatarios AS d WHERE d.owner_id=(SELECT auth.uid()) AND d.campanha_id=p_campanha;
 IF ordem_atual+pg_catalog.jsonb_array_length(p_lista)>10000 OR (ordem_atual+pg_catalog.jsonb_array_length(p_lista))*controle.blocos_total>100000 THEN
   RAISE EXCEPTION 'Limite de destinatários ou etapas excedido' USING ERRCODE='23514'; END IF;
 FOR registro IN SELECT value FROM pg_catalog.jsonb_array_elements(p_lista) LOOP
   ordem_atual=ordem_atual+1;
   INSERT INTO public.ienvia_campanha_destinatarios(owner_id,campanha_id,telefone,nome,campos,ordem)
    VALUES ((SELECT auth.uid()),p_campanha,registro->>'telefone',COALESCE(registro->>'nome',''),COALESCE(registro->'campos','{}'::jsonb),ordem_atual) RETURNING * INTO destino;
   INSERT INTO public.ienvia_campanha_checkpoints(owner_id,campanha_id,destinatario_id,etapa)
    SELECT (SELECT auth.uid()),p_campanha,destino.destinatario_id,i FROM pg_catalog.generate_series(0,controle.blocos_total-1) AS g(i);
   RETURN NEXT destino;
 END LOOP;
 UPDATE public.ienvia_campanhas_controle AS c SET revisao=c.revisao+1
   WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.adicionar_destinatarios(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.adicionar_destinatarios(uuid,jsonb) TO authenticated;
CREATE FUNCTION public.ienvia_adicionar_destinatarios(p_campanha uuid,p_lista jsonb)
RETURNS SETOF public.ienvia_campanha_destinatarios LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT * FROM ienvia_private.adicionar_destinatarios($1,$2);
$$;
REVOKE ALL ON FUNCTION public.ienvia_adicionar_destinatarios(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_adicionar_destinatarios(uuid,jsonb) TO authenticated;

-- A view herda o RLS do solicitante, não autoriza envio e é apenas sugestão:
-- o RPC de reserva deve revalidar tudo sob lock antes de chamar o WhatsApp.
CREATE VIEW public.ienvia_campanha_proxima_etapa WITH (security_invoker=true,security_barrier=true) AS
 SELECT c.owner_id,c.campanha_id,c.revisao,c.proxima_acao_em,c.pausa_tipo,
        proximo.destinatario_id,proximo.telefone,proximo.nome,proximo.campos,proximo.ordem,proximo.etapa
 FROM public.ienvia_campanhas_controle AS c
 CROSS JOIN LATERAL (
  SELECT d.destinatario_id,d.telefone,d.nome,d.campos,d.ordem,e.etapa
  FROM public.ienvia_campanha_destinatarios AS d
  CROSS JOIN LATERAL (
   SELECT x.etapa FROM public.ienvia_campanha_checkpoints AS x
   WHERE x.owner_id=d.owner_id AND x.campanha_id=d.campanha_id AND x.destinatario_id=d.destinatario_id AND x.status='pendente'
   ORDER BY x.etapa LIMIT 1
  ) AS e
  WHERE d.owner_id=c.owner_id AND d.campanha_id=c.campanha_id AND (c.destinatario_corrente IS NULL OR c.destinatario_corrente=d.destinatario_id)
  ORDER BY d.ordem LIMIT 1
 ) AS proximo
 WHERE c.status='ativa' AND NOT EXISTS (
  SELECT 1 FROM public.ienvia_campanha_checkpoints AS ocupado
  WHERE ocupado.owner_id=c.owner_id AND ocupado.campanha_id=c.campanha_id AND ocupado.status IN ('em_envio','incerta')
 );
REVOKE ALL ON public.ienvia_campanha_proxima_etapa FROM PUBLIC;
GRANT SELECT ON public.ienvia_campanha_proxima_etapa TO authenticated;

-- O worker apresenta a revisão da configuração que usou para preparar o material.
-- A consulta e a reserva ocorrem sob o mesmo lock das alterações da campanha.
CREATE FUNCTION ienvia_private.reservar_campanha(p_campanha uuid,p_destinatario uuid,p_etapa integer,p_tentativa uuid,p_material jsonb,p_revisao bigint)
RETURNS SETOF public.ienvia_campanha_checkpoints LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 PERFORM 1 FROM public.ienvia_campanhas_controle AS c WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha AND c.revisao=p_revisao FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_proxima_etapa AS x WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.destinatario_id=p_destinatario AND x.etapa=p_etapa AND x.revisao=p_revisao) THEN RETURN; END IF;
 RETURN QUERY SELECT * FROM ienvia_private.reservar_etapa(p_campanha,p_destinatario,p_etapa,p_tentativa,p_material);
END $$;
REVOKE ALL ON FUNCTION ienvia_private.reservar_campanha(uuid,uuid,integer,uuid,jsonb,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.reservar_campanha(uuid,uuid,integer,uuid,jsonb,bigint) TO authenticated;
CREATE FUNCTION public.ienvia_reservar_campanha(p_campanha uuid,p_destinatario uuid,p_etapa integer,p_tentativa uuid,p_material jsonb,p_revisao bigint)
RETURNS SETOF public.ienvia_campanha_checkpoints LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT * FROM ienvia_private.reservar_campanha($1,$2,$3,$4,$5,$6);
$$;
REVOKE ALL ON FUNCTION public.ienvia_reservar_campanha(uuid,uuid,integer,uuid,jsonb,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_reservar_campanha(uuid,uuid,integer,uuid,jsonb,bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.ienvia_reservar_etapa(uuid,uuid,integer,uuid,jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION ienvia_private.reservar_etapa(uuid,uuid,integer,uuid,jsonb) FROM authenticated;
