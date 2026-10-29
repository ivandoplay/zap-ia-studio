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
