-- SOMENTE LOCAL. Histórico novo separado do storage/CRM legado. Sem DELETE/CASCADE de históricos.
CREATE TABLE public.ienvia_instance_threads (
 id uuid NOT NULL DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES public.zapia_users(user_id),
 self_jid text NOT NULL CHECK(self_jid~'^[1-9][0-9]{7,14}@s[.]whatsapp[.]net$'),
 peer_scope text NOT NULL,peer_jid text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,id),UNIQUE(owner_id,self_jid,peer_scope,peer_jid)
);
CREATE TABLE public.ienvia_instance_ingress (
 owner_id uuid NOT NULL,event_id uuid NOT NULL,instance_id uuid NOT NULL,lease_id uuid NOT NULL,
 executor_id uuid NOT NULL,observed_at timestamptz NOT NULL,payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,event_id),
 FOREIGN KEY(owner_id,instance_id) REFERENCES public.ienvia_channels(owner_id,id),
 FOREIGN KEY(owner_id,lease_id) REFERENCES public.ienvia_instance_session_leases(owner_id,lease_id)
);
CREATE INDEX instance_ingress_instance ON public.ienvia_instance_ingress(owner_id,instance_id,created_at);
CREATE TABLE public.ienvia_instance_messages (
 id uuid NOT NULL DEFAULT gen_random_uuid(),owner_id uuid NOT NULL,thread_id uuid NOT NULL,
 provider_message_id text NOT NULL,from_me boolean NOT NULL,
 text_body text,media_type text,has_content boolean NOT NULL DEFAULT false,deleted boolean NOT NULL DEFAULT false,
 conflicted boolean NOT NULL DEFAULT false,ack smallint NOT NULL DEFAULT 0 CHECK(ack BETWEEN 0 AND 4),
 message_at timestamptz NOT NULL CHECK(isfinite(message_at)),timestamp_source text NOT NULL DEFAULT 'capture' CHECK(timestamp_source IN ('provider','capture')),dispatch_request_id uuid,dispatch_state text,
 PRIMARY KEY(owner_id,id),UNIQUE(owner_id,thread_id,provider_message_id,from_me),UNIQUE(owner_id,dispatch_request_id),
 FOREIGN KEY(owner_id,thread_id) REFERENCES public.ienvia_instance_threads(owner_id,id),
 FOREIGN KEY(owner_id,dispatch_request_id) REFERENCES public.ienvia_instance_dispatches(owner_id,request_id)
);
CREATE INDEX instance_messages_timeline ON public.ienvia_instance_messages(owner_id,thread_id,message_at,id);
CREATE TABLE public.ienvia_instance_message_origins (
 owner_id uuid NOT NULL,message_id uuid NOT NULL,instance_id uuid NOT NULL,
 first_event_id uuid,last_event_id uuid,
 PRIMARY KEY(owner_id,message_id,instance_id),
 FOREIGN KEY(owner_id,message_id) REFERENCES public.ienvia_instance_messages(owner_id,id),
 FOREIGN KEY(owner_id,instance_id) REFERENCES public.ienvia_channels(owner_id,id),
 FOREIGN KEY(owner_id,first_event_id) REFERENCES public.ienvia_instance_ingress(owner_id,event_id),
 FOREIGN KEY(owner_id,last_event_id) REFERENCES public.ienvia_instance_ingress(owner_id,event_id)
);
CREATE INDEX instance_origins_channel ON public.ienvia_instance_message_origins(owner_id,instance_id,message_id);
ALTER TABLE public.ienvia_instance_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ienvia_instance_ingress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ienvia_instance_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ienvia_instance_message_origins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_instance_threads,public.ienvia_instance_ingress,public.ienvia_instance_messages,public.ienvia_instance_message_origins FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.ienvia_instance_thread_id(p_owner uuid,p_self text,p_peer text,p_instance uuid) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid; scope text;
BEGIN
 IF p_peer~'^[1-9][0-9]{7,14}@s[.]whatsapp[.]net$' THEN scope:='pn';
 ELSIF p_peer~'^[0-9]{1,30}@lid$' THEN scope:='lid:'||p_instance::text;
 ELSE RAISE EXCEPTION 'Identidade de conversa inválida' USING ERRCODE='22023'; END IF;
 INSERT INTO public.ienvia_instance_threads(owner_id,self_jid,peer_scope,peer_jid) VALUES(p_owner,p_self,scope,p_peer)
 ON CONFLICT(owner_id,self_jid,peer_scope,peer_jid) DO UPDATE SET peer_jid=EXCLUDED.peer_jid RETURNING id INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ienvia_instance_thread_id(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.ienvia_ingest_instance_event(p_owner uuid,p_instance uuid,p_executor uuid,p_lease uuid,p_event_id uuid,p_observed_at timestamptz,p_event jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' SET lock_timeout='2s' AS $$
DECLARE l public.ienvia_instance_session_leases; old public.ienvia_instance_ingress; m public.ienvia_instance_messages; t uuid; k text; body text; is_message boolean; incoming_ack integer;
BEGIN
 IF public.zapia_is_user_active(p_owner) IS NOT TRUE THEN RAISE EXCEPTION 'Conta indisponível' USING ERRCODE='42501'; END IF;
 -- Replays de ENTRADA usam a capability emitida, inclusive encerrada, somente na janela em que foi válida.
 -- Nenhum destes eventos chama envio ou reabre sessão.
 PERFORM 1 FROM public.ienvia_channels WHERE owner_id=p_owner AND id=p_instance FOR SHARE;
 SELECT * INTO l FROM public.ienvia_instance_session_leases WHERE owner_id=p_owner AND instance_id=p_instance AND executor_id=p_executor AND lease_id=p_lease FOR SHARE;
 IF NOT FOUND OR p_observed_at IS NULL OR p_observed_at<date_trunc('milliseconds',l.created_at) OR p_observed_at>least(l.expires_at,coalesce(l.closed_at,l.expires_at)) OR p_observed_at>clock_timestamp()+interval '5 seconds' THEN RAISE EXCEPTION 'Entrada fora do lease emitido' USING ERRCODE='42501'; END IF;
 IF p_event_id IS NULL OR jsonb_typeof(p_event) IS DISTINCT FROM 'object' OR octet_length(p_event::text)>1048576 OR NOT(p_event?'wire') OR coalesce(p_event->>'kind','') NOT IN ('message','receipt','delete','unprojected') THEN RAISE EXCEPTION 'Entrada inválida' USING ERRCODE='22023'; END IF;
 SELECT * INTO old FROM public.ienvia_instance_ingress WHERE owner_id=p_owner AND event_id=p_event_id;
 IF FOUND THEN
  IF old.instance_id IS DISTINCT FROM p_instance OR old.lease_id IS DISTINCT FROM p_lease OR old.executor_id IS DISTINCT FROM p_executor OR old.observed_at IS DISTINCT FROM p_observed_at OR old.payload IS DISTINCT FROM p_event THEN RAISE EXCEPTION 'Evento reutilizado com intenção diferente' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('ownerId',p_owner,'instanceId',p_instance,'eventId',p_event_id,'persisted',true,'duplicate',true);
 END IF;
 INSERT INTO public.ienvia_instance_ingress(owner_id,event_id,instance_id,lease_id,executor_id,observed_at,payload) VALUES(p_owner,p_event_id,p_instance,p_lease,p_executor,p_observed_at,p_event);
 k:=p_event->>'kind';
 IF k='unprojected' THEN RETURN jsonb_build_object('ownerId',p_owner,'instanceId',p_instance,'eventId',p_event_id,'persisted',true,'duplicate',false,'projected',false); END IF;
 IF jsonb_typeof(p_event->'fromMe') IS DISTINCT FROM 'boolean' OR coalesce(p_event->>'providerMessageId','')!~'^[!-~]{1,128}$' OR coalesce(p_event->>'ack','')!~'^[0-4]$' OR p_event->>'messageAt' IS NULL OR jsonb_typeof(p_event->'text') NOT IN ('string','null') OR length(p_event->>'text')>65536 THEN RAISE EXCEPTION 'Projeção inválida' USING ERRCODE='22023'; END IF;
 t:=public.ienvia_instance_thread_id(p_owner,l.self_jid,p_event->>'peerJid',p_instance);body:=p_event->>'text';is_message:=k='message';incoming_ack:=(p_event->>'ack')::integer;
 INSERT INTO public.ienvia_instance_messages(owner_id,thread_id,provider_message_id,from_me,text_body,media_type,has_content,deleted,ack,message_at,timestamp_source)
 VALUES(p_owner,t,p_event->>'providerMessageId',(p_event->>'fromMe')::boolean,CASE WHEN is_message THEN body ELSE NULL END,CASE WHEN is_message THEN p_event->>'mediaType' ELSE NULL END,is_message,k='delete',incoming_ack,(p_event->>'messageAt')::timestamptz,coalesce(p_event->>'timestampSource','capture'))
 ON CONFLICT(owner_id,thread_id,provider_message_id,from_me) DO UPDATE SET
  conflicted=public.ienvia_instance_messages.conflicted OR (is_message AND public.ienvia_instance_messages.has_content AND NOT public.ienvia_instance_messages.deleted AND (public.ienvia_instance_messages.text_body IS DISTINCT FROM body OR public.ienvia_instance_messages.media_type IS DISTINCT FROM (p_event->>'mediaType'))),
  text_body=CASE WHEN public.ienvia_instance_messages.deleted OR k='delete' THEN NULL WHEN NOT public.ienvia_instance_messages.has_content AND is_message THEN body ELSE public.ienvia_instance_messages.text_body END,
  media_type=CASE WHEN public.ienvia_instance_messages.deleted OR k='delete' THEN NULL WHEN NOT public.ienvia_instance_messages.has_content AND is_message THEN p_event->>'mediaType' ELSE public.ienvia_instance_messages.media_type END,
  has_content=public.ienvia_instance_messages.has_content OR is_message,
  deleted=public.ienvia_instance_messages.deleted OR k='delete',ack=greatest(public.ienvia_instance_messages.ack,incoming_ack),
  timestamp_source=CASE WHEN NOT public.ienvia_instance_messages.has_content AND is_message THEN coalesce(p_event->>'timestampSource','capture') ELSE public.ienvia_instance_messages.timestamp_source END,
  message_at=CASE WHEN NOT public.ienvia_instance_messages.has_content AND is_message THEN (p_event->>'messageAt')::timestamptz ELSE public.ienvia_instance_messages.message_at END
 RETURNING * INTO m;
 INSERT INTO public.ienvia_instance_message_origins(owner_id,message_id,instance_id,first_event_id,last_event_id) VALUES(p_owner,m.id,p_instance,p_event_id,p_event_id)
 ON CONFLICT(owner_id,message_id,instance_id) DO UPDATE SET first_event_id=coalesce(public.ienvia_instance_message_origins.first_event_id,p_event_id),last_event_id=p_event_id;
 RETURN jsonb_build_object('ownerId',p_owner,'instanceId',p_instance,'eventId',p_event_id,'persisted',true,'duplicate',false,'projected',true,'messageId',m.id,'threadId',t);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_ingest_instance_event(uuid,uuid,uuid,uuid,uuid,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_ingest_instance_event(uuid,uuid,uuid,uuid,uuid,timestamptz,jsonb) TO service_role;

CREATE FUNCTION public.ienvia_prepare_instance_message(p_owner uuid,p_instance uuid,p_executor uuid,p_lease uuid,p_request uuid,p_peer text,p_text text,p_provider_id text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' SET lock_timeout='2s' AS $$
DECLARE l public.ienvia_instance_session_leases; d public.ienvia_instance_dispatches; m public.ienvia_instance_messages; t uuid; intended text;
BEGIN
 PERFORM 1 FROM public.ienvia_channels WHERE owner_id=p_owner AND id=p_instance FOR UPDATE;
 l:=public.ienvia_assert_instance_session(p_owner,p_instance,p_executor,p_lease);
 SELECT * INTO d FROM public.ienvia_instance_dispatches WHERE owner_id=p_owner AND instance_id=p_instance AND executor_id=p_executor AND request_id=p_request FOR UPDATE;
 IF NOT FOUND OR d.state<>'started' OR d.started_at IS NULL OR d.purpose<>'manual' THEN RAISE EXCEPTION 'Envio sem início autorizado' USING ERRCODE='55000'; END IF;
 IF p_peer IS NULL OR p_peer!~'^[1-9][0-9]{7,14}@s[.]whatsapp[.]net$' OR p_text IS NULL OR length(p_text) NOT BETWEEN 1 AND 4096 OR length(btrim(p_text))=0 OR p_provider_id IS NULL OR p_provider_id!~'^[!-~]{1,128}$' THEN RAISE EXCEPTION 'Intenção inválida' USING ERRCODE='22023'; END IF;
 intended:='["ienvia-dispatch-v1",'||to_json(p_owner::text)::text||','||to_json(p_instance::text)::text||','||to_json(p_executor::text)::text||','||d.policy_revision::text||','||d.assignment_revision::text||',"manual",'||to_json(p_peer)::text||','||to_json(p_text)::text||']';
 IF encode(sha256(convert_to(intended,'UTF8')),'hex')<>d.digest OR d.assignment_revision<>l.assignment_revision OR NOT EXISTS(SELECT 1 FROM public.ienvia_channels WHERE owner_id=p_owner AND id=p_instance AND revision=d.policy_revision) THEN RAISE EXCEPTION 'Conteúdo diferente do pedido' USING ERRCODE='40001'; END IF;
 SELECT * INTO m FROM public.ienvia_instance_messages WHERE owner_id=p_owner AND dispatch_request_id=p_request;
 IF FOUND THEN RETURN jsonb_build_object('ownerId',p_owner,'instanceId',p_instance,'requestId',p_request,'claimed',false,'messageId',m.id,'threadId',m.thread_id,'providerMessageId',m.provider_message_id); END IF;
 t:=public.ienvia_instance_thread_id(p_owner,l.self_jid,p_peer,p_instance);
 INSERT INTO public.ienvia_instance_messages(owner_id,thread_id,provider_message_id,from_me,text_body,media_type,has_content,message_at,dispatch_request_id,dispatch_state)
 VALUES(p_owner,t,p_provider_id,true,p_text,'text',true,clock_timestamp(),p_request,'started') RETURNING * INTO m;
 INSERT INTO public.ienvia_instance_message_origins(owner_id,message_id,instance_id) VALUES(p_owner,m.id,p_instance);
 RETURN jsonb_build_object('ownerId',p_owner,'instanceId',p_instance,'requestId',p_request,'claimed',true,'messageId',m.id,'threadId',t,'providerMessageId',p_provider_id);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_prepare_instance_message(uuid,uuid,uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_prepare_instance_message(uuid,uuid,uuid,uuid,uuid,text,text,text) TO service_role;

CREATE FUNCTION public.ienvia_project_dispatch_to_crm() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.state='accepted' AND EXISTS(SELECT 1 FROM public.ienvia_instance_messages WHERE owner_id=NEW.owner_id AND dispatch_request_id=NEW.request_id AND provider_message_id IS DISTINCT FROM NEW.provider_message_id) THEN RAISE EXCEPTION 'ACK de outra intenção' USING ERRCODE='40001'; END IF;
 UPDATE public.ienvia_instance_messages SET dispatch_state=NEW.state,ack=CASE WHEN NEW.state='accepted' THEN greatest(ack,1) ELSE ack END WHERE owner_id=NEW.owner_id AND dispatch_request_id=NEW.request_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ienvia_project_dispatch_to_crm() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER instance_dispatch_crm_projection AFTER UPDATE OF state,provider_message_id ON public.ienvia_instance_dispatches FOR EACH ROW EXECUTE FUNCTION public.ienvia_project_dispatch_to_crm();

CREATE FUNCTION public.ienvia_instance_origins_dto(p_owner uuid,p_message uuid,p_visibility text) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH eligible AS (
  SELECT c.id,c.name,c.crm_visible FROM public.ienvia_instance_message_origins o JOIN public.ienvia_channels c ON c.owner_id=o.owner_id AND c.id=o.instance_id
  WHERE o.owner_id=p_owner AND o.message_id=p_message AND (p_visibility='all' OR c.crm_visible=(p_visibility='visible'))
 ), sample AS (SELECT * FROM eligible ORDER BY id LIMIT 20)
 SELECT jsonb_build_object('origins',coalesce((SELECT jsonb_agg(jsonb_build_object('instanceId',id,'name',name,'crmVisible',crm_visible) ORDER BY id) FROM sample),'[]'::jsonb),'originCount',(SELECT count(*) FROM eligible),'originsTruncated',(SELECT count(*)>20 FROM eligible))
 $$;
REVOKE ALL ON FUNCTION public.ienvia_instance_origins_dto(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.ienvia_read_instance_thread(p_owner uuid,p_thread uuid,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 30,p_visibility text DEFAULT 'visible') RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE u uuid:=auth.uid(); cursor_time timestamptz; items jsonb; more boolean; next_id uuid;
BEGIN
 IF u IS NULL OR public.zapia_is_user_active(u) IS NOT TRUE OR public.zapia_is_user_active(p_owner) IS NOT TRUE THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF u<>p_owner AND NOT EXISTS(SELECT 1 FROM public.zapia_users WHERE user_id=u AND is_active AND role='master') THEN RAISE EXCEPTION 'Conta não autorizada' USING ERRCODE='42501'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_visibility IS NULL OR p_visibility NOT IN ('visible','hidden','all') THEN RAISE EXCEPTION 'Filtros inválidos' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.ienvia_instance_threads WHERE owner_id=p_owner AND id=p_thread;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada' USING ERRCODE='P0002'; END IF;
 IF p_after IS NOT NULL THEN SELECT message_at INTO cursor_time FROM public.ienvia_instance_messages WHERE owner_id=p_owner AND thread_id=p_thread AND id=p_after;IF NOT FOUND THEN RAISE EXCEPTION 'Cursor inválido' USING ERRCODE='22023'; END IF;END IF;
 WITH batch AS (
  SELECT m.* FROM public.ienvia_instance_messages m WHERE m.owner_id=p_owner AND m.thread_id=p_thread AND (p_after IS NULL OR (m.message_at,m.id)>(cursor_time,p_after)) AND EXISTS(
   SELECT 1 FROM public.ienvia_instance_message_origins o JOIN public.ienvia_channels c ON c.owner_id=o.owner_id AND c.id=o.instance_id
   WHERE o.owner_id=m.owner_id AND o.message_id=m.id AND (p_visibility='all' OR c.crm_visible=(p_visibility='visible')))
  ORDER BY m.message_at,m.id LIMIT p_limit+1
 ), page AS (SELECT * FROM batch ORDER BY message_at,id LIMIT p_limit)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'threadId',p.thread_id,'providerMessageId',p.provider_message_id,'fromMe',p.from_me,'text',CASE WHEN p.deleted THEN NULL ELSE p.text_body END,'mediaType',CASE WHEN p.deleted THEN NULL ELSE p.media_type END,'deleted',p.deleted,'conflicted',p.conflicted,'ack',p.ack,'delivered',p.from_me AND p.ack>=2,'messageAt',p.message_at,'timestampSource',p.timestamp_source,'dispatchState',p.dispatch_state)||public.ienvia_instance_origins_dto(p_owner,p.id,p_visibility) ORDER BY p.message_at,p.id),'[]'::jsonb),(SELECT count(*)>p_limit FROM batch),(SELECT id FROM page ORDER BY message_at DESC,id DESC LIMIT 1) INTO items,more,next_id FROM page p;
 RETURN jsonb_build_object('ownerId',p_owner,'threadId',p_thread,'items',items,'hasMore',more,'nextCursor',CASE WHEN more THEN next_id ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_read_instance_thread(uuid,uuid,uuid,integer,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_read_instance_thread(uuid,uuid,uuid,integer,text) TO authenticated;

CREATE FUNCTION public.ienvia_list_instance_threads(p_owner uuid,p_instance uuid,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 30,p_visibility text DEFAULT 'visible') RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE items jsonb; more boolean; next_id uuid;
BEGIN
 PERFORM public.ienvia_get_instance_execution(p_owner,p_instance);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_visibility IS NULL OR p_visibility NOT IN ('visible','hidden','all') THEN RAISE EXCEPTION 'Filtros inválidos' USING ERRCODE='22023'; END IF;
 IF p_after IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.ienvia_instance_messages m JOIN public.ienvia_instance_message_origins o ON o.owner_id=m.owner_id AND o.message_id=m.id WHERE m.owner_id=p_owner AND m.thread_id=p_after AND o.instance_id=p_instance) THEN RAISE EXCEPTION 'Cursor de outra origem' USING ERRCODE='22023'; END IF;
 WITH batch AS (
  SELECT t.* FROM public.ienvia_instance_threads t WHERE t.owner_id=p_owner AND (p_after IS NULL OR t.id>p_after) AND EXISTS(
   SELECT 1 FROM public.ienvia_instance_messages m JOIN public.ienvia_instance_message_origins o ON o.owner_id=m.owner_id AND o.message_id=m.id JOIN public.ienvia_channels c ON c.owner_id=o.owner_id AND c.id=o.instance_id
   WHERE m.owner_id=p_owner AND m.thread_id=t.id AND o.instance_id=p_instance AND (p_visibility='all' OR c.crm_visible=(p_visibility='visible')))
  ORDER BY t.id LIMIT p_limit+1
 ), page AS (SELECT * FROM batch ORDER BY id LIMIT p_limit)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'selfJid',p.self_jid,'peerJid',p.peer_jid,'identityKind',CASE WHEN p.peer_scope='pn' THEN 'verified_pn' ELSE 'provisional_lid' END,'createdAt',p.created_at) ORDER BY p.id),'[]'::jsonb),(SELECT count(*)>p_limit FROM batch),(SELECT id FROM page ORDER BY id DESC LIMIT 1) INTO items,more,next_id FROM page p;
 RETURN jsonb_build_object('ownerId',p_owner,'instanceId',p_instance,'items',items,'hasMore',more,'nextCursor',CASE WHEN more THEN next_id ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_list_instance_threads(uuid,uuid,uuid,integer,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_list_instance_threads(uuid,uuid,uuid,integer,text) TO authenticated;

CREATE FUNCTION public.ienvia_read_instance_channel_thread(p_owner uuid,p_instance uuid,p_thread uuid,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 30,p_visibility text DEFAULT 'visible') RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
BEGIN
 PERFORM public.ienvia_get_instance_execution(p_owner,p_instance);
 IF NOT EXISTS(SELECT 1 FROM public.ienvia_instance_messages m JOIN public.ienvia_instance_message_origins o ON o.owner_id=m.owner_id AND o.message_id=m.id WHERE m.owner_id=p_owner AND m.thread_id=p_thread AND o.instance_id=p_instance) THEN RAISE EXCEPTION 'Conversa não pertence à origem consultada' USING ERRCODE='P0002'; END IF;
 RETURN public.ienvia_read_instance_thread(p_owner,p_thread,p_after,p_limit,p_visibility)||jsonb_build_object('instanceId',p_instance);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_read_instance_channel_thread(uuid,uuid,uuid,uuid,integer,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_read_instance_channel_thread(uuid,uuid,uuid,uuid,integer,text) TO authenticated;
