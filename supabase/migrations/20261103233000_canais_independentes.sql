-- RASCUNHO LOCAL: não aplicado. Cadastro/políticas; não altera sessões, constraints ou motores legados.
CREATE TABLE public.ienvia_channels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES public.zapia_users(user_id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 64),
 transport text NOT NULL CHECK(transport IN ('evolution_api','local_worker')),
 crm_visible boolean NOT NULL DEFAULT true,
 ai_enabled boolean NOT NULL DEFAULT false,
 campaigns_enabled boolean NOT NULL DEFAULT false,
 tags text[] NOT NULL DEFAULT '{}' CHECK(cardinality(tags)<=8),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ienvia_channels_owner_cursor ON public.ienvia_channels(owner_id,id);
ALTER TABLE public.ienvia_channels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_channels FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ienvia_channels TO authenticated;
CREATE POLICY channels_self_read ON public.ienvia_channels FOR SELECT TO authenticated
 USING(owner_id=(SELECT auth.uid()) AND public.zapia_is_user_active((SELECT auth.uid())));

CREATE FUNCTION public.ienvia_channel_payload(p jsonb,p_partial boolean) RETURNS jsonb
 LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text; allowed text[]:=ARRAY['name','crmVisible','aiEnabled','campaignsEnabled','tags'];
BEGIN
 IF NOT p_partial THEN allowed:=array_append(allowed,'transport'); END IF;
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR p='{}'::jsonb OR (p-allowed)<>'{}'::jsonb THEN RAISE EXCEPTION 'Campos inválidos' USING ERRCODE='22023'; END IF;
 IF NOT p_partial OR p?'name' THEN
  IF jsonb_typeof(p->'name') IS DISTINCT FROM 'string' OR length(btrim(p->>'name')) NOT BETWEEN 1 AND 64 OR (p->>'name')~'[[:cntrl:]]' THEN RAISE EXCEPTION 'Nome inválido' USING ERRCODE='22023'; END IF;
 END IF;
 IF NOT p_partial AND (jsonb_typeof(p->'transport') IS DISTINCT FROM 'string' OR (p->>'transport') NOT IN ('evolution_api','local_worker')) THEN RAISE EXCEPTION 'Transporte inválido' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['crmVisible','aiEnabled','campaignsEnabled'] LOOP
  IF p?k AND jsonb_typeof(p->k) IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Booleano estrito obrigatório' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF p?'tags' THEN
  IF jsonb_typeof(p->'tags') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Etiquetas inválidas' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(p->'tags')>8 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'tags') e WHERE jsonb_typeof(e) IS DISTINCT FROM 'string' OR length(btrim(e#>>'{}')) NOT BETWEEN 1 AND 24 OR (e#>>'{}')~'[[:cntrl:]]') THEN RAISE EXCEPTION 'Etiquetas inválidas' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN p;
END $$;
REVOKE ALL ON FUNCTION public.ienvia_channel_payload(jsonb,boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.ienvia_channel_dto(c public.ienvia_channels) RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',c.id,'name',c.name,'transport',c.transport,'crmVisible',c.crm_visible,'aiEnabled',c.ai_enabled,'campaignsEnabled',c.campaigns_enabled,'tags',c.tags,'revision',c.revision,'createdAt',c.created_at,'updatedAt',c.updated_at)
$$;
REVOKE ALL ON FUNCTION public.ienvia_channel_dto(public.ienvia_channels) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.ienvia_create_channel(p_config jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE u uuid:=auth.uid(); c public.ienvia_channels;
BEGIN
 IF u IS NULL OR public.zapia_is_user_active(u) IS NOT TRUE THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 PERFORM public.ienvia_channel_payload(p_config,false);
 INSERT INTO public.ienvia_channels(owner_id,name,transport,crm_visible,ai_enabled,campaigns_enabled,tags)
 VALUES(u,btrim(p_config->>'name'),p_config->>'transport',coalesce((p_config->>'crmVisible')::boolean,true),coalesce((p_config->>'aiEnabled')::boolean,false),coalesce((p_config->>'campaignsEnabled')::boolean,false),ARRAY(SELECT DISTINCT btrim(value) FROM jsonb_array_elements_text(coalesce(p_config->'tags','[]'::jsonb)) AS t(value))) RETURNING * INTO c;
 RETURN public.ienvia_channel_dto(c);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_create_channel(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ienvia_create_channel(jsonb) TO authenticated;

CREATE FUNCTION public.ienvia_update_channel(p_id uuid,p_revision integer,p_patch jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE u uuid:=auth.uid(); c public.ienvia_channels;
BEGIN
 IF u IS NULL OR public.zapia_is_user_active(u) IS NOT TRUE THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 PERFORM public.ienvia_channel_payload(p_patch,true);
 SELECT * INTO c FROM public.ienvia_channels WHERE id=p_id AND owner_id=u FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Canal não encontrado' USING ERRCODE='P0002'; END IF;
 -- Conflito de revisão: o PostgREST não devolve 409 quando o RAISE usa 40001 (a resposta fica pendurada),
 -- então o conflito é sinalizado com 22023 + MARCADOR. Quem consome SQL direto continua recebendo 40001.
 IF p_revision IS NULL OR p_revision<>c.revision THEN RAISE EXCEPTION 'Configuração mudou; consulte antes de salvar' USING ERRCODE='22023',HINT='CHANNEL_REVISION_CONFLICT',DETAIL='CHANNEL_REVISION_CONFLICT'; END IF;
 UPDATE public.ienvia_channels SET
 name=CASE WHEN p_patch?'name' THEN btrim(p_patch->>'name') ELSE c.name END,
 crm_visible=CASE WHEN p_patch?'crmVisible' THEN (p_patch->>'crmVisible')::boolean ELSE c.crm_visible END,
 ai_enabled=CASE WHEN p_patch?'aiEnabled' THEN (p_patch->>'aiEnabled')::boolean ELSE c.ai_enabled END,
 campaigns_enabled=CASE WHEN p_patch?'campaignsEnabled' THEN (p_patch->>'campaignsEnabled')::boolean ELSE c.campaigns_enabled END,
 tags=CASE WHEN p_patch?'tags' THEN ARRAY(SELECT DISTINCT btrim(value) FROM jsonb_array_elements_text(p_patch->'tags') AS t(value)) ELSE c.tags END,
 revision=c.revision+1,updated_at=clock_timestamp()
 WHERE id=c.id AND owner_id=u RETURNING * INTO c;
 RETURN public.ienvia_channel_dto(c);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_update_channel(uuid,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ienvia_update_channel(uuid,integer,jsonb) TO authenticated;

CREATE FUNCTION public.ienvia_list_channels(p_owner uuid DEFAULT auth.uid(),p_limit integer DEFAULT 20,p_after uuid DEFAULT NULL,p_visibility text DEFAULT 'all',p_search text DEFAULT '') RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE u uuid:=auth.uid(); out jsonb;
BEGIN
 IF u IS NULL OR p_owner IS NULL OR public.zapia_is_user_active(u) IS NOT TRUE OR public.zapia_is_user_active(p_owner) IS NOT TRUE THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF u<>p_owner AND NOT EXISTS(SELECT 1 FROM public.zapia_users WHERE user_id=u AND is_active AND role='master') THEN RAISE EXCEPTION 'Conta não autorizada' USING ERRCODE='42501'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_visibility IS NULL OR p_visibility NOT IN ('all','visible','hidden') OR p_search IS NULL OR length(p_search)>80 THEN RAISE EXCEPTION 'Filtros inválidos' USING ERRCODE='22023'; END IF;
 WITH filtered AS MATERIALIZED (
  SELECT c.* FROM public.ienvia_channels c WHERE c.owner_id=p_owner
  AND (p_visibility='all' OR c.crm_visible=(p_visibility='visible'))
  AND (p_search='' OR strpos(lower(c.name),lower(p_search))>0 OR EXISTS(SELECT 1 FROM unnest(c.tags) t WHERE strpos(lower(t),lower(p_search))>0))
 ), next_page AS (SELECT * FROM filtered WHERE p_after IS NULL OR id>p_after ORDER BY id LIMIT p_limit+1),page AS (SELECT * FROM next_page ORDER BY id LIMIT p_limit)
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(public.ienvia_channel_dto(page) ORDER BY id) FROM page),'[]'::jsonb),
 'hasMore',(SELECT count(*)>p_limit FROM next_page),'nextCursor',CASE WHEN (SELECT count(*)>p_limit FROM next_page) THEN (SELECT id FROM page ORDER BY id DESC LIMIT 1) ELSE NULL END,
 'total',(SELECT count(*) FROM filtered),'summary',(SELECT jsonb_build_object('total',count(*),'crmVisible',count(*) FILTER(WHERE crm_visible),'crmHidden',count(*) FILTER(WHERE NOT crm_visible),'aiEnabled',count(*) FILTER(WHERE ai_enabled),'campaignsEnabled',count(*) FILTER(WHERE campaigns_enabled)) FROM public.ienvia_channels WHERE owner_id=p_owner)) INTO out;
 RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.ienvia_list_channels(uuid,integer,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ienvia_list_channels(uuid,integer,uuid,text,text) TO authenticated;
