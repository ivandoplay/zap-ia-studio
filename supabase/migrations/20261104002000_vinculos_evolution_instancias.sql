-- SOMENTE LOCAL. Mapa explícito configurado pelo serviço, não por nome digitado no CRM.
CREATE TABLE public.ienvia_instance_evolution_bindings (
 owner_id uuid NOT NULL,
 instance_id uuid NOT NULL,
 executor_id uuid NOT NULL,
 assignment_revision integer NOT NULL CHECK(assignment_revision>0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 provider_namespace_id uuid NOT NULL,
 provider_name text NOT NULL CHECK(provider_name~'^[A-Za-z0-9][A-Za-z0-9_.-]{0,149}$'),
 provider_id text NOT NULL CHECK(provider_id~'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$'),
 PRIMARY KEY(owner_id,instance_id),
 UNIQUE(provider_namespace_id,provider_name),
 UNIQUE(provider_namespace_id,provider_id),
 FOREIGN KEY(owner_id,instance_id) REFERENCES public.ienvia_channels(owner_id,id),
 FOREIGN KEY(owner_id,executor_id) REFERENCES public.ienvia_instance_executors(owner_id,id)
);
ALTER TABLE public.ienvia_instance_evolution_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_instance_evolution_bindings FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ienvia_executor_evolution_binding(p_owner uuid,p_instance uuid,p_executor uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='3s' SET lock_timeout='2s' AS $$
DECLARE b public.ienvia_instance_evolution_bindings; a public.ienvia_instance_assignments;
BEGIN
 IF public.zapia_is_user_active(p_owner) IS NOT TRUE THEN RAISE EXCEPTION 'Conta indisponível' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM public.ienvia_instance_evolution_bindings WHERE owner_id=p_owner AND instance_id=p_instance AND executor_id=p_executor;
 IF NOT FOUND THEN RAISE EXCEPTION 'Vínculo Evolution ausente' USING ERRCODE='P0002'; END IF;
 SELECT * INTO a FROM public.ienvia_instance_assignments WHERE owner_id=p_owner AND instance_id=p_instance;
 IF a.executor_id IS DISTINCT FROM p_executor OR a.revision IS DISTINCT FROM b.assignment_revision OR a.enabled IS NOT TRUE OR NOT EXISTS(SELECT 1 FROM public.ienvia_instance_executors WHERE owner_id=p_owner AND id=p_executor AND transport='evolution_api' AND enabled) OR NOT EXISTS(SELECT 1 FROM public.ienvia_channels WHERE owner_id=p_owner AND id=p_instance AND transport='evolution_api') THEN RAISE EXCEPTION 'Vínculo mudou' USING ERRCODE='40001'; END IF;
 RETURN jsonb_build_object('ownerId',b.owner_id,'instanceId',b.instance_id,'executorId',b.executor_id,'transport','evolution_api','assignmentRevision',b.assignment_revision,'bindingRevision',b.revision,'providerNamespaceId',b.provider_namespace_id,'providerName',b.provider_name,'providerId',b.provider_id);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_executor_evolution_binding(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_executor_evolution_binding(uuid,uuid,uuid) TO service_role;
CREATE FUNCTION public.ienvia_bind_evolution_instance(p_owner uuid,p_instance uuid,p_executor uuid,p_assignment_revision integer,p_binding_revision integer,p_namespace uuid,p_name text,p_provider_id text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' SET lock_timeout='2s' AS $$
DECLARE a public.ienvia_instance_assignments; b public.ienvia_instance_evolution_bindings;
BEGIN
 IF public.zapia_is_user_active(p_owner) IS NOT TRUE THEN RAISE EXCEPTION 'Conta indisponível' USING ERRCODE='42501'; END IF;
 IF p_binding_revision IS NULL OR p_binding_revision<0 OR p_namespace IS NULL OR p_name IS NULL OR p_name!~'^[A-Za-z0-9][A-Za-z0-9_.-]{0,149}$' OR p_provider_id IS NULL OR p_provider_id!~'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$' THEN RAISE EXCEPTION 'Mapa inválido' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.ienvia_channels WHERE owner_id=p_owner AND id=p_instance AND transport='evolution_api' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Instância não encontrada' USING ERRCODE='P0002'; END IF;
 SELECT * INTO a FROM public.ienvia_instance_assignments WHERE owner_id=p_owner AND instance_id=p_instance FOR SHARE;
 IF a.executor_id IS DISTINCT FROM p_executor OR a.revision IS DISTINCT FROM p_assignment_revision OR a.enabled IS NOT TRUE OR NOT EXISTS(SELECT 1 FROM public.ienvia_instance_executors WHERE owner_id=p_owner AND id=p_executor AND transport='evolution_api' AND enabled) THEN RAISE EXCEPTION 'Executor incompatível' USING ERRCODE='40001'; END IF;
 SELECT * INTO b FROM public.ienvia_instance_evolution_bindings WHERE owner_id=p_owner AND instance_id=p_instance FOR UPDATE;
 IF coalesce(b.revision,0)<>p_binding_revision THEN RAISE EXCEPTION 'Mapa mudou' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM public.ienvia_instance_dispatches WHERE owner_id=p_owner AND instance_id=p_instance AND state IN ('reserved','started','uncertain')) THEN RAISE EXCEPTION 'Operação pendente impede trocar vínculo' USING ERRCODE='55000'; END IF;
 INSERT INTO public.ienvia_instance_evolution_bindings(owner_id,instance_id,executor_id,assignment_revision,provider_namespace_id,provider_name,provider_id)
 VALUES(p_owner,p_instance,p_executor,p_assignment_revision,p_namespace,p_name,p_provider_id)
 ON CONFLICT(owner_id,instance_id) DO UPDATE SET executor_id=p_executor,assignment_revision=p_assignment_revision,revision=public.ienvia_instance_evolution_bindings.revision+1,provider_namespace_id=p_namespace,provider_name=p_name,provider_id=p_provider_id;
 RETURN public.ienvia_executor_evolution_binding(p_owner,p_instance,p_executor);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_bind_evolution_instance(uuid,uuid,uuid,integer,integer,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_bind_evolution_instance(uuid,uuid,uuid,integer,integer,uuid,text,text) TO service_role;
