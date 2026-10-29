-- RASCUNHO EXPERIMENTAL: somente laboratório, não aplicado em produção.
CREATE TABLE public.ienvia_slot_geracoes (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slot_id text NOT NULL CHECK(slot_id IN ('slot_1','slot_2','slot_3')),
  geracao uuid NOT NULL,
  bloqueada boolean NOT NULL DEFAULT true,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,slot_id)
);
ALTER TABLE public.ienvia_slot_geracoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_slot_geracoes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ienvia_slot_geracoes TO authenticated;
CREATE POLICY ienvia_slot_geracoes_titular ON public.ienvia_slot_geracoes FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.ienvia_validar_geracao_ficha() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s text; g uuid; bloqueada boolean;
BEGIN
 s:=CASE WHEN new.chat_id LIKE 'slot_2::%' THEN 'slot_2' WHEN new.chat_id LIKE 'slot_3::%' THEN 'slot_3' ELSE 'slot_1' END;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text || ':' || s, 0));
 SELECT e.geracao,e.bloqueada INTO g,bloqueada FROM public.ienvia_slot_geracoes e WHERE e.owner_id=new.user_id AND e.slot_id=s FOR SHARE;
 IF FOUND THEN
  IF new.data->>'historyEpoch' IS DISTINCT FROM g::text THEN RAISE EXCEPTION 'Geração de conversa desatualizada'; END IF;
  IF bloqueada AND (coalesce(jsonb_typeof(new.data->'messages'),'') <> 'array' OR jsonb_array_length(new.data->'messages') > 0) THEN RAISE EXCEPTION 'Chip requer pareamento'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ienvia_validar_geracao_ficha() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER ienvia_proteger_geracao_ficha BEFORE INSERT OR UPDATE ON public.zapia_contacts FOR EACH ROW EXECUTE FUNCTION public.ienvia_validar_geracao_ficha();

CREATE OR REPLACE FUNCTION public.ienvia_limpar_slot(p_slot text) RETURNS TABLE(geracao uuid,fichas bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid:=auth.uid(); s text; v_g uuid:=gen_random_uuid(); n bigint;
BEGIN
 IF u IS NULL OR p_slot NOT IN ('slot_1','slot_2','slot_3') THEN RAISE EXCEPTION 'Conta ou chip inválido'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text || ':' || p_slot, 0));
 SELECT w.status INTO s FROM public.zapia_wa_slots w WHERE w.user_id=u AND w.slot_id=p_slot FOR UPDATE;
 IF NOT FOUND OR s NOT IN ('disconnected','qr_ready') THEN RAISE EXCEPTION 'Chip ainda conectado ou sem status confirmado'; END IF;
 INSERT INTO public.ienvia_slot_geracoes(owner_id,slot_id,geracao,bloqueada) VALUES(u,p_slot,v_g,true)
 ON CONFLICT(owner_id,slot_id) DO UPDATE SET geracao=excluded.geracao,bloqueada=true,atualizado_em=now();
 UPDATE public.zapia_contacts c SET data=c.data || jsonb_build_object('messages','[]'::jsonb,'lastMessageAt',null,'unreadCount',0,'unreadAlert',false,'disconnectedHidden',true,'historyEpoch',v_g::text),last_message_at=NULL,updated_at=clock_timestamp()
 WHERE c.user_id=u AND CASE WHEN c.chat_id LIKE 'slot_2::%' THEN 'slot_2' WHEN c.chat_id LIKE 'slot_3::%' THEN 'slot_3' ELSE 'slot_1' END=p_slot;
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN QUERY SELECT v_g,n;
END $$;
REVOKE ALL ON FUNCTION public.ienvia_limpar_slot(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ienvia_limpar_slot(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ienvia_slot_repareado(p_slot text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid:=auth.uid(); s text; hb timestamptz;
BEGIN
 IF u IS NULL OR p_slot NOT IN ('slot_1','slot_2','slot_3') THEN RAISE EXCEPTION 'Conta ou chip inválido'; END IF;
 SELECT w.status,w.worker_heartbeat_at INTO s,hb FROM public.zapia_wa_slots w WHERE w.user_id=u AND w.slot_id=p_slot FOR UPDATE;
 IF NOT FOUND OR s <> 'connected' OR hb IS NULL OR hb < clock_timestamp()-interval '90 seconds' THEN RAISE EXCEPTION 'Conexão ainda não confirmada'; END IF;
 UPDATE public.ienvia_slot_geracoes SET bloqueada=false,atualizado_em=clock_timestamp() WHERE owner_id=u AND slot_id=p_slot;
END $$;
REVOKE ALL ON FUNCTION public.ienvia_slot_repareado(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ienvia_slot_repareado(text) TO authenticated;
