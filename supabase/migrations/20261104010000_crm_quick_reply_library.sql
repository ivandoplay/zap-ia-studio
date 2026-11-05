-- Preparação LOCAL; não migra business.quickReplies, não cria exemplos nem liga escrita.
BEGIN;
CREATE TABLE public.ienvia_crm_quick_libraries(
 owner_id uuid PRIMARY KEY REFERENCES public.zapia_users(user_id),revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),items jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items)<=200),updated_at timestamptz
);
CREATE TABLE public.ienvia_crm_quick_changes(
 owner_id uuid NOT NULL REFERENCES public.zapia_users(user_id),revision integer NOT NULL,actor_id uuid NOT NULL REFERENCES public.zapia_users(user_id),action text NOT NULL CHECK(action IN ('save','remove')),item_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,revision)
);
ALTER TABLE public.ienvia_crm_quick_libraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ienvia_crm_quick_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_crm_quick_libraries,public.ienvia_crm_quick_changes FROM PUBLIC,anon,authenticated,service_role;
-- Mesmos caracteres de trim do JavaScript; contagem UTF16 evita DTO ilegível após RPC direta.
CREATE FUNCTION public.ienvia_crm_quick_trim(v text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT btrim(v,E' \t\n\r\v\f'||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279))
$$;
CREATE FUNCTION public.ienvia_crm_quick_length(v text) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(sum(CASE WHEN ascii(c)>65535 THEN 2 ELSE 1 END),0)::integer FROM regexp_split_to_table(v,'') AS c
$$;
REVOKE ALL ON FUNCTION public.ienvia_crm_quick_trim(text),public.ienvia_crm_quick_length(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ienvia_crm_get_quick_replies(p_owner uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE r public.ienvia_crm_quick_libraries;
BEGIN
 PERFORM public.ienvia_crm_assert_reader(p_owner);
 SELECT * INTO r FROM public.ienvia_crm_quick_libraries WHERE owner_id=p_owner;
 RETURN jsonb_build_object('ownerId',p_owner,'projection','saved_quick_replies_only_v1','revision',coalesce(r.revision,0),'updatedAt',r.updated_at,'items',coalesce(r.items,'[]'::jsonb),'writesEnabled',public.ienvia_crm_can_write(p_owner));
END $$;
CREATE FUNCTION public.ienvia_crm_mutate_quick_replies(p_revision integer,p_operation text,p_item jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' SET lock_timeout='2s' AS $$
DECLARE u uuid:=auth.uid();r public.ienvia_crm_quick_libraries;item jsonb;existing jsonb;id uuid;shortcut text;title text;body text;pos integer;collision jsonb;
BEGIN
 PERFORM public.ienvia_crm_assert_writer();
 IF p_revision IS NULL OR p_revision<0 OR p_revision>=2147483647 OR p_operation IS NULL OR p_operation NOT IN ('save','remove') OR jsonb_typeof(p_item) IS DISTINCT FROM 'object' OR octet_length(p_item::text)>32768 THEN RAISE EXCEPTION 'Pedido inválido' USING ERRCODE='22023'; END IF;
 IF p_operation='remove' THEN
  IF p_item-ARRAY['id']<>'{}'::jsonb OR jsonb_typeof(p_item->'id') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Remoção inválida' USING ERRCODE='22023'; END IF;
 ELSE
  IF p_item-ARRAY['id','shortcut','title','text']<>'{}'::jsonb OR jsonb_typeof(p_item->'shortcut') IS DISTINCT FROM 'string' OR jsonb_typeof(p_item->'text') IS DISTINCT FROM 'string' OR (p_item?'title' AND jsonb_typeof(p_item->'title') IS DISTINCT FROM 'string') OR public.ienvia_crm_quick_length(p_item->>'shortcut')>80 OR public.ienvia_crm_quick_length(p_item->>'title')>160 OR public.ienvia_crm_quick_length(p_item->>'text')>4000 OR (p_item->>'shortcut')~'[[:cntrl:]]' OR (p_item->>'title')~'[[:cntrl:]]' OR translate(p_item->>'text',E'\t\n\r','')~'[[:cntrl:]]' THEN RAISE EXCEPTION 'Atalho inválido' USING ERRCODE='22023'; END IF;
  shortcut:=public.ienvia_crm_quick_trim(p_item->>'shortcut');body:=public.ienvia_crm_quick_trim(p_item->>'text');
  IF shortcut='' OR body='' THEN RAISE EXCEPTION 'Atalho vazio' USING ERRCODE='22023'; END IF;
  shortcut:=coalesce(nullif(regexp_replace(lower(regexp_replace(shortcut,'^/+','')),'[^a-z0-9_-]','','g'),''),'atalho');title:=coalesce(nullif(public.ienvia_crm_quick_trim(p_item->>'title'),''),shortcut);
 END IF;
 IF p_item?'id' THEN
  IF jsonb_typeof(p_item->'id') IS DISTINCT FROM 'string' OR (p_item->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'ID inválido' USING ERRCODE='22023'; END IF;id:=(p_item->>'id')::uuid;
 END IF;
 INSERT INTO public.ienvia_crm_quick_libraries(owner_id) VALUES(u) ON CONFLICT(owner_id) DO NOTHING;
 SELECT * INTO r FROM public.ienvia_crm_quick_libraries WHERE owner_id=u FOR UPDATE;
 IF r.revision<>p_revision THEN RAISE EXCEPTION 'Biblioteca mudou' USING ERRCODE='40001'; END IF;
 SELECT value,(ordinality-1)::integer INTO existing,pos FROM jsonb_array_elements(r.items) WITH ORDINALITY WHERE CASE WHEN id IS NOT NULL THEN value->>'id'=id::text ELSE value->>'shortcut'=shortcut END;
 IF id IS NOT NULL AND existing IS NULL THEN RAISE EXCEPTION 'Atalho não encontrado' USING ERRCODE='P0002'; END IF;
 IF p_operation='remove' THEN r.items:=r.items-pos;
 ELSE
  SELECT value INTO collision FROM jsonb_array_elements(r.items) WHERE value->>'shortcut'=shortcut AND (existing IS NULL OR value->>'id'<>existing->>'id');
  IF collision IS NOT NULL THEN RAISE EXCEPTION 'Código já usado' USING ERRCODE='40001'; END IF;
  id:=coalesce((existing->>'id')::uuid,gen_random_uuid());item:=jsonb_build_object('id',id,'shortcut',shortcut,'title',title,'text',body);
  IF existing IS NULL THEN
   IF jsonb_array_length(r.items)>=200 THEN RAISE EXCEPTION 'Limite de atalhos' USING ERRCODE='22023'; END IF;r.items:=r.items||jsonb_build_array(item);
  ELSE r.items:=jsonb_set(r.items,ARRAY[pos::text],item);END IF;
 END IF;
 UPDATE public.ienvia_crm_quick_libraries SET items=r.items,revision=r.revision+1,updated_at=now() WHERE owner_id=u RETURNING * INTO r;
 INSERT INTO public.ienvia_crm_quick_changes(owner_id,revision,actor_id,action,item_id) VALUES(u,r.revision,u,p_operation,id);
 RETURN jsonb_build_object('ownerId',u,'projection','saved_quick_replies_only_v1','revision',r.revision,'updatedAt',r.updated_at,'items',r.items,'writesEnabled',true);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_crm_get_quick_replies(uuid),public.ienvia_crm_mutate_quick_replies(integer,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_crm_get_quick_replies(uuid),public.ienvia_crm_mutate_quick_replies(integer,text,jsonb) TO authenticated;
COMMIT;
