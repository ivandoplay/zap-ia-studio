-- SOMENTE LOCAL. Capability de sessão: não cria socket e não altera auth/slots legados.
CREATE TABLE public.ienvia_instance_session_leases (
 owner_id uuid NOT NULL,
 instance_id uuid NOT NULL,
 executor_id uuid NOT NULL,
 assignment_revision integer NOT NULL CHECK(assignment_revision>0),
 claim_id uuid NOT NULL,
 lease_id uuid NOT NULL DEFAULT gen_random_uuid(),
 self_jid text NOT NULL CHECK(self_jid~'^[1-9][0-9]{7,14}@s[.]whatsapp[.]net$'),
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','expired','released')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '45 seconds'),
 closed_at timestamptz,
 PRIMARY KEY(owner_id,claim_id),
 UNIQUE(owner_id,lease_id),
 FOREIGN KEY(owner_id,instance_id) REFERENCES public.ienvia_channels(owner_id,id),
 FOREIGN KEY(owner_id,executor_id) REFERENCES public.ienvia_instance_executors(owner_id,id)
);
CREATE UNIQUE INDEX instance_session_one_active ON public.ienvia_instance_session_leases(owner_id,instance_id) WHERE state='active';
CREATE INDEX instance_session_executor ON public.ienvia_instance_session_leases(owner_id,executor_id);
ALTER TABLE public.ienvia_instance_session_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_instance_session_leases FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ienvia_claim_instance_session(p_owner uuid,p_instance uuid,p_executor uuid,p_assignment_revision integer,p_claim uuid,p_self_jid text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' SET lock_timeout='2s' AS $$
DECLARE a public.ienvia_instance_assignments; l public.ienvia_instance_session_leases;
BEGIN
 IF public.zapia_is_user_active(p_owner) IS NOT TRUE THEN RAISE EXCEPTION 'Conta indisponível' USING ERRCODE='42501'; END IF;
 IF p_claim IS NULL OR p_self_jid IS NULL OR p_self_jid!~'^[1-9][0-9]{7,14}@s[.]whatsapp[.]net$' THEN RAISE EXCEPTION 'Sessão sem identidade comprovada' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.ienvia_channels WHERE owner_id=p_owner AND id=p_instance AND transport='local_worker' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Instância local não encontrada' USING ERRCODE='P0002'; END IF;
 SELECT * INTO a FROM public.ienvia_instance_assignments WHERE owner_id=p_owner AND instance_id=p_instance FOR SHARE;
 IF a.executor_id IS DISTINCT FROM p_executor OR a.revision IS DISTINCT FROM p_assignment_revision OR a.enabled IS NOT TRUE OR NOT EXISTS(SELECT 1 FROM public.ienvia_instance_executors WHERE owner_id=p_owner AND id=p_executor AND transport='local_worker' AND enabled) THEN RAISE EXCEPTION 'Executor mudou' USING ERRCODE='40001'; END IF;
 SELECT * INTO l FROM public.ienvia_instance_session_leases WHERE owner_id=p_owner AND claim_id=p_claim;
 IF FOUND THEN
  IF l.instance_id IS DISTINCT FROM p_instance OR l.executor_id IS DISTINCT FROM p_executor OR l.assignment_revision IS DISTINCT FROM p_assignment_revision OR l.self_jid IS DISTINCT FROM p_self_jid THEN RAISE EXCEPTION 'Claim reutilizado' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('claimed',false,'leaseId',NULL,'state',l.state);
 END IF;
 IF EXISTS(SELECT 1 FROM public.ienvia_instance_dispatches WHERE owner_id=p_owner AND instance_id=p_instance AND state IN ('reserved','started','uncertain')) THEN RAISE EXCEPTION 'Despacho pendente impede takeover' USING ERRCODE='55000'; END IF;
 UPDATE public.ienvia_instance_session_leases SET state='expired',closed_at=expires_at WHERE owner_id=p_owner AND instance_id=p_instance AND state='active' AND expires_at<clock_timestamp();
 IF EXISTS(SELECT 1 FROM public.ienvia_instance_session_leases WHERE owner_id=p_owner AND instance_id=p_instance AND state='active') THEN RAISE EXCEPTION 'Sessão já adquirida' USING ERRCODE='55000'; END IF;
 INSERT INTO public.ienvia_instance_session_leases(owner_id,instance_id,executor_id,assignment_revision,claim_id,self_jid) VALUES(p_owner,p_instance,p_executor,p_assignment_revision,p_claim,p_self_jid) RETURNING * INTO l;
 RETURN jsonb_build_object('claimed',true,'ownerId',l.owner_id,'instanceId',l.instance_id,'executorId',l.executor_id,'assignmentRevision',l.assignment_revision,'leaseId',l.lease_id,'selfJid',l.self_jid,'createdAt',l.created_at,'expiresAt',l.expires_at,'serverNow',clock_timestamp());
END $$;
CREATE FUNCTION public.ienvia_assert_instance_session(p_owner uuid,p_instance uuid,p_executor uuid,p_lease uuid) RETURNS public.ienvia_instance_session_leases
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' SET lock_timeout='2s' AS $$
DECLARE l public.ienvia_instance_session_leases; a public.ienvia_instance_assignments;
BEGIN
 IF public.zapia_is_user_active(p_owner) IS NOT TRUE THEN RAISE EXCEPTION 'Conta indisponível' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.ienvia_channels WHERE owner_id=p_owner AND id=p_instance AND transport='local_worker' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Instância local indisponível' USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM public.ienvia_instance_session_leases WHERE owner_id=p_owner AND instance_id=p_instance AND executor_id=p_executor AND lease_id=p_lease AND state='active' AND expires_at>clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Capability de sessão indisponível' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.ienvia_instance_assignments WHERE owner_id=p_owner AND instance_id=p_instance FOR SHARE;
 IF a.executor_id IS DISTINCT FROM p_executor OR a.revision IS DISTINCT FROM l.assignment_revision OR a.enabled IS NOT TRUE OR NOT EXISTS(SELECT 1 FROM public.ienvia_instance_executors WHERE owner_id=p_owner AND id=p_executor AND transport='local_worker' AND enabled) THEN RAISE EXCEPTION 'Executor mudou' USING ERRCODE='42501'; END IF;
 RETURN l;
END $$;
CREATE FUNCTION public.ienvia_check_instance_session(p_owner uuid,p_instance uuid,p_executor uuid,p_lease uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' SET lock_timeout='2s' AS $$
DECLARE l public.ienvia_instance_session_leases;
BEGIN
 l:=public.ienvia_assert_instance_session(p_owner,p_instance,p_executor,p_lease);
 RETURN jsonb_build_object('ownerId',l.owner_id,'instanceId',l.instance_id,'executorId',l.executor_id,'leaseId',l.lease_id,'selfJid',l.self_jid,'assignmentRevision',l.assignment_revision,'createdAt',l.created_at,'expiresAt',l.expires_at,'serverNow',clock_timestamp());
END $$;
CREATE FUNCTION public.ienvia_renew_instance_session(p_owner uuid,p_instance uuid,p_executor uuid,p_lease uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' SET lock_timeout='2s' AS $$
BEGIN
 PERFORM 1 FROM public.ienvia_channels WHERE owner_id=p_owner AND id=p_instance FOR UPDATE;
 PERFORM public.ienvia_assert_instance_session(p_owner,p_instance,p_executor,p_lease);
 UPDATE public.ienvia_instance_session_leases SET expires_at=clock_timestamp()+interval '45 seconds' WHERE owner_id=p_owner AND lease_id=p_lease;
 RETURN public.ienvia_check_instance_session(p_owner,p_instance,p_executor,p_lease);
END $$;
CREATE FUNCTION public.ienvia_release_instance_session(p_owner uuid,p_instance uuid,p_executor uuid,p_lease uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' SET lock_timeout='2s' AS $$
DECLARE l public.ienvia_instance_session_leases;
BEGIN
 IF public.zapia_is_user_active(p_owner) IS NOT TRUE THEN RAISE EXCEPTION 'Conta indisponível' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.ienvia_channels WHERE owner_id=p_owner AND id=p_instance FOR UPDATE;
 SELECT * INTO l FROM public.ienvia_instance_session_leases WHERE owner_id=p_owner AND instance_id=p_instance AND executor_id=p_executor AND lease_id=p_lease FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Capability de sessão indisponível' USING ERRCODE='42501'; END IF;
 IF l.state='released' THEN RETURN jsonb_build_object('released',true); END IF;
 IF l.state<>'active' THEN RAISE EXCEPTION 'Lease encerrado' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.ienvia_instance_dispatches WHERE owner_id=p_owner AND instance_id=p_instance AND state IN ('reserved','started','uncertain')) THEN RAISE EXCEPTION 'Despacho pendente impede liberação' USING ERRCODE='55000'; END IF;
 UPDATE public.ienvia_instance_session_leases SET state='released',closed_at=clock_timestamp() WHERE owner_id=p_owner AND lease_id=p_lease;
 RETURN jsonb_build_object('released',true);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_claim_instance_session(uuid,uuid,uuid,integer,uuid,text),public.ienvia_assert_instance_session(uuid,uuid,uuid,uuid),public.ienvia_check_instance_session(uuid,uuid,uuid,uuid),public.ienvia_renew_instance_session(uuid,uuid,uuid,uuid),public.ienvia_release_instance_session(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_claim_instance_session(uuid,uuid,uuid,integer,uuid,text),public.ienvia_check_instance_session(uuid,uuid,uuid,uuid),public.ienvia_renew_instance_session(uuid,uuid,uuid,uuid),public.ienvia_release_instance_session(uuid,uuid,uuid,uuid) TO service_role;
