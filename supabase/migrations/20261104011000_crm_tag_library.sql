-- LOCAL: biblioteca de etiquetas; não executada remotamente, sem backfill/gates novos.
BEGIN;
-- Apenas amplia24→32 para compatibilidade com nomes do original; não regrava perfis.
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
CREATE TABLE public.ienvia_crm_tag_libraries(owner_id uuid PRIMARY KEY REFERENCES public.zapia_users(user_id),revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),items jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items)<=200),updated_at timestamptz);
CREATE TABLE public.ienvia_crm_tag_changes(owner_id uuid NOT NULL REFERENCES public.zapia_users(user_id),revision integer NOT NULL,actor_id uuid NOT NULL REFERENCES public.zapia_users(user_id),action text NOT NULL CHECK(action IN ('save','remove')),item_id uuid NOT NULL,affected_count integer NOT NULL CHECK(affected_count BETWEEN 0 AND 500),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,revision));
ALTER TABLE public.ienvia_crm_tag_libraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ienvia_crm_tag_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_crm_tag_libraries,public.ienvia_crm_tag_changes FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ienvia_crm_get_tags(p_owner uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE r public.ienvia_crm_tag_libraries;
BEGIN
 PERFORM public.ienvia_crm_assert_reader(p_owner);SELECT * INTO r FROM public.ienvia_crm_tag_libraries WHERE owner_id=p_owner;
 RETURN jsonb_build_object('ownerId',p_owner,'projection','saved_tag_library_v1','revision',coalesce(r.revision,0),'items',coalesce(r.items,'[]'::jsonb),'updatedAt',r.updated_at,'writesEnabled',public.ienvia_crm_can_write(p_owner));
END $$;
CREATE FUNCTION public.ienvia_crm_mutate_tags(p_revision integer,p_operation text,p_item jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' SET lock_timeout='2s' AS $$
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
 -- Propaga exatamente o nome antigo nas fichas salvas próprias, como no storage original.
 -- Locks ordenados + CAS de cada ficha; qualquer erro reverte biblioteca, fichas e auditoria.
 IF existing IS NOT NULL AND (p_operation='remove' OR old_name IS DISTINCT FROM name) THEN
  FOR c IN SELECT * FROM public.ienvia_crm_contacts WHERE owner_id=u AND profile->'tags' ? old_name ORDER BY id LIMIT 501 FOR UPDATE LOOP
   affected:=affected+1;IF affected>500 THEN RAISE EXCEPTION 'Cascata excede limite seguro' USING ERRCODE='54000'; END IF;
   IF p_operation='remove' THEN SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb) INTO tags FROM jsonb_array_elements(c.profile->'tags') WITH ORDINALITY WHERE value<>to_jsonb(old_name);
   ELSE SELECT coalesce(jsonb_agg(value ORDER BY first_pos),'[]'::jsonb) INTO tags FROM (SELECT CASE WHEN value=to_jsonb(old_name) THEN to_jsonb(name) ELSE value END AS value,min(ordinality) AS first_pos FROM jsonb_array_elements(c.profile->'tags') WITH ORDINALITY GROUP BY CASE WHEN value=to_jsonb(old_name) THEN to_jsonb(name) ELSE value END) dedup;END IF;
   PERFORM public.ienvia_crm_apply_profile(c,c.revision,jsonb_build_object('tags',tags));
  END LOOP;
 END IF;
 UPDATE public.ienvia_crm_tag_libraries SET items=r.items,revision=r.revision+1,updated_at=clock_timestamp() WHERE owner_id=u RETURNING * INTO r;
 INSERT INTO public.ienvia_crm_tag_changes(owner_id,revision,actor_id,action,item_id,affected_count) VALUES(u,r.revision,u,p_operation,id,affected);
 RETURN jsonb_build_object('library',jsonb_build_object('ownerId',u,'projection','saved_tag_library_v1','revision',r.revision,'items',r.items,'updatedAt',r.updated_at,'writesEnabled',true),'affectedContacts',affected);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_crm_get_tags(uuid),public.ienvia_crm_mutate_tags(integer,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_crm_get_tags(uuid),public.ienvia_crm_mutate_tags(integer,text,jsonb) TO authenticated;
COMMIT;
