-- PROPOSTA LOCAL. Não executada remotamente. Não habilita escrita/motores.
-- Extensão aditiva: não regrava perfis/revisões, não valida CPF/CNPJ ou identidade.
-- Helpers/RPCs mantêm ACL, search_path e verificações de conta da migração anterior.
BEGIN;

CREATE OR REPLACE FUNCTION public.ienvia_crm_profile_defaults() RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT '{"name":null,"company":"","docNumber":"","city":"","email":"","leadSource":"","assignee":"","note":"","lostReason":"","stage":"novo","dealStatus":"open","dealValueCents":0,"saved":false,"hot":false,"pinned":false,"archived":false,"followUp":null,"tags":[],"tasks":[]}'::jsonb
$$;
REVOKE ALL ON FUNCTION public.ienvia_crm_profile_defaults() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.ienvia_crm_profile_patch(p jsonb) RETURNS jsonb
 LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text; v jsonb; s text; n numeric; item jsonb; normalized jsonb:=p; maxlen integer; at_time timestamptz;
BEGIN
 IF p IS NULL OR jsonb_typeof(p) IS DISTINCT FROM 'object' OR p='{}'::jsonb OR octet_length(p::text)>16384
 OR p-ARRAY['name','company','docNumber','city','email','leadSource','assignee','note','lostReason','stage','dealStatus','dealValueCents','saved','hot','pinned','archived','followUp','tags','tasks']<>'{}'::jsonb THEN RAISE EXCEPTION 'Campos CRM inválidos' USING ERRCODE='22023'; END IF;
 FOR k,v IN SELECT key,value FROM jsonb_each(p) LOOP
  IF k=ANY(ARRAY['name','company','docNumber','city','email','leadSource','assignee','note','lostReason']) THEN
   IF k='name' AND v='null'::jsonb THEN CONTINUE; END IF;
   maxlen:=CASE k WHEN 'name' THEN 80 WHEN 'company' THEN 120 WHEN 'docNumber' THEN 40 WHEN 'city' THEN 80 WHEN 'email' THEN 120 WHEN 'leadSource' THEN 80 WHEN 'assignee' THEN 64 WHEN 'note' THEN 1000 ELSE 240 END;
   s:=v#>>'{}';
   IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR length(s)>maxlen OR (CASE WHEN k='note' THEN regexp_replace(s,E'[\n\r\t]','','g') ELSE s END)~'[[:cntrl:]]' OR k='name' AND length(btrim(s))=0 THEN RAISE EXCEPTION 'Texto CRM inválido' USING ERRCODE='22023'; END IF;
   normalized:=jsonb_set(normalized,ARRAY[k],to_jsonb(btrim(s)));
  ELSIF k=ANY(ARRAY['saved','hot','pinned','archived']) THEN
   IF jsonb_typeof(v) IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Booleano CRM inválido' USING ERRCODE='22023'; END IF;
  ELSIF k='stage' THEN
   IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR (v#>>'{}') NOT IN ('novo','qualificando','em_atendimento','aguardando_humano','concluido') THEN RAISE EXCEPTION 'Etapa inválida' USING ERRCODE='22023'; END IF;
  ELSIF k='dealStatus' THEN
   IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR (v#>>'{}') NOT IN ('open','won','lost') THEN RAISE EXCEPTION 'Negócio inválido' USING ERRCODE='22023'; END IF;
  ELSIF k='dealValueCents' THEN
   IF jsonb_typeof(v) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Valor em centavos obrigatório' USING ERRCODE='22023'; END IF;
   n:=(v#>>'{}')::numeric;
   IF n<0 OR n>100000000000 OR trunc(n)<>n THEN RAISE EXCEPTION 'Centavos inválidos' USING ERRCODE='22023'; END IF;
   normalized:=jsonb_set(normalized,ARRAY[k],to_jsonb(n::bigint));
  ELSIF k='followUp' AND v<>'null'::jsonb THEN
   s:=v#>>'{}';
   IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR s!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' THEN RAISE EXCEPTION 'Data UTC inválida' USING ERRCODE='22023'; END IF;
   at_time:=s::timestamptz;
   IF NOT isfinite(at_time) OR to_char(at_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>s THEN RAISE EXCEPTION 'Data inválida' USING ERRCODE='22023'; END IF;
  ELSIF k='tags' THEN
   IF jsonb_typeof(v) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Etiquetas inválidas' USING ERRCODE='22023'; END IF;
   IF jsonb_array_length(v)>8 THEN RAISE EXCEPTION 'Etiquetas demais' USING ERRCODE='22023'; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(v) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'string' OR length(btrim(item#>>'{}')) NOT BETWEEN 1 AND 24 OR (item#>>'{}')~'[[:cntrl:]]' THEN RAISE EXCEPTION 'Etiqueta inválida' USING ERRCODE='22023'; END IF;
   END LOOP;
   IF (SELECT count(DISTINCT btrim(value)) FROM jsonb_array_elements_text(v))<>jsonb_array_length(v) THEN RAISE EXCEPTION 'Etiqueta repetida' USING ERRCODE='22023'; END IF;
   normalized:=jsonb_set(normalized,ARRAY[k],coalesce((SELECT jsonb_agg(btrim(value) ORDER BY ord) FROM jsonb_array_elements_text(v) WITH ORDINALITY a(value,ord)),'[]'::jsonb));
  ELSIF k='tasks' THEN
   IF jsonb_typeof(v) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Tarefas inválidas' USING ERRCODE='22023'; END IF;
   IF jsonb_array_length(v)>30 THEN RAISE EXCEPTION 'Tarefas demais' USING ERRCODE='22023'; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(v) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['id','text','done']<>'{}'::jsonb OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string' OR coalesce(item->>'id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR jsonb_typeof(item->'text') IS DISTINCT FROM 'string' OR length(btrim(item->>'text')) NOT BETWEEN 1 AND 200 OR (item->>'text')~'[[:cntrl:]]' OR jsonb_typeof(item->'done') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Tarefa inválida' USING ERRCODE='22023'; END IF;
   END LOOP;
   IF (SELECT count(DISTINCT lower(value->>'id')) FROM jsonb_array_elements(v))<>jsonb_array_length(v) THEN RAISE EXCEPTION 'Tarefa repetida' USING ERRCODE='22023'; END IF;
   normalized:=jsonb_set(normalized,ARRAY[k],coalesce((SELECT jsonb_agg(jsonb_build_object('id',lower(value->>'id'),'text',btrim(value->>'text'),'done',value->'done') ORDER BY ord) FROM jsonb_array_elements(v) WITH ORDINALITY a(value,ord)),'[]'::jsonb));
  END IF;
 END LOOP;
 RETURN normalized;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range OR invalid_text_representation THEN RAISE EXCEPTION 'Campo CRM inválido' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION public.ienvia_crm_profile_patch(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.ienvia_crm_contact_dto(c public.ienvia_crm_contacts) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.ienvia_instance_threads;
BEGIN
 IF c.thread_id IS NOT NULL THEN SELECT * INTO STRICT t FROM public.ienvia_instance_threads WHERE owner_id=c.owner_id AND id=c.thread_id; END IF;
 RETURN jsonb_build_object('ownerId',c.owner_id,'id',c.id,'threadId',c.thread_id,'source',CASE WHEN c.thread_id IS NULL THEN 'manual' ELSE 'canonical_thread' END,
 'identityKind',CASE WHEN c.thread_id IS NULL THEN 'unverified_contact' WHEN t.peer_scope='pn' THEN 'verified_pn' ELSE 'provisional_lid' END,
 'selfJid',t.self_jid,'peerJid',t.peer_jid,'phone',CASE WHEN c.thread_id IS NULL THEN c.phone_hint WHEN t.peer_scope='pn' THEN '+'||split_part(t.peer_jid,'@',1) ELSE NULL END,
 'revision',c.revision,'profile',jsonb_build_object('docNumber','')||c.profile,'createdAt',c.created_at,'updatedAt',c.updated_at);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_crm_contact_dto(public.ienvia_crm_contacts) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.ienvia_crm_list_contacts(p_owner uuid,p_limit integer DEFAULT 20,p_after uuid DEFAULT NULL,p_search text DEFAULT '',p_instance uuid DEFAULT NULL,p_visibility text DEFAULT 'visible',p_saved boolean DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.ienvia_crm_assert_reader(p_owner);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_search IS NULL OR length(p_search)>80 OR p_search~'[[:cntrl:]]' OR p_visibility IS NULL OR p_visibility NOT IN ('visible','hidden','all') THEN RAISE EXCEPTION 'Filtros inválidos' USING ERRCODE='22023'; END IF;
 IF p_instance IS NOT NULL THEN
  PERFORM 1 FROM public.ienvia_channels WHERE owner_id=p_owner AND id=p_instance;
  IF NOT FOUND THEN RAISE EXCEPTION 'Instância não encontrada' USING ERRCODE='P0002'; END IF;
 END IF;
 WITH filtered AS MATERIALIZED (
  SELECT c.* FROM public.ienvia_crm_contacts c LEFT JOIN public.ienvia_instance_threads t ON t.owner_id=c.owner_id AND t.id=c.thread_id
  WHERE c.owner_id=p_owner AND (p_saved IS NULL OR (c.profile->>'saved')::boolean=p_saved)
  AND ((c.thread_id IS NULL AND p_instance IS NULL AND p_visibility<>'hidden') OR
   (c.thread_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.ienvia_instance_messages m JOIN public.ienvia_instance_message_origins o ON o.owner_id=m.owner_id AND o.message_id=m.id JOIN public.ienvia_channels ch ON ch.owner_id=o.owner_id AND ch.id=o.instance_id WHERE m.owner_id=c.owner_id AND m.thread_id=c.thread_id AND (p_instance IS NULL OR ch.id=p_instance) AND (p_visibility='all' OR ch.crm_visible=(p_visibility='visible')))))
  AND (p_search='' OR strpos(lower(coalesce(c.profile->>'name','')),lower(p_search))>0 OR strpos(lower(c.profile->>'company'),lower(p_search))>0 OR strpos(lower(c.profile->>'city'),lower(p_search))>0 OR strpos(lower(coalesce(c.profile->>'docNumber','')),lower(p_search))>0 OR strpos(lower(coalesce(c.profile->>'email','')),lower(p_search))>0 OR strpos(lower(coalesce(c.profile->>'leadSource','')),lower(p_search))>0 OR strpos(lower(coalesce(c.profile->>'assignee','')),lower(p_search))>0 OR strpos(lower(coalesce(c.profile->>'note','')),lower(p_search))>0 OR strpos(coalesce(c.phone_hint,CASE WHEN t.peer_scope='pn' THEN '+'||split_part(t.peer_jid,'@',1) ELSE '' END),p_search)>0 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(c.profile->'tags') x(value) WHERE strpos(lower(value),lower(p_search))>0))
 ), next_page AS (SELECT * FROM filtered WHERE p_after IS NULL OR id>p_after ORDER BY id LIMIT p_limit+1), page AS (SELECT * FROM next_page ORDER BY id LIMIT p_limit)
 SELECT jsonb_build_object('ownerId',p_owner,'writesEnabled',public.ienvia_crm_can_write(p_owner),'instanceId',p_instance,'visibility',p_visibility,'items',coalesce((SELECT jsonb_agg(public.ienvia_crm_contact_dto(page) ORDER BY id) FROM page),'[]'::jsonb),
 'hasMore',(SELECT count(*)>p_limit FROM next_page),'nextCursor',CASE WHEN (SELECT count(*)>p_limit FROM next_page) THEN (SELECT id FROM page ORDER BY id DESC LIMIT 1) ELSE NULL END) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ienvia_crm_list_contacts(uuid,integer,uuid,text,uuid,text,boolean) FROM PUBLIC,anon,service_role;
CREATE OR REPLACE FUNCTION public.ienvia_crm_get_thread_profile(p_owner uuid,p_thread uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE t public.ienvia_instance_threads; c public.ienvia_crm_contacts; result jsonb;
BEGIN
 PERFORM public.ienvia_crm_assert_reader(p_owner);
 SELECT * INTO t FROM public.ienvia_instance_threads WHERE owner_id=p_owner AND id=p_thread;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada' USING ERRCODE='P0002'; END IF;
 SELECT * INTO c FROM public.ienvia_crm_contacts WHERE owner_id=p_owner AND thread_id=p_thread;
 IF FOUND THEN result:=public.ienvia_crm_contact_dto(c); END IF;
 RETURN jsonb_build_object('ownerId',p_owner,'writesEnabled',public.ienvia_crm_can_write(p_owner),'threadId',p_thread,'contact',result,'documentFieldSupported',true,
 'identity',jsonb_build_object('selfJid',t.self_jid,'peerJid',t.peer_jid,'identityKind',CASE WHEN t.peer_scope='pn' THEN 'verified_pn' ELSE 'provisional_lid' END));
END $$;
REVOKE ALL ON FUNCTION public.ienvia_crm_get_thread_profile(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_crm_get_thread_profile(uuid,uuid) TO authenticated;

COMMIT;
