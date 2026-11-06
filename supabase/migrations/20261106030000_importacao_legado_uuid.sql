-- Identidade de cada chip legado, conferida por uma pessoa e guardada no banco.
--
-- Por que existe: o `self_jid` (o "de quem é este chip") é o que decide em qual chip
-- uma conversa entra. Ele NÃO pode ser deduzido por heurística — o teste em produção
-- mostrou que usar a identidade do Chip 2 no Chip 1 mistura os dois números. Então ele
-- entra aqui por revisão explícita (`consent = 'confirmado'`) e a importação só roda
-- com a identidade já confirmada.

CREATE TABLE IF NOT EXISTS public.ienvia_legacy_channel_identities(
 owner_id uuid NOT NULL,
 legacy_slot_id text NOT NULL,
 self_jid text NOT NULL,
 source text NOT NULL DEFAULT 'manual_review',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,legacy_slot_id),
 UNIQUE(owner_id,self_jid),
 CHECK(self_jid~'^[1-9][0-9]{7,14}@s[.]whatsapp[.]net$'),
 FOREIGN KEY(owner_id,legacy_slot_id) REFERENCES public.ienvia_legacy_channel_links(owner_id,legacy_slot_id)
);
ALTER TABLE public.ienvia_legacy_channel_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_legacy_channel_identities FROM PUBLIC,anon,authenticated,service_role;

-- Carimbo: toda conversa importada guarda de qual chip veio (e com qual identidade).
CREATE TABLE IF NOT EXISTS public.ienvia_legacy_imports(
 owner_id uuid NOT NULL,
 slot_id text NOT NULL,
 thread_id uuid NOT NULL,
 self_jid text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,slot_id,thread_id),
 FOREIGN KEY(owner_id,thread_id) REFERENCES public.ienvia_instance_threads(owner_id,id) ON DELETE CASCADE
);
ALTER TABLE public.ienvia_legacy_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_legacy_imports FROM PUBLIC,anon,authenticated,service_role;

-- Confirma a identidade do chip (idempotente; recusa identidade já usada por outro chip).
CREATE OR REPLACE FUNCTION public.ienvia_legacy_confirm_channel_identity(p_owner uuid,p_slot text,p_self text,p_consent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
BEGIN
 PERFORM public.ienvia_legacy_import_guard(p_owner);
 IF p_consent<>'confirmado' THEN RAISE EXCEPTION 'Confirmação explícita obrigatória' USING ERRCODE='22023'; END IF;
 IF p_slot IS NULL OR p_slot NOT IN ('slot_1','slot_2','slot_3') THEN RAISE EXCEPTION 'Chip legado inválido' USING ERRCODE='22023'; END IF;
 IF p_self IS NULL OR p_self!~'^[1-9][0-9]{7,14}@s[.]whatsapp[.]net$' THEN RAISE EXCEPTION 'Identidade do chip inválida' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ienvia_legacy_channel_links WHERE owner_id=p_owner AND legacy_slot_id=p_slot) THEN RAISE EXCEPTION 'Importe o chip antes de confirmar a identidade' USING ERRCODE='55000'; END IF;
 INSERT INTO public.ienvia_legacy_channel_identities(owner_id,legacy_slot_id,self_jid) VALUES(p_owner,p_slot,p_self)
 ON CONFLICT(owner_id,legacy_slot_id) DO UPDATE SET self_jid=EXCLUDED.self_jid;
 RETURN jsonb_build_object('ownerId',p_owner,'slotId',p_slot,'selfJid',p_self,'confirmed',true);
END $$;

-- Importa as conversas de UM chip, usando a identidade já confirmada do banco.
-- Nunca aceita identidade vinda de fora, nunca cruza chips, e é idempotente.
CREATE OR REPLACE FUNCTION public.ienvia_import_legacy_conversations(p_owner uuid,p_slot text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='25s' SET lock_timeout='3s' AS $$
DECLARE c public.ienvia_channels; self_jid text; peer text; t uuid; chats integer:=0; msgs integer:=0; skipped integer:=0; row_c record; m jsonb;
BEGIN
 PERFORM public.ienvia_legacy_import_guard(p_owner);
 SELECT ch.* INTO c FROM public.ienvia_legacy_channel_links l JOIN public.ienvia_channels ch ON ch.owner_id=l.owner_id AND ch.id=l.channel_id WHERE l.owner_id=p_owner AND l.legacy_slot_id=p_slot;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Importe o chip antes das conversas' USING ERRCODE='55000'; END IF;
 SELECT i.self_jid INTO self_jid FROM public.ienvia_legacy_channel_identities i WHERE i.owner_id=p_owner AND i.legacy_slot_id=p_slot;
 IF self_jid IS NULL THEN RAISE EXCEPTION 'Identidade deste chip não confirmada; nada será importado' USING ERRCODE='55000'; END IF;
 FOR row_c IN SELECT z.chat_id,z.data FROM public.zapia_contacts z WHERE z.user_id=p_owner AND ((left(z.chat_id,length(p_slot)+2)=p_slot||'::') OR (p_slot='slot_1' AND position('::' in z.chat_id)=0)) ORDER BY z.chat_id LOOP
  peer:=public.ienvia_legacy_peer(row_c.chat_id);
  IF peer IS NULL THEN skipped:=skipped+1; CONTINUE; END IF;
  t:=public.ienvia_instance_thread_id(p_owner,self_jid,peer,c.id);
  INSERT INTO public.ienvia_legacy_imports(owner_id,slot_id,thread_id,self_jid) VALUES(p_owner,p_slot,t,self_jid) ON CONFLICT DO NOTHING;
  chats:=chats+1;
  FOR m IN SELECT value FROM jsonb_array_elements(coalesce(row_c.data->'messages','[]'::jsonb)) LOOP
   IF coalesce(m->>'waMsgId',m->>'id','')!~'^[!-~]{1,128}$' OR jsonb_typeof(m->'waMsgKey') IS DISTINCT FROM 'object' THEN skipped:=skipped+1; CONTINUE; END IF;
   INSERT INTO public.ienvia_instance_messages(owner_id,thread_id,provider_message_id,from_me,text_body,media_type,has_content,deleted,ack,message_at,timestamp_source)
   VALUES(p_owner,t,m->>'waMsgId',coalesce((m->'waMsgKey'->>'fromMe')::boolean,m->>'role'='owner'),
    CASE WHEN jsonb_typeof(m->'text')='string' THEN left(m->>'text',65536) ELSE NULL END,
    NULL,jsonb_typeof(m->'text')='string',false,0,
    coalesce((m->>'timestamp')::timestamptz,clock_timestamp()),'capture')
   ON CONFLICT(owner_id,thread_id,provider_message_id,from_me) DO NOTHING;
   IF FOUND THEN msgs:=msgs+1; END IF;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('ownerId',p_owner,'slotId',p_slot,'channelId',c.id,'selfJid',self_jid,'threads',chats,'messages',msgs,'skipped',skipped);
END $$;

-- Liga cada mensagem importada à origem (o canal) — só mensagens DESTE chip.
CREATE OR REPLACE FUNCTION public.ienvia_import_legacy_origins(p_owner uuid,p_slot text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='25s' SET lock_timeout='3s' AS $$
DECLARE c public.ienvia_channels; n integer:=0; v_self text;
BEGIN
 PERFORM public.ienvia_legacy_import_guard(p_owner);
 SELECT ch.* INTO c FROM public.ienvia_legacy_channel_links l JOIN public.ienvia_channels ch ON ch.owner_id=l.owner_id AND ch.id=l.channel_id WHERE l.owner_id=p_owner AND l.legacy_slot_id=p_slot;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Chip sem vínculo legado' USING ERRCODE='55000'; END IF;
 SELECT i.self_jid INTO v_self FROM public.ienvia_legacy_channel_identities i WHERE i.owner_id=p_owner AND i.legacy_slot_id=p_slot;
 IF v_self IS NULL THEN RAISE EXCEPTION 'Identidade deste chip não confirmada' USING ERRCODE='55000'; END IF;
 INSERT INTO public.ienvia_instance_message_origins(owner_id,message_id,instance_id)
 SELECT p_owner,m.id,c.id FROM public.ienvia_instance_messages m JOIN public.ienvia_legacy_imports i ON i.owner_id=m.owner_id AND i.thread_id=m.thread_id
 WHERE m.owner_id=p_owner AND i.slot_id=p_slot AND i.self_jid=v_self
 ON CONFLICT(owner_id,message_id,instance_id) DO NOTHING;
 GET DIAGNOSTICS n = ROW_COUNT;
 RETURN jsonb_build_object('ownerId',p_owner,'slotId',p_slot,'channelId',c.id,'messagesLinked',n);
END $$;

-- Importa as fichas (contatos com nome) daquele chip, ligadas à thread canônica.
CREATE OR REPLACE FUNCTION public.ienvia_import_legacy_profiles(p_owner uuid,p_slot text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='25s' SET lock_timeout='3s' AS $$
DECLARE row_c record; v_self text; payload jsonb; saved integer:=0; skipped integer:=0;
BEGIN
 PERFORM public.ienvia_legacy_import_guard(p_owner);
 SELECT i.self_jid INTO v_self FROM public.ienvia_legacy_channel_identities i WHERE i.owner_id=p_owner AND i.legacy_slot_id=p_slot;
 IF v_self IS NULL THEN RAISE EXCEPTION 'Identidade deste chip não confirmada; nada será importado' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ienvia_legacy_imports i WHERE i.owner_id=p_owner AND i.slot_id=p_slot AND i.self_jid=v_self) THEN RAISE EXCEPTION 'Importe as conversas deste chip antes das fichas' USING ERRCODE='55000'; END IF;
 FOR row_c IN SELECT z.chat_id,z.data FROM public.zapia_contacts z WHERE z.user_id=p_owner AND ((left(z.chat_id,length(p_slot)+2)=p_slot||'::') OR (p_slot='slot_1' AND position('::' in z.chat_id)=0)) ORDER BY z.chat_id LOOP
  payload:=jsonb_build_object('name',nullif(btrim(coalesce(row_c.data->>'name','')),''),'company',coalesce(row_c.data->>'company',''),'city',coalesce(row_c.data->>'city',''),'email',coalesce(row_c.data->>'email',''),'leadSource',coalesce(row_c.data->>'leadSource',''),'note',left(coalesce(row_c.data->>'notes',''),1000));
  IF payload->>'name' IS NULL THEN skipped:=skipped+1; CONTINUE; END IF;
  IF jsonb_typeof(row_c.data->'tags')='array' THEN payload:=payload||jsonb_build_object('tags',(SELECT coalesce(jsonb_agg(left(btrim(x),32)),'[]'::jsonb) FROM (SELECT x FROM jsonb_array_elements_text(row_c.data->'tags') x WHERE btrim(x)<>'' LIMIT 8) z)); END IF;
  PERFORM public.ienvia_crm_import_contact(p_owner,p_slot,v_self,row_c.chat_id,payload);
  saved:=saved+1;
 END LOOP;
 RETURN jsonb_build_object('ownerId',p_owner,'slotId',p_slot,'profiles',saved,'skipped',skipped);
END $$;

REVOKE ALL ON FUNCTION public.ienvia_legacy_confirm_channel_identity(uuid,text,text,text),public.ienvia_import_legacy_conversations(uuid,text),public.ienvia_import_legacy_origins(uuid,text),public.ienvia_import_legacy_profiles(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_legacy_confirm_channel_identity(uuid,text,text,text),public.ienvia_import_legacy_conversations(uuid,text),public.ienvia_import_legacy_origins(uuid,text),public.ienvia_import_legacy_profiles(uuid,text) TO authenticated;
