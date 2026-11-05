-- SOMENTE LOCAL. Depende das migrações de canais e da ponte legada anteriores.
-- Catálogo/ledger novos; nenhuma fila, sessão, campanha ou mensagem legada é alterada.
CREATE TABLE public.ienvia_instance_executors (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES public.zapia_users(user_id),
 transport text NOT NULL CHECK(transport IN ('local_worker','evolution_api')),
 enabled boolean NOT NULL DEFAULT false,
 protocol_version integer NOT NULL DEFAULT 1 CHECK(protocol_version=1),
 UNIQUE(owner_id,id)
);
CREATE TABLE public.ienvia_instance_assignments (
 owner_id uuid NOT NULL,
 instance_id uuid NOT NULL,
 executor_id uuid NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,instance_id),
 FOREIGN KEY(owner_id,instance_id) REFERENCES public.ienvia_channels(owner_id,id),
 FOREIGN KEY(owner_id,executor_id) REFERENCES public.ienvia_instance_executors(owner_id,id)
);
CREATE INDEX instance_assignments_executor ON public.ienvia_instance_assignments(owner_id,executor_id,instance_id);
CREATE TABLE public.ienvia_instance_dispatches (
 owner_id uuid NOT NULL,
 request_id uuid NOT NULL,
 instance_id uuid NOT NULL,
 executor_id uuid NOT NULL,
 digest text NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),
 purpose text NOT NULL CHECK(purpose IN ('manual','ai','campaign')),
 policy_revision integer NOT NULL CHECK(policy_revision>0),
 assignment_revision integer NOT NULL CHECK(assignment_revision>0),
 ticket uuid NOT NULL DEFAULT gen_random_uuid(),
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','started','accepted','uncertain','not_started')),
 reserved_until timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '30 seconds'),
 provider_message_id text,
 started_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,request_id),
 FOREIGN KEY(owner_id,instance_id) REFERENCES public.ienvia_channels(owner_id,id),
 FOREIGN KEY(owner_id,executor_id) REFERENCES public.ienvia_instance_executors(owner_id,id)
);
-- Incerteza não expira para reenvio: quarentena também vale entre processos/reinícios.
CREATE UNIQUE INDEX instance_one_unresolved_dispatch ON public.ienvia_instance_dispatches(owner_id,instance_id) WHERE state IN ('reserved','started','uncertain');
ALTER TABLE public.ienvia_instance_executors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ienvia_instance_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ienvia_instance_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_instance_executors,public.ienvia_instance_assignments,public.ienvia_instance_dispatches FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ienvia_instance_executors,public.ienvia_instance_assignments TO authenticated;
CREATE POLICY instance_executors_self_read ON public.ienvia_instance_executors FOR SELECT TO authenticated USING(owner_id=(SELECT auth.uid()) AND public.zapia_is_user_active((SELECT auth.uid())));
CREATE POLICY instance_assignments_self_read ON public.ienvia_instance_assignments FOR SELECT TO authenticated USING(owner_id=(SELECT auth.uid()) AND public.zapia_is_user_active((SELECT auth.uid())));

CREATE FUNCTION public.ienvia_register_instance_executor(p_owner uuid,p_executor uuid,p_transport text,p_enabled boolean) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
BEGIN
 IF p_owner IS NULL OR public.zapia_is_user_active(p_owner) IS NOT TRUE THEN RAISE EXCEPTION 'Conta indisponível' USING ERRCODE='42501'; END IF;
 IF p_executor IS NULL OR p_enabled IS NULL OR p_transport IS NULL OR p_transport NOT IN ('local_worker','evolution_api') THEN RAISE EXCEPTION 'Executor inválido' USING ERRCODE='22023'; END IF;
 INSERT INTO public.ienvia_instance_executors(id,owner_id,transport,enabled) VALUES(p_executor,p_owner,p_transport,p_enabled)
 ON CONFLICT(id) DO UPDATE SET enabled=EXCLUDED.enabled WHERE public.ienvia_instance_executors.owner_id=p_owner AND public.ienvia_instance_executors.transport=p_transport;
 IF NOT FOUND THEN RAISE EXCEPTION 'Identidade de executor conflitante' USING ERRCODE='40001'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.ienvia_register_instance_executor(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_register_instance_executor(uuid,uuid,text,boolean) TO service_role;

CREATE FUNCTION public.ienvia_assign_instance_executor(p_instance uuid,p_executor uuid,p_revision integer,p_enabled boolean DEFAULT false) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE u uuid:=auth.uid(); c public.ienvia_channels; a public.ienvia_instance_assignments; e public.ienvia_instance_executors;
BEGIN
 IF u IS NULL OR public.zapia_is_user_active(u) IS NOT TRUE THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF p_revision IS NULL OR p_revision<0 OR p_enabled IS NULL THEN RAISE EXCEPTION 'Revisão/configuração inválida' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM public.ienvia_channels WHERE owner_id=u AND id=p_instance FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Instância não encontrada' USING ERRCODE='P0002'; END IF;
 SELECT * INTO a FROM public.ienvia_instance_assignments WHERE owner_id=u AND instance_id=p_instance FOR UPDATE;
 IF coalesce(a.revision,0)<>p_revision THEN RAISE EXCEPTION 'Vínculo mudou' USING ERRCODE='40001'; END IF;
 SELECT * INTO e FROM public.ienvia_instance_executors WHERE owner_id=u AND id=p_executor FOR SHARE;
 IF NOT FOUND OR e.transport<>c.transport THEN RAISE EXCEPTION 'Executor incompatível' USING ERRCODE='22023'; END IF;
 UPDATE public.ienvia_instance_dispatches SET state='not_started',updated_at=clock_timestamp() WHERE owner_id=u AND instance_id=p_instance AND state='reserved' AND reserved_until<clock_timestamp();
 IF EXISTS(SELECT 1 FROM public.ienvia_instance_dispatches WHERE owner_id=u AND instance_id=p_instance AND state IN ('reserved','started','uncertain')) THEN RAISE EXCEPTION 'Instância ocupada ou em quarentena' USING ERRCODE='55000'; END IF;
 INSERT INTO public.ienvia_instance_assignments(owner_id,instance_id,executor_id,revision,enabled) VALUES(u,p_instance,p_executor,1,p_enabled)
 ON CONFLICT(owner_id,instance_id) DO UPDATE SET executor_id=p_executor,revision=public.ienvia_instance_assignments.revision+1,enabled=p_enabled,updated_at=clock_timestamp() RETURNING * INTO a;
 RETURN jsonb_build_object('instanceId',a.instance_id,'executorId',a.executor_id,'revision',a.revision,'enabled',a.enabled);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_assign_instance_executor(uuid,uuid,integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ienvia_assign_instance_executor(uuid,uuid,integer,boolean) TO authenticated;

CREATE FUNCTION public.ienvia_executor_snapshot(p_owner uuid,p_instance uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE c public.ienvia_channels; a public.ienvia_instance_assignments; e public.ienvia_instance_executors;
BEGIN
 IF p_owner IS NULL OR public.zapia_is_user_active(p_owner) IS NOT TRUE THEN RAISE EXCEPTION 'Conta indisponível' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.ienvia_channels WHERE owner_id=p_owner AND id=p_instance;
 IF NOT FOUND THEN RAISE EXCEPTION 'Instância não encontrada' USING ERRCODE='P0002'; END IF;
 SELECT * INTO a FROM public.ienvia_instance_assignments WHERE owner_id=p_owner AND instance_id=p_instance;
 SELECT * INTO e FROM public.ienvia_instance_executors WHERE owner_id=p_owner AND id=a.executor_id;
 RETURN jsonb_build_object('ownerId',p_owner,'instance',public.ienvia_channel_dto(c),'assignment',CASE WHEN a.instance_id IS NULL THEN NULL ELSE jsonb_build_object('ownerId',a.owner_id,'instanceId',a.instance_id,'executorId',a.executor_id,'executorOwnerId',e.owner_id,'executorTransport',e.transport,'revision',a.revision,'enabled',a.enabled,'executorEnabled',e.enabled,'protocolVersion',e.protocol_version) END);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_executor_snapshot(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_executor_snapshot(uuid,uuid) TO service_role;

CREATE FUNCTION public.ienvia_get_instance_execution(p_owner uuid,p_instance uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE u uuid:=auth.uid();
BEGIN
 IF u IS NULL OR public.zapia_is_user_active(u) IS NOT TRUE THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF u<>p_owner AND NOT EXISTS(SELECT 1 FROM public.zapia_users WHERE user_id=u AND is_active AND role='master') THEN RAISE EXCEPTION 'Conta não autorizada' USING ERRCODE='42501'; END IF;
 RETURN public.ienvia_executor_snapshot(p_owner,p_instance);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_get_instance_execution(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ienvia_get_instance_execution(uuid,uuid) TO authenticated;

CREATE FUNCTION public.ienvia_dispatch_receipt(d public.ienvia_instance_dispatches,p_claimed boolean) RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT jsonb_build_object('ownerId',d.owner_id,'instanceId',d.instance_id,'executorId',d.executor_id,'requestId',d.request_id,'digest',d.digest,'state',d.state,'claimed',p_claimed,'ticket',CASE WHEN p_claimed THEN d.ticket ELSE NULL END) $$;
REVOKE ALL ON FUNCTION public.ienvia_dispatch_receipt(public.ienvia_instance_dispatches,boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.ienvia_reserve_instance_dispatch(p_owner uuid,p_instance uuid,p_executor uuid,p_request uuid,p_digest text,p_policy_revision integer,p_assignment_revision integer,p_purpose text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE c public.ienvia_channels; a public.ienvia_instance_assignments; e public.ienvia_instance_executors; d public.ienvia_instance_dispatches;
BEGIN
 IF p_owner IS NULL OR public.zapia_is_user_active(p_owner) IS NOT TRUE THEN RAISE EXCEPTION 'Conta indisponível' USING ERRCODE='42501'; END IF;
 IF p_request IS NULL OR p_digest IS NULL OR p_digest!~'^[a-f0-9]{64}$' OR p_purpose IS NULL OR p_purpose NOT IN ('manual','ai','campaign') THEN RAISE EXCEPTION 'Pedido inválido' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM public.ienvia_channels WHERE owner_id=p_owner AND id=p_instance FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Instância não encontrada' USING ERRCODE='P0002'; END IF;
 SELECT * INTO d FROM public.ienvia_instance_dispatches WHERE owner_id=p_owner AND request_id=p_request FOR UPDATE;
 IF FOUND THEN
  IF d.digest<>p_digest OR d.instance_id<>p_instance OR d.executor_id IS DISTINCT FROM p_executor OR d.purpose IS DISTINCT FROM p_purpose OR d.policy_revision IS DISTINCT FROM p_policy_revision OR d.assignment_revision IS DISTINCT FROM p_assignment_revision THEN RAISE EXCEPTION 'Mesmo pedido com intenção diferente' USING ERRCODE='40001'; END IF;
  RETURN public.ienvia_dispatch_receipt(d,false);
 END IF;
 SELECT * INTO a FROM public.ienvia_instance_assignments WHERE owner_id=p_owner AND instance_id=p_instance FOR SHARE;
 SELECT * INTO e FROM public.ienvia_instance_executors WHERE owner_id=p_owner AND id=p_executor FOR SHARE;
 IF a.instance_id IS NULL OR a.executor_id IS DISTINCT FROM p_executor OR e.id IS NULL OR a.enabled IS NOT TRUE OR e.enabled IS NOT TRUE OR e.transport<>c.transport THEN RAISE EXCEPTION 'Executor indisponível/incompatível' USING ERRCODE='55000'; END IF;
 IF p_policy_revision IS DISTINCT FROM c.revision OR p_assignment_revision IS DISTINCT FROM a.revision THEN RAISE EXCEPTION 'Configuração mudou' USING ERRCODE='40001'; END IF;
 IF (p_purpose='ai' AND NOT c.ai_enabled) OR (p_purpose='campaign' AND NOT c.campaigns_enabled) THEN RAISE EXCEPTION 'Finalidade desativada' USING ERRCODE='42501'; END IF;
 IF p_purpose<>'manual' THEN RAISE EXCEPTION 'Coordenador de automação ainda não integrado' USING ERRCODE='0A000'; END IF;
 UPDATE public.ienvia_instance_dispatches SET state='not_started',updated_at=clock_timestamp() WHERE owner_id=p_owner AND instance_id=p_instance AND state='reserved' AND reserved_until<clock_timestamp();
 IF EXISTS(SELECT 1 FROM public.ienvia_instance_dispatches WHERE owner_id=p_owner AND instance_id=p_instance AND state IN ('reserved','started','uncertain')) THEN RAISE EXCEPTION 'Instância ocupada/quarentena' USING ERRCODE='55000'; END IF;
 INSERT INTO public.ienvia_instance_dispatches(owner_id,request_id,instance_id,executor_id,digest,purpose,policy_revision,assignment_revision) VALUES(p_owner,p_request,p_instance,p_executor,p_digest,p_purpose,p_policy_revision,p_assignment_revision) RETURNING * INTO d;
 RETURN public.ienvia_dispatch_receipt(d,true);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_reserve_instance_dispatch(uuid,uuid,uuid,uuid,text,integer,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_reserve_instance_dispatch(uuid,uuid,uuid,uuid,text,integer,integer,text) TO service_role;

CREATE FUNCTION public.ienvia_start_instance_dispatch(p_owner uuid,p_instance uuid,p_executor uuid,p_request uuid,p_ticket uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE c public.ienvia_channels; a public.ienvia_instance_assignments; e public.ienvia_instance_executors; d public.ienvia_instance_dispatches;
BEGIN
 IF public.zapia_is_user_active(p_owner) IS NOT TRUE THEN RAISE EXCEPTION 'Conta indisponível' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.ienvia_channels WHERE owner_id=p_owner AND id=p_instance FOR UPDATE;
 SELECT * INTO a FROM public.ienvia_instance_assignments WHERE owner_id=p_owner AND instance_id=p_instance FOR SHARE;
 SELECT * INTO e FROM public.ienvia_instance_executors WHERE owner_id=p_owner AND id=p_executor FOR SHARE;
 SELECT * INTO d FROM public.ienvia_instance_dispatches WHERE owner_id=p_owner AND request_id=p_request AND instance_id=p_instance AND executor_id=p_executor AND ticket=p_ticket FOR UPDATE;
 IF NOT FOUND OR d.state<>'reserved' OR d.reserved_until<clock_timestamp() THEN RAISE EXCEPTION 'Reserva não iniciável' USING ERRCODE='55000'; END IF;
 IF c.id IS NULL OR a.instance_id IS NULL OR e.id IS NULL OR a.executor_id IS DISTINCT FROM p_executor OR a.enabled IS NOT TRUE OR e.enabled IS NOT TRUE OR e.transport<>c.transport OR d.policy_revision<>c.revision OR d.assignment_revision<>a.revision THEN RAISE EXCEPTION 'Contexto mudou' USING ERRCODE='40001'; END IF;
 IF (d.purpose='ai' AND NOT c.ai_enabled) OR (d.purpose='campaign' AND NOT c.campaigns_enabled) THEN RAISE EXCEPTION 'Finalidade desativada' USING ERRCODE='42501'; END IF;
 IF d.purpose<>'manual' THEN RAISE EXCEPTION 'Coordenador de automação ainda não integrado' USING ERRCODE='0A000'; END IF;
 UPDATE public.ienvia_instance_dispatches SET state='started',started_at=clock_timestamp(),updated_at=clock_timestamp() WHERE owner_id=p_owner AND request_id=p_request;
 RETURN jsonb_build_object('started',true);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_start_instance_dispatch(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_start_instance_dispatch(uuid,uuid,uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.ienvia_finish_instance_dispatch(p_owner uuid,p_instance uuid,p_executor uuid,p_request uuid,p_ticket uuid,p_state text,p_provider_message_id text DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE d public.ienvia_instance_dispatches;
BEGIN
 IF p_state IS NULL OR p_state NOT IN ('accepted','uncertain') OR (p_state='accepted' AND (p_provider_message_id IS NULL OR length(p_provider_message_id) NOT BETWEEN 1 AND 128 OR p_provider_message_id~'[[:cntrl:]]')) THEN RAISE EXCEPTION 'Conclusão inválida' USING ERRCODE='22023'; END IF;
 SELECT * INTO d FROM public.ienvia_instance_dispatches WHERE owner_id=p_owner AND request_id=p_request AND instance_id=p_instance AND executor_id=p_executor AND ticket=p_ticket FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reserva não encontrada' USING ERRCODE='P0002'; END IF;
 IF d.state='accepted' THEN RETURN jsonb_build_object('state','accepted'); END IF;
 IF d.state='not_started' OR (d.started_at IS NULL AND p_state='accepted') THEN RAISE EXCEPTION 'Transição inválida' USING ERRCODE='55000'; END IF;
 UPDATE public.ienvia_instance_dispatches SET state=p_state,provider_message_id=CASE WHEN p_state='accepted' THEN p_provider_message_id ELSE NULL END,updated_at=clock_timestamp() WHERE owner_id=p_owner AND request_id=p_request;
 RETURN jsonb_build_object('state',p_state);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_finish_instance_dispatch(uuid,uuid,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_finish_instance_dispatch(uuid,uuid,uuid,uuid,uuid,text,text) TO service_role;
