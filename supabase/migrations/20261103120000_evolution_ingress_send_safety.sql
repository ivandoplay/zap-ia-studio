-- Correção LOCAL. Aplicar por migração em ambiente de homologação antes da produção.
-- Trava durável por tentativa de envio; não representa confirmação de entrega.
CREATE TABLE public.ienvia_evolution_send_claims (
 owner_id uuid NOT NULL REFERENCES public.zapia_users(user_id) ON DELETE CASCADE,
 tentativa_id uuid NOT NULL,
 campanha_id uuid NOT NULL,
 criado_em timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,tentativa_id)
);
ALTER TABLE public.ienvia_evolution_send_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_evolution_send_claims FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.ienvia_claim_evolution_send(p_campanha uuid,p_destinatario uuid,p_etapa integer,p_tentativa uuid,p_slot text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid := auth.uid(); v_count integer; v_phone text;
BEGIN
 IF v_user IS NULL OR public.zapia_is_user_active(v_user) IS NOT TRUE OR p_slot !~ '^slot_[1-3]$' THEN RETURN false; END IF;
 -- Mesma ordem de locks que as transições de campanha existentes: controle, depois checkpoint.
 PERFORM 1 FROM public.ienvia_campanhas_controle c WHERE c.owner_id=v_user AND c.campanha_id=p_campanha AND c.status='ativa' FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM public.zapia_users u WHERE u.user_id=v_user AND (u.role='master' OR u.max_wa_slots >= right(p_slot,1)::integer);
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM public.ienvia_campanha_checkpoints c WHERE c.owner_id=v_user AND c.campanha_id=p_campanha
 AND c.destinatario_id=p_destinatario AND c.etapa=p_etapa AND c.tentativa_id=p_tentativa AND c.status='em_envio'
 AND c.material->>'slotId'=p_slot AND c.material->>'provedor'='evolution_api' FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT d.telefone INTO v_phone FROM public.ienvia_campanha_destinatarios d WHERE d.owner_id=v_user AND d.campanha_id=p_campanha AND d.destinatario_id=p_destinatario;
 IF v_phone IS NULL THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.zapia_contacts c WHERE c.user_id=v_user AND (c.chat_id=v_phone||'@s.whatsapp.net' OR c.chat_id=p_slot||'::'||v_phone||'@s.whatsapp.net')
   AND (c.data->>'aiIgnored'='true' OR c.data->>'pausedUntil'='forever')) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.zapia_workspaces w CROSS JOIN LATERAL jsonb_array_elements(coalesce(w.settings->'ignoredContacts','[]'::jsonb)) i WHERE w.user_id=v_user AND regexp_replace(i->>'phone','[^0-9]','','g')=v_phone) THEN RETURN false; END IF;
 INSERT INTO public.ienvia_evolution_send_claims(owner_id,tentativa_id,campanha_id) VALUES(v_user,p_tentativa,p_campanha) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN v_count=1;
END $$;
REVOKE ALL ON FUNCTION public.ienvia_claim_evolution_send(uuid,uuid,integer,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ienvia_claim_evolution_send(uuid,uuid,integer,uuid,text) TO authenticated;

-- Registro de deduplicação e recibos. Não contém texto das mensagens nem credenciais.
-- chat_id é identificador privado; não há acesso direto por anon/authenticated.
CREATE TABLE public.ienvia_evolution_ingress (
 owner_id uuid NOT NULL REFERENCES public.zapia_users(user_id) ON DELETE CASCADE,
 chat_id text NOT NULL,
 event_key text NOT NULL,
 ack integer NOT NULL DEFAULT 0 CHECK(ack BETWEEN 0 AND 3),
 criado_em timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,chat_id,event_key)
);
ALTER TABLE public.ienvia_evolution_ingress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_evolution_ingress FROM PUBLIC,anon,authenticated;

-- Usado SOMENTE pelo webhook autenticado no servidor com service_role.
-- Mescla sob lock por conta/conversa, preservando metadados, notas e mensagens anteriores.
CREATE FUNCTION public.ienvia_merge_evolution_contact(p_owner uuid,p_chat text,p_messages jsonb DEFAULT '[]',p_name text DEFAULT '',p_event text DEFAULT '',p_ack_id text DEFAULT '',p_ack integer DEFAULT 0,p_patch jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_data jsonb; v_messages jsonb; v_m jsonb; v_old jsonb; v_idx integer; v_found integer; v_i integer; v_ack integer; v_count integer; v_inserted boolean:=true; v_unread integer:=0; v_latest timestamptz; v_id text;
BEGIN
 IF public.zapia_is_user_active(p_owner) IS NOT TRUE THEN RAISE EXCEPTION 'inactive tenant' USING ERRCODE='42501'; END IF;
 IF p_chat IS NULL OR length(p_chat)>300 OR jsonb_typeof(p_messages)<>'array' OR jsonb_array_length(p_messages)>500 OR p_ack NOT BETWEEN 0 AND 3 THEN RAISE EXCEPTION 'invalid projection'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text || ':' || p_chat,0));
 SELECT c.data INTO v_data FROM public.zapia_contacts c WHERE c.user_id=p_owner AND c.chat_id=p_chat FOR UPDATE;
 v_data:=coalesce(v_data,'{}'::jsonb);
 v_messages:=CASE WHEN jsonb_typeof(v_data->'messages')='array' THEN v_data->'messages' ELSE '[]'::jsonb END;
 IF p_event<>'' THEN
   INSERT INTO public.ienvia_evolution_ingress(owner_id,chat_id,event_key) VALUES(p_owner,p_chat,p_event) ON CONFLICT DO NOTHING;
   GET DIAGNOSTICS v_count=ROW_COUNT; v_inserted:=v_count=1;
 END IF;
 IF p_ack_id<>'' AND p_ack>0 THEN
   INSERT INTO public.ienvia_evolution_ingress(owner_id,chat_id,event_key,ack) VALUES(p_owner,p_chat,'ack:'||p_ack_id,p_ack)
   ON CONFLICT(owner_id,chat_id,event_key) DO UPDATE SET ack=greatest(ienvia_evolution_ingress.ack,excluded.ack);
 END IF;
 FOR v_m IN SELECT value FROM jsonb_array_elements(p_messages) LOOP
   v_found:=-1; v_id:=coalesce(nullif(v_m->>'waMsgId',''),v_m->>'id');
   IF v_id IS NULL OR v_id='' THEN RAISE EXCEPTION 'message without identity'; END IF;
   IF jsonb_array_length(v_messages)>0 THEN
     FOR v_i IN 0..jsonb_array_length(v_messages)-1 LOOP
       v_old:=v_messages->v_i;
       IF v_old->>'id'=v_m->>'id' OR coalesce(v_old->>'waMsgId',v_old->>'id')=v_id THEN v_found:=v_i; EXIT; END IF;
     END LOOP;
   END IF;
   IF v_found>=0 THEN
     v_old:=v_messages->v_found;
     v_ack:=greatest(coalesce((v_old->>'ack')::integer,0),coalesce((v_m->>'ack')::integer,0));
     v_m:=v_old || v_m;
     IF v_old->>'role'='assistant' AND v_m->>'role'='owner' THEN v_m:=v_m || '{"role":"assistant"}'; END IF;
     IF v_ack>0 THEN v_m:=(v_m-'deliveryStatus') || jsonb_build_object('ack',v_ack); END IF;
     v_messages:=jsonb_set(v_messages,ARRAY[v_found::text],v_m);
   ELSE v_messages:=v_messages || jsonb_build_array(v_m);
   IF v_m->>'role'='user' AND coalesce(v_m->>'historical','false')<>'true' AND v_inserted THEN v_unread:=v_unread+1; END IF;
   END IF;
 END LOOP;
 -- Recibos fora de ordem são aplicados também quando a mensagem chega depois do ACK.
 IF jsonb_array_length(v_messages)>0 THEN
   FOR v_i IN 0..jsonb_array_length(v_messages)-1 LOOP
     v_m:=v_messages->v_i; v_id:=coalesce(v_m->>'waMsgId',v_m->>'id');
     SELECT i.ack INTO v_ack FROM public.ienvia_evolution_ingress i WHERE i.owner_id=p_owner AND i.chat_id=p_chat AND i.event_key='ack:'||v_id;
     IF coalesce(v_ack,0)>0 THEN v_messages:=jsonb_set(v_messages,ARRAY[v_i::text],(v_m-'deliveryStatus') || jsonb_build_object('ack',greatest(coalesce((v_m->>'ack')::integer,0),v_ack))); END IF;
   END LOOP;
 END IF;
 SELECT coalesce(jsonb_agg(m ORDER BY (m->>'timestamp')::timestamptz),'[]'::jsonb), max((m->>'timestamp')::timestamptz) INTO v_messages,v_latest FROM (SELECT DISTINCT ON (coalesce(value->>'waMsgId',value->>'id')) value AS m FROM jsonb_array_elements(v_messages) ORDER BY coalesce(value->>'waMsgId',value->>'id'), (value->>'role'='assistant') DESC) unique_messages;
 -- Não ressuscitar histórico que o titular limpou.
 IF nullif(v_data->>'historyClearedAt','') IS NOT NULL THEN
   SELECT coalesce(jsonb_agg(m ORDER BY (m->>'timestamp')::timestamptz),'[]'::jsonb) INTO v_messages FROM jsonb_array_elements(v_messages) m WHERE (m->>'timestamp')::timestamptz>(v_data->>'historyClearedAt')::timestamptz;
 END IF;
 SELECT max((m->>'timestamp')::timestamptz) INTO v_latest FROM jsonb_array_elements(v_messages) m;
 v_latest:=coalesce(v_latest,nullif(v_data->>'lastMessageAt','')::timestamptz);
 IF jsonb_array_length(v_messages)=0 AND v_data='{}'::jsonb AND p_ack_id<>'' THEN RETURN jsonb_build_object('inserted',v_inserted,'contact',v_data); END IF;
 IF v_unread>0 THEN v_data:=v_data || jsonb_build_object('unreadCount',coalesce((v_data->>'unreadCount')::integer,0)+v_unread,'unreadAlert',true); END IF;
 v_data:=v_data || (SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(p_patch) WHERE key IN ('aiIgnored','pausedUntil','pauseReason'));
 v_data:=v_data || jsonb_build_object('messages',v_messages,'lastMessageAt',coalesce(v_latest::text,v_data->>'lastMessageAt'));
 IF p_name<>'' AND coalesce(v_data->>'name','') IN ('',p_chat) THEN v_data:=v_data || jsonb_build_object('name',left(p_name,120)); END IF;
 INSERT INTO public.zapia_contacts(user_id,chat_id,data,last_message_at,updated_at) VALUES(p_owner,p_chat,v_data,v_latest,now())
 ON CONFLICT(user_id,chat_id) DO UPDATE SET data=excluded.data,last_message_at=excluded.last_message_at,updated_at=excluded.updated_at;
 RETURN jsonb_build_object('inserted',v_inserted,'contact',v_data);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_merge_evolution_contact(uuid,text,jsonb,text,text,text,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_merge_evolution_contact(uuid,text,jsonb,text,text,text,integer,jsonb) TO service_role;

-- Preserva o marcador campaignId, inclusive quando o callback SEND_MESSAGE chega antes.
CREATE FUNCTION public.ienvia_record_evolution_campaign_send(p_campanha uuid,p_destinatario uuid,p_etapa integer,p_tentativa uuid,p_message_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid:=auth.uid(); v_cp public.ienvia_campanha_checkpoints%ROWTYPE; v_phone text; v_chat text; v_text text;
BEGIN
 IF v_user IS NULL OR public.zapia_is_user_active(v_user) IS NOT TRUE OR coalesce(length(p_message_id),0) NOT BETWEEN 1 AND 300 THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ienvia_evolution_send_claims s WHERE s.owner_id=v_user AND s.tentativa_id=p_tentativa AND s.campanha_id=p_campanha) THEN RETURN false; END IF;
 SELECT c.* INTO v_cp FROM public.ienvia_campanha_checkpoints c WHERE c.owner_id=v_user AND c.campanha_id=p_campanha AND c.destinatario_id=p_destinatario AND c.etapa=p_etapa AND c.tentativa_id=p_tentativa AND c.material->>'provedor'='evolution_api';
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT d.telefone INTO v_phone FROM public.ienvia_campanha_destinatarios d WHERE d.owner_id=v_user AND d.campanha_id=p_campanha AND d.destinatario_id=p_destinatario;
 IF v_phone IS NULL THEN RETURN false; END IF;
 v_chat:=CASE WHEN v_cp.material->>'slotId'='slot_1' THEN '' ELSE (v_cp.material->>'slotId')||'::' END || v_phone || '@s.whatsapp.net';
 v_text:=CASE v_cp.material->'bloco'->>'tipo' WHEN 'texto' THEN v_cp.material->'bloco'->>'texto' WHEN 'imagem' THEN '[Imagem enviada pela campanha]' ELSE '[Áudio enviado pela campanha]' END;
 PERFORM public.ienvia_merge_evolution_contact(v_user,v_chat,jsonb_build_array(jsonb_build_object('id',p_message_id,'waMsgId',p_message_id,'role','assistant','text',v_text,'campaignId',p_campanha,'timestamp',now(),'deliveryStatus','accepted')));
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.ienvia_record_evolution_campaign_send(uuid,uuid,integer,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ienvia_record_evolution_campaign_send(uuid,uuid,integer,uuid,text) TO authenticated;
