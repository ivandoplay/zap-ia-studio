-- PROPOSTA LOCAL: leitura opt-in, sem aplicação remota/gates de escrita/associação por telefone.
-- Uma página de threads, uma junção por owner_id+thread_id; funções históricas intactas.
BEGIN;

CREATE FUNCTION public.ienvia_list_instance_threads_crm(p_owner uuid,p_instance uuid,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 30,p_visibility text DEFAULT 'visible') RETURNS jsonb
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
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'selfJid',p.self_jid,'peerJid',p.peer_jid,'identityKind',CASE WHEN p.peer_scope='pn' THEN 'verified_pn' ELSE 'provisional_lid' END,'createdAt',p.created_at,'crmContact',CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('ownerId',c.owner_id,'id',c.id,'threadId',c.thread_id,'source','canonical_thread','identityKind',CASE WHEN p.peer_scope='pn' THEN 'verified_pn' ELSE 'provisional_lid' END,'selfJid',p.self_jid,'peerJid',p.peer_jid,'phone',CASE WHEN p.peer_scope='pn' THEN '+'||split_part(p.peer_jid,'@',1) ELSE NULL END,'revision',c.revision,'profile',jsonb_build_object('docNumber','')||c.profile,'createdAt',c.created_at,'updatedAt',c.updated_at) END) ORDER BY p.id),'[]'::jsonb),(SELECT count(*)>p_limit FROM batch),(SELECT id FROM page ORDER BY id DESC LIMIT 1) INTO items,more,next_id FROM page p LEFT JOIN public.ienvia_crm_contacts c ON c.owner_id=p.owner_id AND c.thread_id=p.id;
 RETURN jsonb_build_object('ownerId',p_owner,'instanceId',p_instance,'crmProjection','saved_profiles_by_thread_v1','items',items,'hasMore',more,'nextCursor',CASE WHEN more THEN next_id ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_list_instance_threads_crm(uuid,uuid,uuid,integer,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_list_instance_threads_crm(uuid,uuid,uuid,integer,text) TO authenticated;

COMMIT;
