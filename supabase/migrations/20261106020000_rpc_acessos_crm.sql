-- Consolidado do que foi aplicado em pedaços via endpoint de SQL do projeto
-- iuysmojhaxplnhfrxqkv entre 05/11 e 06/11/2026. Existe para que um banco novo convirja
-- com o que o código já usa. Nada aqui altera dados legados:
--   * nenhuma tabela zapia_* é tocada;
--   * as escritas novas vão só para tabelas ienvia_crm_*;
--   * a escrita CRM segue desligada (ienvia_crm_write_accounts nasce vazia).

-- 1. Funções órfãs herdadas que colidiam por assinatura com a migração 20261104005000.
--    Não eram chamadas pelo servidor nem por nenhuma migração versionada.
DROP FUNCTION IF EXISTS public.ienvia_crm_apply_profile(public.zapia_contacts,integer,jsonb);
DROP FUNCTION IF EXISTS public.ienvia_crm_assert_writer();
DROP FUNCTION IF EXISTS public.ienvia_crm_assert_reader(uuid);
DROP FUNCTION IF EXISTS public.ienvia_crm_can_write(uuid);

-- 2. Helpers de atalho/etiqueta com nomes de parâmetro divergentes dos já instalados.
--    Recriados com a assinatura de 20261104010000; o corpo é idêntico ao da migração.
CREATE OR REPLACE FUNCTION public.ienvia_crm_quick_trim(v text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT btrim(v,E' \t\n\r\v\f'||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279))
$$;
CREATE OR REPLACE FUNCTION public.ienvia_crm_quick_length(v text) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(sum(CASE WHEN ascii(c)>65535 THEN 2 ELSE 1 END),0)::integer FROM regexp_split_to_table(v,'') AS c
$$;
REVOKE ALL ON FUNCTION public.ienvia_crm_quick_trim(text),public.ienvia_crm_quick_length(text) FROM PUBLIC,anon,authenticated,service_role;

-- 3. 20261104008000 (documento) precisa vir DEPOIS de 20261104005000 e 20261104011000,
--    porque redefine o perfil com `docNumber`. Ordem aplicada no banco:
--      05000 -> 08000 -> 10000 -> 11000 -> 09000
--    Reaplicar 08000 aqui garante o mesmo estado final em um banco novo.
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
    IF jsonb_typeof(item) IS DISTINCT FROM 'string' OR length(btrim(item#>>'{}')) NOT BETWEEN 1 AND 32 OR (item#>>'{}')~'[[:cntrl:]]' THEN RAISE EXCEPTION 'Etiqueta inválida' USING ERRCODE='22023'; END IF;
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

CREATE OR REPLACE FUNCTION public.ienvia_crm_profile_defaults() RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT '{"name":null,"company":"","docNumber":"","city":"","email":"","leadSource":"","assignee":"","note":"","lostReason":"","stage":"novo","dealStatus":"open","dealValueCents":0,"saved":false,"hot":false,"pinned":false,"archived":false,"followUp":null,"tags":[],"tasks":[]}'::jsonb
$$;
REVOKE ALL ON FUNCTION public.ienvia_crm_profile_defaults() FROM PUBLIC,anon,authenticated,service_role;

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

CREATE OR REPLACE FUNCTION public.ienvia_crm_create_contact(p_request uuid,p_contact jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' SET lock_timeout='2s' AS $$
DECLARE u uuid:=auth.uid(); c public.ienvia_crm_contacts; payload jsonb; fingerprint text; phone text; inserted boolean;
BEGIN
 PERFORM public.ienvia_crm_assert_writer();
 IF p_request IS NULL OR p_request::text!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR octet_length(p_contact::text)>16384 OR jsonb_typeof(p_contact) IS DISTINCT FROM 'object' OR p_contact-ARRAY['name','phone','docNumber','company','city','email','leadSource']<>'{}'::jsonb OR jsonb_typeof(p_contact->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(p_contact->'phone') IS DISTINCT FROM 'string' OR (p_contact?'docNumber' AND jsonb_typeof(p_contact->'docNumber') IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'Cadastro inválido' USING ERRCODE='22023'; END IF;
 phone:=btrim(p_contact->>'phone');
 IF phone!~'^[+]?[1-9][0-9]{9,14}$' THEN RAISE EXCEPTION 'Telefone informado não é identidade verificada' USING ERRCODE='22023'; END IF;
 phone:='+'||ltrim(phone,'+');payload:=public.ienvia_crm_profile_patch(p_contact-'phone');
 fingerprint:=encode(sha256(convert_to((payload||jsonb_build_object('phone',phone))::text,'UTF8')),'hex');
 INSERT INTO public.ienvia_crm_contacts(owner_id,id,phone_hint,create_fingerprint,profile)
 VALUES(u,p_request,phone,fingerprint,public.ienvia_crm_profile_defaults()||payload||'{"saved":true}'::jsonb)
 ON CONFLICT(owner_id,id) DO NOTHING RETURNING * INTO c;
 inserted:=FOUND;
 IF NOT inserted THEN
  SELECT * INTO c FROM public.ienvia_crm_contacts WHERE owner_id=u AND id=p_request FOR UPDATE;
  IF c.create_fingerprint IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'Pedido reutilizado com intenção diferente' USING ERRCODE='40001'; END IF;
 ELSE
  INSERT INTO public.ienvia_crm_changes(owner_id,contact_id,revision,actor_id,action,changed_keys) VALUES(u,c.id,c.revision,u,'create',ARRAY(SELECT jsonb_object_keys(p_contact)));
 END IF;
 RETURN jsonb_build_object('ownerId',u,'writesEnabled',true,'contact',public.ienvia_crm_contact_dto(c),'replayed',NOT inserted);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_crm_create_contact(uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_crm_create_contact(uuid,jsonb) TO authenticated;

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
GRANT EXECUTE ON FUNCTION public.ienvia_crm_list_contacts(uuid,integer,uuid,text,uuid,text,boolean) TO authenticated;

-- 4. 20261104011000 (etiquetas). A cascata original escrevia em zapia_contacts via um helper
--    legado; aqui ela atualiza apenas ienvia_crm_contacts, registrando revisão e auditoria.
CREATE OR REPLACE FUNCTION public.ienvia_crm_get_tags(p_owner uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE r public.ienvia_crm_tag_libraries;
BEGIN
 PERFORM public.ienvia_crm_assert_reader(p_owner);SELECT * INTO r FROM public.ienvia_crm_tag_libraries WHERE owner_id=p_owner;
 RETURN jsonb_build_object('ownerId',p_owner,'projection','saved_tag_library_v1','revision',coalesce(r.revision,0),'items',coalesce(r.items,'[]'::jsonb),'updatedAt',r.updated_at,'writesEnabled',public.ienvia_crm_can_write(p_owner));
END $$;

CREATE OR REPLACE FUNCTION public.ienvia_crm_mutate_tags(p_revision integer,p_operation text,p_item jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' SET lock_timeout='2s' AS $$
DECLARE u uuid:=auth.uid();r public.ienvia_crm_tag_libraries;c public.ienvia_crm_contacts;existing jsonb;collision jsonb;id uuid;pos integer;name text;color text;old_name text;tags jsonb;affected integer:=0;
BEGIN
 PERFORM public.ienvia_crm_assert_writer();
 IF p_revision IS NULL OR p_revision<0 OR p_revision>=2147483647 OR p_operation IS NULL OR p_operation NOT IN ('save','remove') OR jsonb_typeof(p_item) IS DISTINCT FROM 'object' OR octet_length(p_item::text)>4096 THEN RAISE EXCEPTION 'Pedido inválido' USING ERRCODE='22023'; END IF;
 IF p_operation='remove' THEN
  IF p_item-ARRAY['id']<>'{}'::jsonb OR jsonb_typeof(p_item->'id') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Remoção inválida' USING ERRCODE='22023'; END IF;
 ELSE
  IF p_item-ARRAY['id','name','color']<>'{}'::jsonb OR jsonb_typeof(p_item->'name') IS DISTINCT FROM 'string' OR public.ienvia_crm_quick_length(p_item->>'name')>32 OR (p_item->>'name')~'[[:cntrl:]]' OR p_item?'color' AND (jsonb_typeof(p_item->'color') IS DISTINCT FROM 'string' OR (p_item->>'color')!~*'^#[0-9a-f]{6}$') THEN RAISE EXCEPTION 'Etiqueta inválida' USING ERRCODE='22023'; END IF;
  name:=public.ienvia_crm_quick_trim(p_item->>'name');color:=lower(coalesce(p_item->>'color','#10b981'));IF name='' THEN RAISE EXCEPTION 'Nome vazio' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_item?'id' THEN
  IF jsonb_typeof(p_item->'id') IS DISTINCT FROM 'string' OR (p_item->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'ID inválido' USING ERRCODE='22023'; END IF;id:=(p_item->>'id')::uuid;
 END IF;
 INSERT INTO public.ienvia_crm_tag_libraries(owner_id) VALUES(u) ON CONFLICT(owner_id) DO NOTHING;
 SELECT * INTO r FROM public.ienvia_crm_tag_libraries WHERE owner_id=u FOR UPDATE;
 IF r.revision<>p_revision THEN RAISE EXCEPTION 'Biblioteca mudou' USING ERRCODE='40001'; END IF;
 SELECT value,(ordinality-1)::integer INTO existing,pos FROM jsonb_array_elements(r.items) WITH ORDINALITY WHERE CASE WHEN id IS NOT NULL THEN value->>'id'=id::text ELSE lower(value->>'name')=lower(name) END;
 IF id IS NOT NULL AND existing IS NULL THEN RAISE EXCEPTION 'Etiqueta não encontrada' USING ERRCODE='P0002'; END IF;
 old_name:=existing->>'name';
 IF p_operation='save' THEN
  SELECT value INTO collision FROM jsonb_array_elements(r.items) WHERE lower(value->>'name')=lower(name) AND (existing IS NULL OR value->>'id'<>existing->>'id');IF collision IS NOT NULL THEN RAISE EXCEPTION 'Nome já usado' USING ERRCODE='40001'; END IF;
  id:=coalesce((existing->>'id')::uuid,gen_random_uuid());
  IF existing IS NULL THEN
   IF jsonb_array_length(r.items)>=200 THEN RAISE EXCEPTION 'Limite de etiquetas' USING ERRCODE='22023'; END IF;r.items:=r.items||jsonb_build_array(jsonb_build_object('id',id,'name',name,'color',color));
  ELSE r.items:=jsonb_set(r.items,ARRAY[pos::text],jsonb_build_object('id',id,'name',name,'color',color));END IF;
 ELSE r.items:=r.items-pos;END IF;
 IF existing IS NOT NULL AND (p_operation='remove' OR old_name IS DISTINCT FROM name) THEN
  FOR c IN SELECT * FROM public.ienvia_crm_contacts WHERE owner_id=u AND profile->'tags' ? old_name ORDER BY id LIMIT 501 FOR UPDATE LOOP
   affected:=affected+1;IF affected>500 THEN RAISE EXCEPTION 'Cascata excede limite seguro' USING ERRCODE='54000'; END IF;
   IF p_operation='remove' THEN SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb) INTO tags FROM jsonb_array_elements(c.profile->'tags') WITH ORDINALITY WHERE value<>to_jsonb(old_name);
   ELSE SELECT coalesce(jsonb_agg(value ORDER BY first_pos),'[]'::jsonb) INTO tags FROM (SELECT CASE WHEN value=to_jsonb(old_name) THEN to_jsonb(name) ELSE value END AS value,min(ordinality) AS first_pos FROM jsonb_array_elements(c.profile->'tags') WITH ORDINALITY GROUP BY CASE WHEN value=to_jsonb(old_name) THEN to_jsonb(name) ELSE value END) dedup;END IF;
   tags:=public.ienvia_crm_profile_patch(jsonb_build_object('tags',tags));
   UPDATE public.ienvia_crm_contacts SET profile=profile||tags,revision=revision+1,updated_at=clock_timestamp() WHERE owner_id=u AND id=c.id;
   INSERT INTO public.ienvia_crm_changes(owner_id,contact_id,revision,actor_id,action,changed_keys) VALUES(u,c.id,c.revision+1,u,'patch',ARRAY['tags']);
  END LOOP;
 END IF;
 UPDATE public.ienvia_crm_tag_libraries SET items=r.items,revision=r.revision+1,updated_at=clock_timestamp() WHERE owner_id=u RETURNING * INTO r;
 INSERT INTO public.ienvia_crm_tag_changes(owner_id,revision,actor_id,action,item_id,affected_count) VALUES(u,r.revision,u,p_operation,id,affected);
 RETURN jsonb_build_object('library',jsonb_build_object('ownerId',u,'projection','saved_tag_library_v1','revision',r.revision,'items',r.items,'updatedAt',r.updated_at,'writesEnabled',true),'affectedContacts',affected);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_crm_get_tags(uuid),public.ienvia_crm_mutate_tags(integer,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_crm_get_tags(uuid),public.ienvia_crm_mutate_tags(integer,text,jsonb) TO authenticated;

-- 5. 20261104009000: projeção de ficha por thread na mesma página.
--    A versão do arquivo dependia de ORDER BY em agregado; aqui a página é ordenada em CTE
--    separada, o que também deixa a consulta estável no plano.
CREATE OR REPLACE FUNCTION public.ienvia_list_instance_threads_crm(p_owner uuid,p_instance uuid,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 30,p_visibility text DEFAULT 'visible') RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE items jsonb; more boolean; next_id uuid;
BEGIN
 PERFORM public.ienvia_get_instance_execution(p_owner,p_instance);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_visibility IS NULL OR p_visibility NOT IN ('visible','hidden','all') THEN RAISE EXCEPTION 'Filtros inválidos' USING ERRCODE='22023'; END IF;
 IF p_after IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.ienvia_instance_messages m JOIN public.ienvia_instance_message_origins o ON o.owner_id=m.owner_id AND o.message_id=m.id WHERE m.owner_id=p_owner AND m.thread_id=p_after AND o.instance_id=p_instance) THEN RAISE EXCEPTION 'Cursor de outra origem' USING ERRCODE='22023'; END IF;
 WITH batch AS (
  SELECT t.id FROM public.ienvia_instance_threads t WHERE t.owner_id=p_owner AND (p_after IS NULL OR t.id>p_after) AND EXISTS(
   SELECT 1 FROM public.ienvia_instance_messages m JOIN public.ienvia_instance_message_origins o ON o.owner_id=m.owner_id AND o.message_id=m.id JOIN public.ienvia_channels c ON c.owner_id=o.owner_id AND c.id=o.instance_id
   WHERE m.owner_id=p_owner AND m.thread_id=t.id AND o.instance_id=p_instance AND (p_visibility='all' OR c.crm_visible=(p_visibility='visible')))
  ORDER BY t.id LIMIT p_limit+1
 ), page AS (SELECT t.* FROM public.ienvia_instance_threads t JOIN batch b ON b.id=t.id), ordered AS (SELECT * FROM page ORDER BY id LIMIT p_limit)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'selfJid',p.self_jid,'peerJid',p.peer_jid,'identityKind',CASE WHEN p.peer_scope='pn' THEN 'verified_pn' ELSE 'provisional_lid' END,'createdAt',p.created_at,'crmContact',CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('ownerId',c.owner_id,'id',c.id,'threadId',c.thread_id,'source','canonical_thread','identityKind',CASE WHEN p.peer_scope='pn' THEN 'verified_pn' ELSE 'provisional_lid' END,'selfJid',p.self_jid,'peerJid',p.peer_jid,'phone',CASE WHEN p.peer_scope='pn' THEN '+'||split_part(p.peer_jid,'@',1) ELSE NULL END,'revision',c.revision,'profile',jsonb_build_object('docNumber','')||c.profile,'createdAt',c.created_at,'updatedAt',c.updated_at) END) ORDER BY p.id),'[]'::jsonb),(SELECT count(*)>p_limit FROM batch),(SELECT id FROM ordered ORDER BY id DESC LIMIT 1) INTO items,more,next_id FROM ordered p LEFT JOIN public.ienvia_crm_contacts c ON c.owner_id=p.owner_id AND c.thread_id=p.id;
 RETURN jsonb_build_object('ownerId',p_owner,'instanceId',p_instance,'crmProjection','saved_profiles_by_thread_v1','items',items,'hasMore',more,'nextCursor',CASE WHEN more THEN next_id ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_list_instance_threads_crm(uuid,uuid,uuid,integer,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_list_instance_threads_crm(uuid,uuid,uuid,integer,text) TO authenticated;
