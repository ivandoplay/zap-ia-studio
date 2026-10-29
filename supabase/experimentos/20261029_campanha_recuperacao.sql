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
