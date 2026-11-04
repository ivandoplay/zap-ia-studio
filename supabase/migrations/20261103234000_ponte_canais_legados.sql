-- RASCUNHO LOCAL. Depende de 20261103233000. Não altera contatos, instâncias ou pastas de sessão.
-- Importação administrativa explícita: não exposta ao operador, suporte ou frontend.
ALTER TABLE public.ienvia_channels ADD CONSTRAINT ienvia_channels_owner_id_key UNIQUE(owner_id,id);
CREATE TABLE public.ienvia_legacy_channel_links (
 owner_id uuid NOT NULL REFERENCES public.zapia_users(user_id) ON DELETE CASCADE,
 legacy_slot_id text NOT NULL CHECK(legacy_slot_id IN ('slot_1','slot_2','slot_3')),
 channel_id uuid NOT NULL UNIQUE,
 source_config jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,legacy_slot_id),
 FOREIGN KEY(owner_id,channel_id) REFERENCES public.ienvia_channels(owner_id,id)
);
ALTER TABLE public.ienvia_legacy_channel_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_legacy_channel_links FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT(owner_id,legacy_slot_id,channel_id,created_at) ON public.ienvia_legacy_channel_links TO authenticated;
CREATE POLICY legacy_links_self_read ON public.ienvia_legacy_channel_links FOR SELECT TO authenticated
 USING(owner_id=(SELECT auth.uid()) AND public.zapia_is_user_active((SELECT auth.uid())));

CREATE FUNCTION public.ienvia_import_legacy_channel(p_owner uuid,p_slot text,p_config jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE normalized jsonb; b public.ienvia_legacy_channel_links; c public.ienvia_channels;
BEGIN
 IF p_slot IS NULL OR p_slot NOT IN ('slot_1','slot_2','slot_3') THEN RAISE EXCEPTION 'Chip legado inválido' USING ERRCODE='22023'; END IF;
 PERFORM public.ienvia_channel_payload(p_config,false);
 IF jsonb_typeof(p_config->'crmVisible') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_config->'aiEnabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_config->'campaignsEnabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Revise todas as políticas explicitamente' USING ERRCODE='22023'; END IF;
 normalized:=jsonb_build_object('name',btrim(p_config->>'name'),'transport',p_config->>'transport','crmVisible',p_config->'crmVisible','aiEnabled',p_config->'aiEnabled','campaignsEnabled',p_config->'campaignsEnabled','tags',to_jsonb(ARRAY(SELECT DISTINCT btrim(value) FROM jsonb_array_elements_text(coalesce(p_config->'tags','[]'::jsonb)) t(value) ORDER BY btrim(value))));
 -- Serializa importações da mesma conta, sem bloquear a chave estrangeira de novos canais.
 PERFORM user_id FROM public.zapia_users WHERE user_id=p_owner AND is_active FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conta indisponível' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM public.ienvia_legacy_channel_links WHERE owner_id=p_owner AND legacy_slot_id=p_slot;
 IF FOUND THEN
  IF b.source_config<>normalized THEN RAISE EXCEPTION 'Importação divergente: revise o vínculo existente' USING ERRCODE='40001'; END IF;
  SELECT * INTO STRICT c FROM public.ienvia_channels WHERE id=b.channel_id AND owner_id=p_owner;
  RETURN jsonb_build_object('channel',public.ienvia_channel_dto(c),'legacySlotId',p_slot,'created',false,'sessionRenamed',false);
 END IF;
 INSERT INTO public.ienvia_channels(owner_id,name,transport,crm_visible,ai_enabled,campaigns_enabled,tags)
 VALUES(p_owner,normalized->>'name',normalized->>'transport',(normalized->>'crmVisible')::boolean,(normalized->>'aiEnabled')::boolean,(normalized->>'campaignsEnabled')::boolean,ARRAY(SELECT jsonb_array_elements_text(normalized->'tags'))) RETURNING * INTO c;
 INSERT INTO public.ienvia_legacy_channel_links(owner_id,legacy_slot_id,channel_id,source_config) VALUES(p_owner,p_slot,c.id,normalized);
 RETURN jsonb_build_object('channel',public.ienvia_channel_dto(c),'legacySlotId',p_slot,'created',true,'sessionRenamed',false);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_import_legacy_channel(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_import_legacy_channel(uuid,text,jsonb) TO service_role;

CREATE FUNCTION public.ienvia_get_channel_legacy_link(p_owner uuid,p_channel uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE u uuid:=auth.uid(); b public.ienvia_legacy_channel_links; c public.ienvia_channels;
BEGIN
 IF u IS NULL OR p_owner IS NULL OR public.zapia_is_user_active(u) IS NOT TRUE OR public.zapia_is_user_active(p_owner) IS NOT TRUE THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF u<>p_owner AND NOT EXISTS(SELECT 1 FROM public.zapia_users WHERE user_id=u AND is_active AND role='master') THEN RAISE EXCEPTION 'Conta não autorizada' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.ienvia_channels WHERE owner_id=p_owner AND id=p_channel;
 IF NOT FOUND THEN RAISE EXCEPTION 'Canal não encontrado' USING ERRCODE='P0002'; END IF;
 SELECT * INTO b FROM public.ienvia_legacy_channel_links WHERE owner_id=p_owner AND channel_id=p_channel;
 RETURN jsonb_build_object('ownerId',p_owner,'channel',public.ienvia_channel_dto(c),'binding',CASE WHEN b.channel_id IS NULL THEN NULL ELSE jsonb_build_object('ownerId',b.owner_id,'channelId',b.channel_id,'legacySlotId',b.legacy_slot_id,'transport',b.source_config->>'transport') END);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_get_channel_legacy_link(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ienvia_get_channel_legacy_link(uuid,uuid) TO authenticated;
