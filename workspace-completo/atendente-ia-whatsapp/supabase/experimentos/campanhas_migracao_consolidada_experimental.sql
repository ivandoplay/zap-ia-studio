-- EXPERIMENTAL: NÃO APLICAR À PRODUÇÃO ANTES DE REVISÃO E TESTES REAIS.
-- Gerado automaticamente; aplicar integralmente em transação única.

-- ==== 20261029_campanha_checkpoints.sql ====
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

-- ==== 20261029_campanha_controle.sql ====
-- Experimento de controle de execução; aplicar somente no banco de laboratório.
-- Inclui regras experimentais de horários e lotes; não implementa edição, mídia nem integração com o worker.
CREATE FUNCTION ienvia_private.fuso_valido(p_fuso text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names AS z WHERE z.name=p_fuso);
$$;
REVOKE ALL ON FUNCTION ienvia_private.fuso_valido(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.fuso_valido(text) TO authenticated;
CREATE FUNCTION ienvia_private.permitido_no_instante(p_restrito boolean,p_fuso text,p_dias smallint[],p_inicio time,p_fim time,p_instante timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH horario AS (SELECT pg_catalog.timezone(p_fuso,p_instante) AS local)
 SELECT COALESCE(NOT p_restrito OR
   (p_inicio<p_fim AND extract(dow FROM h.local)::int=ANY(p_dias) AND h.local::time>=p_inicio AND h.local::time<p_fim)
   OR (p_inicio>p_fim AND (
     (extract(dow FROM h.local)::int=ANY(p_dias) AND h.local::time>=p_inicio)
     OR (((extract(dow FROM h.local)::int+6)%7)=ANY(p_dias) AND h.local::time<p_fim)
   )),false) FROM horario AS h;
$$;
REVOKE ALL ON FUNCTION ienvia_private.permitido_no_instante(boolean,text,smallint[],time,time,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.permitido_no_instante(boolean,text,smallint[],time,time,timestamptz) TO authenticated;
CREATE TABLE public.ienvia_campanhas_controle (
  owner_id uuid NOT NULL,
  campanha_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','ativa','pausada','concluida')),
  proxima_acao_em timestamptz NOT NULL DEFAULT now(),
  pausa_tipo text CHECK (pausa_tipo IN ('inicio','etapa','pessoa','lote')) DEFAULT 'inicio',
  intervalo_min_ms bigint NOT NULL DEFAULT 0 CHECK (intervalo_min_ms BETWEEN 0 AND 604800000),
  intervalo_max_ms bigint NOT NULL DEFAULT 0 CHECK (intervalo_max_ms BETWEEN intervalo_min_ms AND 604800000),
  pausa_lote_min_ms bigint NOT NULL DEFAULT 0 CHECK (pausa_lote_min_ms BETWEEN 0 AND 604800000),
  pausa_lote_max_ms bigint NOT NULL DEFAULT 0 CHECK (pausa_lote_max_ms BETWEEN pausa_lote_min_ms AND 604800000),
  intervalo_etapas_ms bigint NOT NULL DEFAULT 0 CHECK (intervalo_etapas_ms BETWEEN 0 AND 604800000),
  lote_min integer NOT NULL DEFAULT 1 CHECK (lote_min BETWEEN 1 AND 10000),
  lote_max integer NOT NULL DEFAULT 1 CHECK (lote_max BETWEEN lote_min AND 10000),
  lote_meta integer NOT NULL DEFAULT 1 CHECK (lote_meta BETWEEN 1 AND 10000),
  pessoas_no_lote integer NOT NULL DEFAULT 0 CHECK (pessoas_no_lote BETWEEN 0 AND 10000),
  destinatario_corrente uuid,
  restricao_horaria boolean NOT NULL DEFAULT false,
  fuso text NOT NULL DEFAULT 'America/Fortaleza' CHECK (ienvia_private.fuso_valido(fuso)),
  dias smallint[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6]::smallint[] CHECK (cardinality(dias) BETWEEN 1 AND 7 AND array_position(dias,NULL) IS NULL AND dias <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  inicio time NOT NULL DEFAULT '00:00',
  fim time NOT NULL DEFAULT '23:59',
  CHECK (NOT restricao_horaria OR inicio<>fim),
  revisao bigint NOT NULL DEFAULT 0 CHECK (revisao >= 0),
  PRIMARY KEY (owner_id,campanha_id)
);
ALTER TABLE public.ienvia_campanhas_controle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_campanhas_controle FROM PUBLIC;
GRANT SELECT,INSERT ON public.ienvia_campanhas_controle TO authenticated;
CREATE POLICY ienvia_campanhas_controle_read ON public.ienvia_campanhas_controle
  FOR SELECT TO authenticated USING (owner_id=(SELECT auth.uid()) AND (SELECT public.zapia_is_user_active(auth.uid())));
CREATE POLICY ienvia_campanhas_controle_insert ON public.ienvia_campanhas_controle
  FOR INSERT TO authenticated WITH CHECK (owner_id=(SELECT auth.uid()) AND (SELECT public.zapia_is_user_active(auth.uid())) AND status='rascunho' AND revisao=0 AND pessoas_no_lote=0 AND lote_meta=1 AND pausa_tipo='inicio' AND destinatario_corrente IS NULL);
ALTER TABLE public.ienvia_campanha_checkpoints ADD CONSTRAINT ienvia_controle_proprietario_fk
  FOREIGN KEY (owner_id,campanha_id) REFERENCES public.ienvia_campanhas_controle(owner_id,campanha_id) ON DELETE CASCADE;

-- Toda transição e reserva primeiro bloqueia a mesma linha de campanha. Uma
-- pausa que venceu o lock impede outra reserva; etapa já reservada pode terminar.
CREATE FUNCTION ienvia_private.alterar_status_campanha(p_campanha uuid,p_status text)
RETURNS SETOF public.ienvia_campanhas_controle LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE anterior text;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 SELECT c.status INTO anterior FROM public.ienvia_campanhas_controle AS c
   WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF p_status IS NULL OR NOT ((anterior IN ('rascunho','pausada') AND p_status='ativa') OR (anterior='ativa' AND p_status='pausada')) THEN RETURN; END IF;
 IF p_status='ativa' AND EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints AS x
   WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.status='incerta') THEN RETURN; END IF;
 IF anterior='rascunho' AND NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints AS x WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha) THEN RETURN; END IF;
 RETURN QUERY UPDATE public.ienvia_campanhas_controle AS c SET status=p_status,revisao=c.revisao+1,
   lote_meta=CASE WHEN anterior='rascunho' THEN c.lote_min+pg_catalog.floor(pg_catalog.random()*(c.lote_max-c.lote_min+1))::integer ELSE c.lote_meta END
   WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha RETURNING c.*;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.alterar_status_campanha(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.alterar_status_campanha(uuid,text) TO authenticated;
CREATE FUNCTION public.ienvia_alterar_status_campanha(p_campanha uuid,p_status text)
RETURNS SETOF public.ienvia_campanhas_controle LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT * FROM ienvia_private.alterar_status_campanha($1,$2);
$$;
REVOKE ALL ON FUNCTION public.ienvia_alterar_status_campanha(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_alterar_status_campanha(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION ienvia_private.reservar_etapa(
 p_campanha uuid,p_destinatario uuid,p_etapa integer,p_tentativa uuid,p_material jsonb
) RETURNS SETOF public.ienvia_campanha_checkpoints LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE alterados integer; controle public.ienvia_campanhas_controle; instante timestamptz;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 -- Obter locks antes de conferir o horário; now() é fixo no início da transação.
 SELECT c.* INTO controle FROM public.ienvia_campanhas_controle AS c
  WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM 1 FROM public.ienvia_campanha_checkpoints AS x
  WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.destinatario_id=p_destinatario
    AND x.etapa=p_etapa AND x.status='pendente' FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 instante:=pg_catalog.clock_timestamp();
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE OR controle.status<>'ativa'
    OR controle.proxima_acao_em>instante OR (controle.destinatario_corrente IS NOT NULL AND controle.destinatario_corrente<>p_destinatario)
    OR NOT ienvia_private.permitido_no_instante(controle.restricao_horaria,controle.fuso,controle.dias,controle.inicio,controle.fim,instante) THEN RETURN; END IF;
 RETURN QUERY UPDATE public.ienvia_campanha_checkpoints AS x
  SET status='em_envio',tentativa_id=p_tentativa,material=COALESCE(x.material,p_material),atualizado_em=instante
  WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.destinatario_id=p_destinatario
    AND x.etapa=p_etapa AND x.status='pendente' AND p_tentativa IS NOT NULL
    AND pg_catalog.jsonb_typeof(p_material)='object' AND pg_catalog.length(p_material::text)<=16000
    AND (x.material IS NULL OR x.material=p_material)
    AND NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints AS ocupado
      WHERE ocupado.owner_id=(SELECT auth.uid()) AND ocupado.campanha_id=p_campanha AND ocupado.status IN ('em_envio','incerta'))
    AND p_etapa=(SELECT pg_catalog.count(*) FROM public.ienvia_campanha_checkpoints AS anteriores
      WHERE anteriores.owner_id=(SELECT auth.uid()) AND anteriores.campanha_id=p_campanha
        AND anteriores.destinatario_id=p_destinatario AND anteriores.etapa<p_etapa AND anteriores.status='confirmada')
  RETURNING x.*;
 GET DIAGNOSTICS alterados = ROW_COUNT;
 IF alterados=1 THEN UPDATE public.ienvia_campanhas_controle AS c SET destinatario_corrente=p_destinatario,pausa_tipo=NULL,revisao=c.revisao+1
   WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha; END IF;
END $$;

CREATE OR REPLACE FUNCTION ienvia_private.marcar_etapa_incerta(p_campanha uuid,p_destinatario uuid,p_etapa integer,p_tentativa uuid)
RETURNS SETOF public.ienvia_campanha_checkpoints LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE alterados integer;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 PERFORM 1 FROM public.ienvia_campanhas_controle AS c WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 RETURN QUERY UPDATE public.ienvia_campanha_checkpoints AS x SET status='incerta',atualizado_em=pg_catalog.now()
   WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.destinatario_id=p_destinatario
     AND x.etapa=p_etapa AND x.status='em_envio' AND x.tentativa_id=p_tentativa RETURNING x.*;
 GET DIAGNOSTICS alterados = ROW_COUNT;
 IF alterados=1 THEN
   UPDATE public.ienvia_campanhas_controle AS c SET status='pausada',revisao=c.revisao+1
     WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION ienvia_private.confirmar_etapa(p_campanha uuid,p_destinatario uuid,p_etapa integer,p_tentativa uuid)
RETURNS SETOF public.ienvia_campanha_checkpoints LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE controle public.ienvia_campanhas_controle%ROWTYPE; alterados integer; ultima_etapa boolean; tem_mais boolean; atraso bigint; novo_total integer;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 SELECT c.* INTO controle FROM public.ienvia_campanhas_controle AS c WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY UPDATE public.ienvia_campanha_checkpoints AS x SET status='confirmada',atualizado_em=pg_catalog.clock_timestamp()
   WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.destinatario_id=p_destinatario
   AND x.etapa=p_etapa AND x.status='em_envio' AND x.tentativa_id=p_tentativa RETURNING x.*;
 GET DIAGNOSTICS alterados = ROW_COUNT;
 IF alterados<>1 THEN RETURN; END IF;
 SELECT NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints AS x WHERE x.owner_id=(SELECT auth.uid())
   AND x.campanha_id=p_campanha AND x.destinatario_id=p_destinatario AND x.status<>'confirmada') INTO ultima_etapa;
 SELECT EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints AS x WHERE x.owner_id=(SELECT auth.uid())
   AND x.campanha_id=p_campanha AND x.status<>'confirmada') INTO tem_mais;
 IF NOT tem_mais THEN
   UPDATE public.ienvia_campanhas_controle AS c SET status='concluida',destinatario_corrente=NULL,pausa_tipo=NULL,revisao=c.revisao+1
   WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha;
 ELSIF NOT ultima_etapa THEN
   UPDATE public.ienvia_campanhas_controle AS c SET proxima_acao_em=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>controle.intervalo_etapas_ms::double precision/1000),pausa_tipo='etapa',revisao=c.revisao+1
   WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha;
 ELSE
   novo_total=controle.pessoas_no_lote+1;
   IF novo_total>=controle.lote_meta THEN
     atraso=controle.pausa_lote_min_ms+pg_catalog.floor(pg_catalog.random()*(controle.pausa_lote_max_ms-controle.pausa_lote_min_ms+1))::bigint;
     UPDATE public.ienvia_campanhas_controle AS c SET pessoas_no_lote=0,lote_meta=controle.lote_min+pg_catalog.floor(pg_catalog.random()*(controle.lote_max-controle.lote_min+1))::integer,
       destinatario_corrente=NULL,pausa_tipo='lote',proxima_acao_em=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>atraso::double precision/1000),revisao=c.revisao+1
     WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha;
   ELSE
     atraso=controle.intervalo_min_ms+pg_catalog.floor(pg_catalog.random()*(controle.intervalo_max_ms-controle.intervalo_min_ms+1))::bigint;
     UPDATE public.ienvia_campanhas_controle AS c SET pessoas_no_lote=novo_total,destinatario_corrente=NULL,pausa_tipo='pessoa',
       proxima_acao_em=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>atraso::double precision/1000),revisao=c.revisao+1
     WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha;
   END IF;
 END IF;
END $$;

CREATE FUNCTION ienvia_private.pular_pausa_campanha(p_campanha uuid)
RETURNS SETOF public.ienvia_campanhas_controle LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 RETURN QUERY UPDATE public.ienvia_campanhas_controle AS c SET proxima_acao_em=pg_catalog.now(),pausa_tipo=NULL,revisao=c.revisao+1
 WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha AND c.status IN ('ativa','pausada')
   AND c.pausa_tipo IN ('pessoa','lote') AND c.proxima_acao_em>pg_catalog.now() RETURNING c.*;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.pular_pausa_campanha(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.pular_pausa_campanha(uuid) TO authenticated;
CREATE FUNCTION public.ienvia_pular_pausa_campanha(p_campanha uuid) RETURNS SETOF public.ienvia_campanhas_controle
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM ienvia_private.pular_pausa_campanha($1); $$;
REVOKE ALL ON FUNCTION public.ienvia_pular_pausa_campanha(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_pular_pausa_campanha(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION ienvia_private.resolver_etapa_incerta(p_campanha uuid,p_destinatario uuid,p_etapa integer,p_tentativa uuid,p_decisao text)
RETURNS SETOF public.ienvia_campanha_checkpoints LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 PERFORM 1 FROM public.ienvia_campanhas_controle AS c WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha FOR UPDATE;
 IF NOT FOUND OR p_decisao IS NULL OR p_decisao NOT IN ('confirmada','nao_enviada') THEN RETURN; END IF;
 IF p_decisao='confirmada' THEN
   UPDATE public.ienvia_campanha_checkpoints AS x SET status='em_envio',atualizado_em=pg_catalog.now()
    WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.destinatario_id=p_destinatario
      AND x.etapa=p_etapa AND x.status='incerta' AND x.tentativa_id=p_tentativa;
   IF FOUND THEN RETURN QUERY SELECT * FROM ienvia_private.confirmar_etapa(p_campanha,p_destinatario,p_etapa,p_tentativa); END IF;
 ELSE
   RETURN QUERY UPDATE public.ienvia_campanha_checkpoints AS x SET status='pendente',tentativa_id=NULL,atualizado_em=pg_catalog.now()
    WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.destinatario_id=p_destinatario
      AND x.etapa=p_etapa AND x.status='incerta' AND x.tentativa_id=p_tentativa RETURNING x.*;
 END IF;
END $$;

-- ==== 20261029_campanha_insercao.sql ====
-- Evita que INSERT direto contorne o lock da campanha ou edite pessoa iniciada.
-- Experimento: não aplicado em produção.
REVOKE INSERT ON public.ienvia_campanha_checkpoints FROM authenticated;
DROP POLICY ienvia_checkpoint_insert ON public.ienvia_campanha_checkpoints;
CREATE FUNCTION ienvia_private.adicionar_etapas(p_campanha uuid,p_etapas jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE situacao text; quantidade integer;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN 0; END IF;
 SELECT c.status INTO situacao FROM public.ienvia_campanhas_controle AS c
  WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha FOR UPDATE;
 IF NOT FOUND OR situacao='concluida' THEN RETURN 0; END IF;
 IF p_etapas IS NULL OR pg_catalog.jsonb_typeof(p_etapas)<>'array' THEN RAISE EXCEPTION 'Lista de etapas inválida' USING ERRCODE='23514'; END IF;
 IF pg_catalog.jsonb_array_length(p_etapas) NOT BETWEEN 1 AND 2000 OR pg_catalog.length(p_etapas::text)>1000000 THEN RAISE EXCEPTION 'Lista de etapas fora do limite' USING ERRCODE='23514'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_etapas) AS v(e)
   WHERE pg_catalog.jsonb_typeof(v.e) IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(v.e->'destinatario_id') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(v.e->'etapa') IS DISTINCT FROM 'number' OR (v.e-'destinatario_id'-'etapa')<>'{}'::jsonb
      OR (v.e->>'destinatario_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR (v.e->>'etapa') !~ '^([0-9]|[1-9][0-9])$') THEN RAISE EXCEPTION 'Etapa inválida' USING ERRCODE='23514'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_etapas) AS v(e)
   JOIN public.ienvia_campanha_checkpoints AS x ON x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.destinatario_id=(v.e->>'destinatario_id')::uuid
   WHERE x.status<>'pendente' OR x.material IS NOT NULL) THEN RAISE EXCEPTION 'Pessoa já iniciada não pode ser alterada' USING ERRCODE='23514'; END IF;
 INSERT INTO public.ienvia_campanha_checkpoints(owner_id,campanha_id,destinatario_id,etapa)
 SELECT (SELECT auth.uid()),p_campanha,(v.e->>'destinatario_id')::uuid,(v.e->>'etapa')::integer FROM pg_catalog.jsonb_array_elements(p_etapas) AS v(e);
 GET DIAGNOSTICS quantidade = ROW_COUNT;
 IF EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints AS x
   WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.destinatario_id IN
     (SELECT (v.e->>'destinatario_id')::uuid FROM pg_catalog.jsonb_array_elements(p_etapas) AS v(e))
   GROUP BY x.destinatario_id HAVING min(x.etapa)<>0 OR max(x.etapa)+1<>count(*))
 THEN RAISE EXCEPTION 'Etapas devem ser sequenciais desde zero' USING ERRCODE='23514'; END IF;
 RETURN quantidade;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.adicionar_etapas(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.adicionar_etapas(uuid,jsonb) TO authenticated;
CREATE FUNCTION public.ienvia_adicionar_etapas(p_campanha uuid,p_etapas jsonb) RETURNS integer
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT ienvia_private.adicionar_etapas($1,$2); $$;
REVOKE ALL ON FUNCTION public.ienvia_adicionar_etapas(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_adicionar_etapas(uuid,jsonb) TO authenticated;

-- ==== 20261029_campanha_destinatarios.sql ====
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

-- ==== 20261029_campanha_planos.sql ====
-- Experimento isolado: plano, etapas versionadas e edição transacional.
-- Não executar em produção antes da conclusão de mídia, worker e testes de integração.
ALTER TABLE public.ienvia_campanhas_controle ADD COLUMN plano jsonb;
ALTER TABLE public.ienvia_campanha_checkpoints ADD COLUMN bloco_id uuid;
ALTER TABLE public.ienvia_campanha_checkpoints ADD COLUMN bloco_config jsonb;
CREATE UNIQUE INDEX ienvia_checkpoint_bloco_unico ON public.ienvia_campanha_checkpoints(owner_id,campanha_id,destinatario_id,bloco_id);
REVOKE INSERT ON public.ienvia_campanhas_controle FROM authenticated;

-- Os objetos binários devem ficar em bucket privado; este experimento só mantém metadados.
CREATE TABLE public.ienvia_campanha_pastas (
 owner_id uuid NOT NULL, pasta_id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
 nome text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(nome)) BETWEEN 1 AND 120),
 tipo text NOT NULL CHECK (tipo IN ('imagem','audio')), criada_em timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 PRIMARY KEY(owner_id,pasta_id)
);
CREATE TABLE public.ienvia_campanha_arquivos (
 owner_id uuid NOT NULL, arquivo_id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(), pasta_id uuid NOT NULL,
 tipo text NOT NULL CHECK (tipo IN ('imagem','audio')), caminho text NOT NULL CHECK (pg_catalog.length(caminho) BETWEEN 1 AND 500),
 mime text NOT NULL CHECK (pg_catalog.length(mime) BETWEEN 1 AND 120), tamanho bigint NOT NULL CHECK (tamanho BETWEEN 1 AND 36700160),
 ordem integer NOT NULL CHECK (ordem BETWEEN 1 AND 10000), excluindo boolean NOT NULL DEFAULT false,
 PRIMARY KEY(owner_id,arquivo_id), UNIQUE(owner_id,pasta_id,ordem), UNIQUE(owner_id,caminho),
 FOREIGN KEY(owner_id,pasta_id) REFERENCES public.ienvia_campanha_pastas(owner_id,pasta_id) ON DELETE RESTRICT
);
ALTER TABLE public.ienvia_campanha_pastas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ienvia_campanha_arquivos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_campanha_pastas,public.ienvia_campanha_arquivos FROM PUBLIC;
GRANT SELECT ON public.ienvia_campanha_pastas,public.ienvia_campanha_arquivos TO authenticated;
CREATE POLICY ienvia_pastas_own ON public.ienvia_campanha_pastas FOR SELECT TO authenticated USING(owner_id=(SELECT auth.uid()) AND (SELECT public.zapia_is_user_active(auth.uid())));
CREATE POLICY ienvia_arquivos_own ON public.ienvia_campanha_arquivos FOR SELECT TO authenticated USING(owner_id=(SELECT auth.uid()) AND (SELECT public.zapia_is_user_active(auth.uid())));

CREATE FUNCTION ienvia_private.validar_plano(p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE bloco jsonb; n integer; ids text[]:=ARRAY[]::text[]; id text; chip text; chips text[]:=ARRAY[]::text[];
BEGIN
 IF p IS NULL OR pg_catalog.jsonb_typeof(p)<>'object' OR pg_catalog.length(p::text)>250000 THEN RAISE EXCEPTION 'Plano inválido' USING ERRCODE='23514'; END IF;
 IF pg_catalog.jsonb_typeof(p->'nome') IS DISTINCT FROM 'string' OR pg_catalog.length(pg_catalog.btrim(p->>'nome')) NOT BETWEEN 1 AND 120
    OR p->>'modoChips' NOT IN ('fixo','rodizio') OR p->>'retomada' NOT IN ('manual','automatica')
    OR p->>'modoChips' IS NULL OR p->>'retomada' IS NULL THEN RAISE EXCEPTION 'Configuração inválida' USING ERRCODE='23514'; END IF;
 IF pg_catalog.jsonb_typeof(p->'chips') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_typeof(p->'blocos') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Listas inválidas' USING ERRCODE='23514'; END IF;
 IF pg_catalog.jsonb_array_length(p->'chips') NOT BETWEEN 1 AND 3 OR pg_catalog.jsonb_array_length(p->'blocos') NOT BETWEEN 1 AND 100 OR (p->>'modoChips'='fixo' AND pg_catalog.jsonb_array_length(p->'chips')<>1) THEN RAISE EXCEPTION 'Limite inválido' USING ERRCODE='23514'; END IF;
 FOR chip IN SELECT value FROM pg_catalog.jsonb_array_elements_text(p->'chips') LOOP
  IF chip NOT IN ('slot_1','slot_2','slot_3') OR chip=ANY(chips) THEN RAISE EXCEPTION 'Chip inválido' USING ERRCODE='23514'; END IF; chips:=pg_catalog.array_append(chips,chip);
 END LOOP;
 FOR bloco IN SELECT value FROM pg_catalog.jsonb_array_elements(p->'blocos') LOOP
  IF pg_catalog.jsonb_typeof(bloco)<>'object' OR pg_catalog.jsonb_typeof(bloco->'id') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Bloco inválido' USING ERRCODE='23514'; END IF;
  id:=pg_catalog.lower(bloco->>'id');
  IF id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR id=ANY(ids) THEN RAISE EXCEPTION 'ID de bloco inválido' USING ERRCODE='23514'; END IF; ids:=pg_catalog.array_append(ids,id);
  IF bloco->>'tipo'='texto' THEN
   IF bloco->>'modo' NOT IN ('fixo','spintax','rotacao','ia') OR bloco->>'modo' IS NULL OR pg_catalog.jsonb_typeof(bloco->'textos') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Texto inválido' USING ERRCODE='23514'; END IF;
   n:=pg_catalog.jsonb_array_length(bloco->'textos');
   IF n NOT BETWEEN 1 AND 20 OR (bloco->>'modo' IN ('fixo','spintax') AND n<>1) OR (bloco->>'modo' IN ('rotacao','ia') AND (bloco->>'selecao' IS NULL OR bloco->>'selecao' NOT IN ('sequencial','aleatorio'))) OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(bloco->'textos') AS x(v) WHERE pg_catalog.jsonb_typeof(x.v)<>'string' OR pg_catalog.length(pg_catalog.btrim(x.v#>>'{}')) NOT BETWEEN 1 AND 5000) THEN RAISE EXCEPTION 'Variações inválidas' USING ERRCODE='23514'; END IF;
  ELSIF bloco->>'tipo' IN ('imagem','audio') THEN
   IF pg_catalog.jsonb_typeof(bloco->'pastaId') IS DISTINCT FROM 'string' OR (bloco->>'pastaId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR bloco->>'selecao' IS NULL OR bloco->>'selecao' NOT IN ('sequencial','aleatorio') OR (bloco->>'tipo'='audio' AND pg_catalog.jsonb_typeof(bloco->'notaVoz') IS DISTINCT FROM 'boolean') THEN RAISE EXCEPTION 'Pasta inválida' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_pastas AS f WHERE f.owner_id=(SELECT auth.uid()) AND f.pasta_id=(bloco->>'pastaId')::uuid AND f.tipo=bloco->>'tipo') THEN RAISE EXCEPTION 'Pasta não encontrada' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Tipo de bloco inválido' USING ERRCODE='23514'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.validar_plano(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION ienvia_private.adicionar_destinatarios(p_campanha uuid,p_lista jsonb)
RETURNS SETOF public.ienvia_campanha_destinatarios LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE controle public.ienvia_campanhas_controle%ROWTYPE; registro jsonb; destino public.ienvia_campanha_destinatarios%ROWTYPE; ordem_atual bigint;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 SELECT c.* INTO controle FROM public.ienvia_campanhas_controle AS c WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha FOR UPDATE;
 IF NOT FOUND OR controle.status='concluida' OR controle.plano IS NULL THEN RETURN; END IF;
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
   INSERT INTO public.ienvia_campanha_checkpoints(owner_id,campanha_id,destinatario_id,etapa,bloco_id,bloco_config)
    SELECT (SELECT auth.uid()),p_campanha,destino.destinatario_id,i,(controle.plano->'blocos'->i->>'id')::uuid,controle.plano->'blocos'->i FROM pg_catalog.generate_series(0,controle.blocos_total-1) AS g(i);
   RETURN NEXT destino;
 END LOOP;
 UPDATE public.ienvia_campanhas_controle AS c SET revisao=c.revisao+1
   WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha;
END $$;

CREATE FUNCTION ienvia_private.criar_campanha(p_plano jsonb,p_opcoes jsonb,p_lista jsonb)
RETURNS SETOF public.ienvia_campanhas_controle LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cid uuid:=pg_catalog.gen_random_uuid(); total integer; inicio integer:=0; parte jsonb; n integer;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 PERFORM ienvia_private.validar_plano(p_plano);
 IF p_opcoes IS NULL OR pg_catalog.jsonb_typeof(p_opcoes)<>'object' OR pg_catalog.length(p_opcoes::text)>20000 OR p_lista IS NULL OR pg_catalog.jsonb_typeof(p_lista)<>'array' OR pg_catalog.length(p_lista::text)>2000000 THEN RAISE EXCEPTION 'Dados inválidos' USING ERRCODE='23514'; END IF;
 total:=pg_catalog.jsonb_array_length(p_lista);
 IF total NOT BETWEEN 1 AND 10000 OR total*pg_catalog.jsonb_array_length(p_plano->'blocos')>100000 THEN RAISE EXCEPTION 'Limite excedido' USING ERRCODE='23514'; END IF;
 INSERT INTO public.ienvia_campanhas_controle(owner_id,campanha_id,nome,plano,blocos_total,proxima_acao_em,
   intervalo_min_ms,intervalo_max_ms,pausa_lote_min_ms,pausa_lote_max_ms,intervalo_etapas_ms,lote_min,lote_max,restricao_horaria,fuso,dias,inicio,fim)
 VALUES ((SELECT auth.uid()),cid,p_plano->>'nome',p_plano,pg_catalog.jsonb_array_length(p_plano->'blocos'),
   COALESCE((p_opcoes->>'inicio_em')::timestamptz,pg_catalog.clock_timestamp()),
   COALESCE((p_opcoes->>'intervalo_min_ms')::bigint,0),COALESCE((p_opcoes->>'intervalo_max_ms')::bigint,0),
   COALESCE((p_opcoes->>'pausa_lote_min_ms')::bigint,0),COALESCE((p_opcoes->>'pausa_lote_max_ms')::bigint,0),COALESCE((p_opcoes->>'intervalo_etapas_ms')::bigint,0),
   COALESCE((p_opcoes->>'lote_min')::int,1),COALESCE((p_opcoes->>'lote_max')::int,1),COALESCE((p_opcoes->>'restricao_horaria')::boolean,false),
   COALESCE(p_opcoes->>'fuso','America/Fortaleza'),
   COALESCE((SELECT pg_catalog.array_agg(x.value::smallint ORDER BY x.ord) FROM pg_catalog.jsonb_array_elements_text(p_opcoes->'dias') WITH ORDINALITY AS x(value,ord)),ARRAY[0,1,2,3,4,5,6]::smallint[]),
   COALESCE((p_opcoes->>'inicio')::time,'00:00'::time),COALESCE((p_opcoes->>'fim')::time,'23:59'::time));
 WHILE inicio<total LOOP
  SELECT pg_catalog.jsonb_agg(x.value ORDER BY x.ord) INTO parte FROM pg_catalog.jsonb_array_elements(p_lista) WITH ORDINALITY AS x(value,ord) WHERE x.ord>inicio AND x.ord<=inicio+500;
  SELECT pg_catalog.count(*) INTO n FROM ienvia_private.adicionar_destinatarios(cid,parte);
  IF n<>pg_catalog.jsonb_array_length(parte) THEN RAISE EXCEPTION 'Não foi possível criar destinatários' USING ERRCODE='23514'; END IF;
  inicio:=inicio+500;
 END LOOP;
 RETURN QUERY SELECT c.* FROM public.ienvia_campanhas_controle AS c WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=cid;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.criar_campanha(jsonb,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.criar_campanha(jsonb,jsonb,jsonb) TO authenticated;
CREATE FUNCTION public.ienvia_criar_campanha(p_plano jsonb,p_opcoes jsonb,p_lista jsonb) RETURNS SETOF public.ienvia_campanhas_controle
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM ienvia_private.criar_campanha($1,$2,$3); $$;
REVOKE ALL ON FUNCTION public.ienvia_criar_campanha(jsonb,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_criar_campanha(jsonb,jsonb,jsonb) TO authenticated;

CREATE FUNCTION ienvia_private.editar_plano_campanha(p_campanha uuid,p_plano jsonb)
RETURNS SETOF public.ienvia_campanhas_controle LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE controle public.ienvia_campanhas_controle; ativos uuid[];
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 SELECT c.* INTO controle FROM public.ienvia_campanhas_controle AS c WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha FOR UPDATE;
 IF NOT FOUND OR controle.status='concluida' OR controle.plano IS NULL THEN RETURN; END IF;
 PERFORM ienvia_private.validar_plano(p_plano);
 SELECT COALESCE(pg_catalog.array_agg(d.destinatario_id),ARRAY[]::uuid[]) INTO ativos FROM public.ienvia_campanha_destinatarios AS d
 WHERE d.owner_id=(SELECT auth.uid()) AND d.campanha_id=p_campanha AND EXISTS
  (SELECT 1 FROM public.ienvia_campanha_checkpoints AS x WHERE x.owner_id=d.owner_id AND x.campanha_id=d.campanha_id AND x.destinatario_id=d.destinatario_id AND x.status<>'confirmada');
 DELETE FROM public.ienvia_campanha_checkpoints AS x WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.destinatario_id=ANY(ativos) AND x.status='pendente' AND x.material IS NULL;
 INSERT INTO public.ienvia_campanha_checkpoints(owner_id,campanha_id,destinatario_id,etapa,bloco_id,bloco_config)
 SELECT (SELECT auth.uid()),p_campanha,d.destinatario_id,
  (base.ultima + pg_catalog.row_number() OVER(PARTITION BY d.destinatario_id ORDER BY blocos.ord))::integer,
  (blocos.bloco->>'id')::uuid,blocos.bloco
 FROM public.ienvia_campanha_destinatarios AS d
 CROSS JOIN LATERAL (SELECT COALESCE(pg_catalog.max(x.etapa),-1) AS ultima FROM public.ienvia_campanha_checkpoints AS x
   WHERE x.owner_id=d.owner_id AND x.campanha_id=d.campanha_id AND x.destinatario_id=d.destinatario_id) AS base
 CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(p_plano->'blocos') WITH ORDINALITY AS blocos(bloco,ord)
 WHERE d.owner_id=(SELECT auth.uid()) AND d.campanha_id=p_campanha AND d.destinatario_id=ANY(ativos)
   AND NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints AS preservado WHERE preservado.owner_id=d.owner_id AND preservado.campanha_id=d.campanha_id AND preservado.destinatario_id=d.destinatario_id AND preservado.bloco_id=(blocos.bloco->>'id')::uuid);
 IF (SELECT pg_catalog.count(*) FROM public.ienvia_campanha_checkpoints AS x WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha)>100000 THEN
  RAISE EXCEPTION 'Limite de etapas excedido' USING ERRCODE='23514';
 END IF;
 IF controle.destinatario_corrente IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints AS x WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.destinatario_id=controle.destinatario_corrente AND x.status<>'confirmada') THEN
   RAISE EXCEPTION 'Mantenha um bloco pendente para a pessoa em andamento' USING ERRCODE='23514';
 END IF;
 RETURN QUERY UPDATE public.ienvia_campanhas_controle AS c SET plano=p_plano,nome=p_plano->>'nome',blocos_total=pg_catalog.jsonb_array_length(p_plano->'blocos'),revisao=c.revisao+1
 WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha RETURNING c.*;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.editar_plano_campanha(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.editar_plano_campanha(uuid,jsonb) TO authenticated;
CREATE FUNCTION public.ienvia_editar_plano_campanha(p_campanha uuid,p_plano jsonb) RETURNS SETOF public.ienvia_campanhas_controle
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM ienvia_private.editar_plano_campanha($1,$2); $$;
REVOKE ALL ON FUNCTION public.ienvia_editar_plano_campanha(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_editar_plano_campanha(uuid,jsonb) TO authenticated;

CREATE OR REPLACE VIEW public.ienvia_campanha_proxima_etapa WITH (security_invoker=true,security_barrier=true) AS
 SELECT c.owner_id,c.campanha_id,c.revisao,c.proxima_acao_em,c.pausa_tipo,
        proximo.destinatario_id,proximo.telefone,proximo.nome,proximo.campos,proximo.ordem,proximo.etapa,proximo.bloco_id,proximo.bloco_config,proximo.material_preparado
 FROM public.ienvia_campanhas_controle AS c
 CROSS JOIN LATERAL (
  SELECT d.destinatario_id,d.telefone,d.nome,d.campos,d.ordem,e.etapa,e.bloco_id,e.bloco_config,e.material_preparado
  FROM public.ienvia_campanha_destinatarios AS d
  CROSS JOIN LATERAL (
   SELECT x.etapa,x.bloco_id,x.bloco_config,x.material AS material_preparado FROM public.ienvia_campanha_checkpoints AS x
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
CREATE OR REPLACE FUNCTION ienvia_private.reservar_campanha(p_campanha uuid,p_destinatario uuid,p_etapa integer,p_tentativa uuid,p_material jsonb,p_revisao bigint)
RETURNS SETOF public.ienvia_campanha_checkpoints LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.ienvia_campanhas_controle; b jsonb; ordem bigint; slot text; salvo jsonb;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 SELECT * INTO c FROM public.ienvia_campanhas_controle AS x WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.revisao=p_revisao FOR UPDATE;
 IF NOT FOUND OR c.plano IS NULL THEN RETURN; END IF;
 SELECT x.bloco_config,x.ordem,x.material_preparado INTO b,ordem,salvo FROM public.ienvia_campanha_proxima_etapa AS x WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.destinatario_id=p_destinatario AND x.etapa=p_etapa AND x.revisao=p_revisao;
 IF NOT FOUND OR b IS NULL OR pg_catalog.jsonb_typeof(p_material) IS DISTINCT FROM 'object' OR (p_material-'slotId'-'bloco')<>'{}'::jsonb OR pg_catalog.jsonb_typeof(p_material->'bloco') IS DISTINCT FROM 'object' THEN RETURN; END IF;
 IF salvo IS NOT NULL THEN
  IF p_material IS DISTINCT FROM salvo THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM ienvia_private.reservar_etapa(p_campanha,p_destinatario,p_etapa,p_tentativa,p_material);
  RETURN;
 END IF;
 slot:=c.plano->'chips'->>((ordem-1)%pg_catalog.jsonb_array_length(c.plano->'chips'))::integer;
 IF p_material->>'slotId' IS DISTINCT FROM slot OR p_material->'bloco'->>'tipo' IS DISTINCT FROM b->>'tipo' THEN RETURN; END IF;
 IF b->>'tipo'='texto' THEN
  IF pg_catalog.jsonb_typeof(p_material->'bloco'->'texto') IS DISTINCT FROM 'string' OR pg_catalog.length(pg_catalog.btrim(p_material->'bloco'->>'texto')) NOT BETWEEN 1 AND 10000 OR ((p_material->'bloco')-'tipo'-'texto')<>'{}'::jsonb THEN RETURN; END IF;
 ELSIF b->>'tipo' IN ('imagem','audio') THEN
  IF p_material->'bloco'->>'pastaId' IS DISTINCT FROM b->>'pastaId' OR (p_material->'bloco'->>'arquivoId') IS NULL OR (p_material->'bloco'->>'arquivoId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN; END IF;
  IF b->>'tipo'='audio' AND (p_material->'bloco'->'notaVoz' IS DISTINCT FROM b->'notaVoz' OR ((p_material->'bloco')-'tipo'-'pastaId'-'arquivoId'-'notaVoz')<>'{}'::jsonb) THEN RETURN; END IF;
  IF b->>'tipo'='imagem' AND ((p_material->'bloco')-'tipo'-'pastaId'-'arquivoId')<>'{}'::jsonb THEN RETURN; END IF;
  PERFORM 1 FROM public.ienvia_campanha_arquivos AS a WHERE a.owner_id=(SELECT auth.uid()) AND a.arquivo_id=(p_material->'bloco'->>'arquivoId')::uuid AND a.pasta_id=(b->>'pastaId')::uuid AND a.tipo=b->>'tipo' AND NOT a.excluindo FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
 ELSE RETURN; END IF;
 RETURN QUERY SELECT * FROM ienvia_private.reservar_etapa(p_campanha,p_destinatario,p_etapa,p_tentativa,p_material);
END $$;

CREATE OR REPLACE FUNCTION ienvia_private.alterar_status_campanha(p_campanha uuid,p_status text)
RETURNS SETOF public.ienvia_campanhas_controle LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE anterior text;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 SELECT c.status INTO anterior FROM public.ienvia_campanhas_controle AS c
   WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF p_status IS NULL OR NOT ((anterior IN ('rascunho','pausada') AND p_status='ativa') OR (anterior='ativa' AND p_status='pausada')) THEN RETURN; END IF;
 IF p_status='ativa' AND EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints AS x
   WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.status='incerta') THEN RETURN; END IF;
 IF p_status='ativa' AND EXISTS (SELECT 1 FROM public.ienvia_campanhas_controle AS c WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha AND (c.plano IS NULL OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(c.plano->'blocos') AS b(bloco) WHERE b.bloco->>'tipo' IN ('imagem','audio') AND NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_arquivos AS a WHERE a.owner_id=c.owner_id AND a.pasta_id=(b.bloco->>'pastaId')::uuid AND a.tipo=b.bloco->>'tipo' AND NOT a.excluindo)))) THEN RETURN; END IF;
 IF anterior='rascunho' AND NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints AS x WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha) THEN RETURN; END IF;
 RETURN QUERY UPDATE public.ienvia_campanhas_controle AS c SET status=p_status,revisao=c.revisao+1,
   lote_meta=CASE WHEN anterior='rascunho' THEN c.lote_min+pg_catalog.floor(pg_catalog.random()*(c.lote_max-c.lote_min+1))::integer ELSE c.lote_meta END
   WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha RETURNING c.*;
END $$;

-- ==== 20261029_campanha_media.sql ====
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

-- ==== 20261029_campanha_edicao.sql ====
-- Edição das opções e do plano na mesma transação. Somente laboratório.
CREATE FUNCTION ienvia_private.editar_configuracao_campanha(p_campanha uuid,p_plano jsonb,p_opcoes jsonb)
RETURNS SETOF public.ienvia_campanhas_controle LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.ienvia_campanhas_controle; n integer;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 SELECT * INTO c FROM public.ienvia_campanhas_controle AS x WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha FOR UPDATE;
 IF NOT FOUND OR c.status='concluida' THEN RETURN; END IF;
 IF p_opcoes IS NULL OR pg_catalog.jsonb_typeof(p_opcoes)<>'object' OR pg_catalog.length(p_opcoes::text)>20000 OR (p_opcoes-ARRAY['intervalo_min_ms','intervalo_max_ms','pausa_lote_min_ms','pausa_lote_max_ms','intervalo_etapas_ms','lote_min','lote_max','restricao_horaria','fuso','dias','inicio','fim','inicio_em'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Opções inválidas' USING ERRCODE='23514'; END IF;
 IF p_opcoes ? 'dias' AND pg_catalog.jsonb_typeof(p_opcoes->'dias')<>'array' THEN RAISE EXCEPTION 'Dias inválidos' USING ERRCODE='23514'; END IF;
 IF p_opcoes ? 'inicio_em' AND c.status<>'rascunho' THEN RAISE EXCEPTION 'Início agendado só pode ser alterado antes da campanha iniciar' USING ERRCODE='23514'; END IF;
 SELECT pg_catalog.count(*) INTO n FROM ienvia_private.editar_plano_campanha(p_campanha,p_plano);
 IF n<>1 THEN RETURN; END IF;
 RETURN QUERY UPDATE public.ienvia_campanhas_controle AS x SET
  intervalo_min_ms=COALESCE((p_opcoes->>'intervalo_min_ms')::bigint,x.intervalo_min_ms),
  intervalo_max_ms=COALESCE((p_opcoes->>'intervalo_max_ms')::bigint,x.intervalo_max_ms),
  pausa_lote_min_ms=COALESCE((p_opcoes->>'pausa_lote_min_ms')::bigint,x.pausa_lote_min_ms),
  pausa_lote_max_ms=COALESCE((p_opcoes->>'pausa_lote_max_ms')::bigint,x.pausa_lote_max_ms),
  intervalo_etapas_ms=COALESCE((p_opcoes->>'intervalo_etapas_ms')::bigint,x.intervalo_etapas_ms),
  lote_min=COALESCE((p_opcoes->>'lote_min')::integer,x.lote_min),lote_max=COALESCE((p_opcoes->>'lote_max')::integer,x.lote_max),
  lote_meta=CASE WHEN x.lote_meta NOT BETWEEN COALESCE((p_opcoes->>'lote_min')::integer,x.lote_min) AND COALESCE((p_opcoes->>'lote_max')::integer,x.lote_max)
    THEN COALESCE((p_opcoes->>'lote_min')::integer,x.lote_min)+pg_catalog.floor(pg_catalog.random()*(COALESCE((p_opcoes->>'lote_max')::integer,x.lote_max)-COALESCE((p_opcoes->>'lote_min')::integer,x.lote_min)+1))::integer ELSE x.lote_meta END,
  restricao_horaria=COALESCE((p_opcoes->>'restricao_horaria')::boolean,x.restricao_horaria),fuso=COALESCE(p_opcoes->>'fuso',x.fuso),
  dias=CASE WHEN p_opcoes ? 'dias' THEN (SELECT pg_catalog.array_agg(v.value::smallint ORDER BY v.ord) FROM pg_catalog.jsonb_array_elements_text(p_opcoes->'dias') WITH ORDINALITY AS v(value,ord)) ELSE x.dias END,
  inicio=COALESCE((p_opcoes->>'inicio')::time,x.inicio),fim=COALESCE((p_opcoes->>'fim')::time,x.fim),
  proxima_acao_em=COALESCE((p_opcoes->>'inicio_em')::timestamptz,x.proxima_acao_em),revisao=x.revisao+1
 WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha RETURNING x.*;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.editar_configuracao_campanha(uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.editar_configuracao_campanha(uuid,jsonb,jsonb) TO authenticated;
CREATE FUNCTION public.ienvia_editar_configuracao_campanha(p_campanha uuid,p_plano jsonb,p_opcoes jsonb) RETURNS SETOF public.ienvia_campanhas_controle
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM ienvia_private.editar_configuracao_campanha($1,$2,$3); $$;
REVOKE ALL ON FUNCTION public.ienvia_editar_configuracao_campanha(uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_editar_configuracao_campanha(uuid,jsonb,jsonb) TO authenticated;

-- ==== 20261029_campanha_uploads.sql ====
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

-- ==== 20261029_campanha_resumo.sql ====
-- Resumo calculado, sob RLS de destinatários e etapas; não indica entrega ou leitura.
CREATE VIEW public.ienvia_campanha_resumo WITH (security_invoker=true,security_barrier=true) AS
 SELECT d.owner_id,d.campanha_id,pg_catalog.count(*)::bigint AS total,
  pg_catalog.count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints x WHERE x.owner_id=d.owner_id AND x.campanha_id=d.campanha_id AND x.destinatario_id=d.destinatario_id AND x.status<>'confirmada'))::bigint AS concluidos,
  pg_catalog.count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints x WHERE x.owner_id=d.owner_id AND x.campanha_id=d.campanha_id AND x.destinatario_id=d.destinatario_id AND x.status='incerta'))::bigint AS incertos
 FROM public.ienvia_campanha_destinatarios d GROUP BY d.owner_id,d.campanha_id;
REVOKE ALL ON public.ienvia_campanha_resumo FROM PUBLIC;
GRANT SELECT ON public.ienvia_campanha_resumo TO authenticated;

-- ==== 20261029_campanha_recuperacao.sql ====
-- Retomada experimental: workers identificam cada processo e renovam heartbeat.
-- Qualquer envio abandonado fica incerto e exige decisão humana; nunca é reenviado.
CREATE TABLE public.ienvia_campanha_workers (
 owner_id uuid NOT NULL,worker_id uuid NOT NULL,device_id text NOT NULL CHECK(pg_catalog.length(device_id) BETWEEN 1 AND 80),
 heartbeat_em timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),PRIMARY KEY(owner_id,worker_id)
);
ALTER TABLE public.ienvia_campanha_workers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_campanha_workers FROM PUBLIC;
GRANT SELECT ON public.ienvia_campanha_workers TO authenticated;
CREATE POLICY ienvia_workers_own ON public.ienvia_campanha_workers FOR SELECT TO authenticated USING(owner_id=(SELECT auth.uid()) AND (SELECT public.zapia_is_user_active(auth.uid())));
ALTER TABLE public.ienvia_campanhas_controle ADD COLUMN ultimo_worker uuid;

CREATE FUNCTION ienvia_private.registrar_worker_campanha(p_worker uuid,p_device text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 IF p_worker IS NULL OR p_device IS NULL OR pg_catalog.length(p_device) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'Worker inválido' USING ERRCODE='23514'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ienvia-workers:'||(SELECT auth.uid())::text,0));
 DELETE FROM public.ienvia_campanha_workers w WHERE w.owner_id=(SELECT auth.uid()) AND w.heartbeat_em<pg_catalog.clock_timestamp()-interval '24 hours';
 IF NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_workers w WHERE w.owner_id=(SELECT auth.uid()) AND w.worker_id=p_worker)
    AND (SELECT pg_catalog.count(*) FROM public.ienvia_campanha_workers w WHERE w.owner_id=(SELECT auth.uid()) AND w.heartbeat_em>pg_catalog.clock_timestamp()-interval '90 seconds')>=20 THEN RAISE EXCEPTION 'Limite de workers' USING ERRCODE='23514'; END IF;
 INSERT INTO public.ienvia_campanha_workers(owner_id,worker_id,device_id,heartbeat_em) VALUES ((SELECT auth.uid()),p_worker,p_device,pg_catalog.clock_timestamp())
 ON CONFLICT(owner_id,worker_id) DO UPDATE SET heartbeat_em=pg_catalog.clock_timestamp(),device_id=EXCLUDED.device_id;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.registrar_worker_campanha(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.registrar_worker_campanha(uuid,text) TO authenticated;
CREATE FUNCTION public.ienvia_registrar_worker_campanha(p_worker uuid,p_device text) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT ienvia_private.registrar_worker_campanha($1,$2); $$;
REVOKE ALL ON FUNCTION public.ienvia_registrar_worker_campanha(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_registrar_worker_campanha(uuid,text) TO authenticated;

CREATE FUNCTION ienvia_private.recuperar_campanha(p_campanha uuid) RETURNS SETOF public.ienvia_campanhas_controle
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.ienvia_campanhas_controle; caiu boolean; pendente boolean; expirado boolean;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 SELECT * INTO c FROM public.ienvia_campanhas_controle x WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF c.status NOT IN ('ativa','pausada') OR c.ultimo_worker IS NULL THEN RETURN NEXT c;RETURN; END IF;
 SELECT NOT EXISTS(SELECT 1 FROM public.ienvia_campanha_workers w WHERE w.owner_id=c.owner_id AND w.worker_id=c.ultimo_worker AND w.heartbeat_em>pg_catalog.clock_timestamp()-interval '90 seconds') INTO caiu;
 SELECT EXISTS(SELECT 1 FROM public.ienvia_campanha_checkpoints x WHERE x.owner_id=c.owner_id AND x.campanha_id=p_campanha AND x.status='em_envio'),
        EXISTS(SELECT 1 FROM public.ienvia_campanha_checkpoints x WHERE x.owner_id=c.owner_id AND x.campanha_id=p_campanha AND x.status='em_envio' AND x.atualizado_em<pg_catalog.clock_timestamp()-interval '15 minutes') INTO pendente,expirado;
 IF (caiu AND pendente) OR expirado THEN
  UPDATE public.ienvia_campanha_checkpoints x SET status='incerta',atualizado_em=pg_catalog.clock_timestamp() WHERE x.owner_id=c.owner_id AND x.campanha_id=p_campanha AND x.status='em_envio';
  RETURN QUERY UPDATE public.ienvia_campanhas_controle x SET status='pausada',revisao=x.revisao+1 WHERE x.owner_id=c.owner_id AND x.campanha_id=p_campanha RETURNING x.*;
 ELSIF c.status='pausada' THEN RETURN NEXT c;
 ELSIF caiu AND c.plano->>'retomada'='manual' THEN
  RETURN QUERY UPDATE public.ienvia_campanhas_controle x SET status='pausada',revisao=x.revisao+1 WHERE x.owner_id=c.owner_id AND x.campanha_id=p_campanha RETURNING x.*;
 ELSIF caiu THEN
  RETURN QUERY UPDATE public.ienvia_campanhas_controle x SET ultimo_worker=NULL,revisao=x.revisao+1 WHERE x.owner_id=c.owner_id AND x.campanha_id=p_campanha RETURNING x.*;
 ELSE RETURN NEXT c; END IF;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.recuperar_campanha(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.recuperar_campanha(uuid) TO authenticated;
CREATE FUNCTION public.ienvia_recuperar_campanha(p_campanha uuid) RETURNS SETOF public.ienvia_campanhas_controle LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM ienvia_private.recuperar_campanha($1); $$;
REVOKE ALL ON FUNCTION public.ienvia_recuperar_campanha(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_recuperar_campanha(uuid) TO authenticated;

CREATE FUNCTION ienvia_private.reservar_worker_campanha(p_campanha uuid,p_destinatario uuid,p_etapa integer,p_tentativa uuid,p_material jsonb,p_revisao bigint,p_worker uuid)
RETURNS SETOF public.ienvia_campanha_checkpoints LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.ienvia_campanhas_controle; cp public.ienvia_campanha_checkpoints;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 SELECT * INTO c FROM ienvia_private.recuperar_campanha(p_campanha);
 IF NOT FOUND OR c.status<>'ativa' OR c.revisao<>p_revisao OR p_worker IS NULL OR NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_workers w WHERE w.owner_id=(SELECT auth.uid()) AND w.worker_id=p_worker AND w.heartbeat_em>pg_catalog.clock_timestamp()-interval '90 seconds') THEN RETURN; END IF;
 FOR cp IN SELECT * FROM ienvia_private.reservar_campanha(p_campanha,p_destinatario,p_etapa,p_tentativa,p_material,p_revisao) LOOP
  UPDATE public.ienvia_campanhas_controle x SET ultimo_worker=p_worker WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha;
  RETURN NEXT cp;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.reservar_worker_campanha(uuid,uuid,integer,uuid,jsonb,bigint,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.reservar_worker_campanha(uuid,uuid,integer,uuid,jsonb,bigint,uuid) TO authenticated;
CREATE FUNCTION public.ienvia_reservar_worker_campanha(p_campanha uuid,p_destinatario uuid,p_etapa integer,p_tentativa uuid,p_material jsonb,p_revisao bigint,p_worker uuid)
RETURNS SETOF public.ienvia_campanha_checkpoints LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM ienvia_private.reservar_worker_campanha($1,$2,$3,$4,$5,$6,$7); $$;
REVOKE ALL ON FUNCTION public.ienvia_reservar_worker_campanha(uuid,uuid,integer,uuid,jsonb,bigint,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_reservar_worker_campanha(uuid,uuid,integer,uuid,jsonb,bigint,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.ienvia_reservar_campanha(uuid,uuid,integer,uuid,jsonb,bigint) FROM authenticated;
REVOKE ALL ON FUNCTION ienvia_private.reservar_campanha(uuid,uuid,integer,uuid,jsonb,bigint) FROM authenticated;

CREATE OR REPLACE FUNCTION ienvia_private.alterar_status_campanha(p_campanha uuid,p_status text)
RETURNS SETOF public.ienvia_campanhas_controle LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE anterior text;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 SELECT c.status INTO anterior FROM public.ienvia_campanhas_controle AS c
   WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF p_status IS NULL OR NOT ((anterior IN ('rascunho','pausada') AND p_status='ativa') OR (anterior='ativa' AND p_status='pausada')) THEN RETURN; END IF;
 IF p_status='ativa' AND EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints AS x
   WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.status='incerta') THEN RETURN; END IF;
 IF p_status='ativa' AND EXISTS (SELECT 1 FROM public.ienvia_campanhas_controle AS c WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha AND (c.plano IS NULL OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(c.plano->'blocos') AS b(bloco) WHERE b.bloco->>'tipo' IN ('imagem','audio') AND NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_arquivos AS a WHERE a.owner_id=c.owner_id AND a.pasta_id=(b.bloco->>'pastaId')::uuid AND a.tipo=b.bloco->>'tipo' AND NOT a.excluindo)))) THEN RETURN; END IF;
 IF anterior='rascunho' AND NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints AS x WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha) THEN RETURN; END IF;
 RETURN QUERY UPDATE public.ienvia_campanhas_controle AS c SET status=p_status,revisao=c.revisao+1,
   ultimo_worker=CASE WHEN anterior='pausada' AND p_status='ativa' AND NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints x WHERE x.owner_id=c.owner_id AND x.campanha_id=c.campanha_id AND x.status='em_envio') THEN NULL ELSE c.ultimo_worker END,
   lote_meta=CASE WHEN anterior='rascunho' THEN c.lote_min+pg_catalog.floor(pg_catalog.random()*(c.lote_max-c.lote_min+1))::integer ELSE c.lote_meta END
   WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha RETURNING c.*;
END $$;

-- ==== 20261029_campanha_prontas.sql ====
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

-- ==== 20261029_campanha_recuperacao_lote.sql ====
-- Recupera até 50 campanhas sob locks em ordem estável, para reduzir round trips.
CREATE FUNCTION ienvia_private.recuperar_lote_campanha(p_campanhas uuid[])
RETURNS TABLE(owner_id uuid,campanha_id uuid,status text,revisao bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE id uuid;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 IF p_campanhas IS NULL OR pg_catalog.cardinality(p_campanhas) NOT BETWEEN 1 AND 50 OR pg_catalog.array_position(p_campanhas,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Lote inválido' USING ERRCODE='23514'; END IF;
 FOR id IN SELECT DISTINCT u.id FROM pg_catalog.unnest(p_campanhas) AS u(id) ORDER BY u.id LOOP
  RETURN QUERY SELECT c.owner_id,c.campanha_id,c.status,c.revisao FROM ienvia_private.recuperar_campanha(id) c;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.recuperar_lote_campanha(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.recuperar_lote_campanha(uuid[]) TO authenticated;
CREATE FUNCTION public.ienvia_recuperar_lote_campanha(p_campanhas uuid[]) RETURNS TABLE(owner_id uuid,campanha_id uuid,status text,revisao bigint)
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM ienvia_private.recuperar_lote_campanha($1); $$;
REVOKE ALL ON FUNCTION public.ienvia_recuperar_lote_campanha(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_recuperar_lote_campanha(uuid[]) TO authenticated;

-- ==== 20261029_campanha_remocao_destinatarios.sql ====
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

-- ==== 20261029_campanha_falhas.sql ====
-- Erro de preparação interrompe a campanha em vez de ficar em loop silencioso.
-- Código controlado não grava número, texto, credenciais ou mensagens de erro externas.
ALTER TABLE public.ienvia_campanhas_controle ADD COLUMN falha_codigo text CHECK(falha_codigo IN ('contato_restrito','campos','preparacao'));
CREATE FUNCTION ienvia_private.registrar_falha_campanha(p_campanha uuid,p_codigo text)
RETURNS SETOF public.ienvia_campanhas_controle LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 IF p_codigo IS NULL OR p_codigo NOT IN ('contato_restrito','campos','preparacao') THEN RAISE EXCEPTION 'Código inválido' USING ERRCODE='23514'; END IF;
 RETURN QUERY UPDATE public.ienvia_campanhas_controle c SET status='pausada',falha_codigo=p_codigo,revisao=c.revisao+1
 WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha AND c.status='ativa' RETURNING c.*;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.registrar_falha_campanha(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.registrar_falha_campanha(uuid,text) TO authenticated;
CREATE FUNCTION public.ienvia_registrar_falha_campanha(p_campanha uuid,p_codigo text) RETURNS SETOF public.ienvia_campanhas_controle LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM ienvia_private.registrar_falha_campanha($1,$2); $$;
REVOKE ALL ON FUNCTION public.ienvia_registrar_falha_campanha(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_registrar_falha_campanha(uuid,text) TO authenticated;
CREATE FUNCTION ienvia_private.limpar_falha_ao_retomar() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN NEW.falha_codigo=NULL;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION ienvia_private.limpar_falha_ao_retomar() FROM PUBLIC;
CREATE TRIGGER ienvia_limpar_falha_ao_retomar BEFORE UPDATE OF status ON public.ienvia_campanhas_controle
FOR EACH ROW WHEN (OLD.status='pausada' AND NEW.status='ativa') EXECUTE FUNCTION ienvia_private.limpar_falha_ao_retomar();

-- ==== 20261029_campanha_falhas_view.sql ====
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

-- ==== 20261029_campanha_upload_servico.sql ====
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

-- ==== 20261029_campanha_excluir_media.sql ====
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
