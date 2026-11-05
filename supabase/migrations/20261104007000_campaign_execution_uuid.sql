-- SOMENTE LOCAL. Coordenador dedicado; não libera purpose=campaign no dispatcher manual.
-- Nenhum opt-in inserido e nenhuma sessão, scheduler ou campanha legada alterada.
CREATE TABLE public.ienvia_campaign_execution_accounts(owner_id uuid PRIMARY KEY REFERENCES public.zapia_users(user_id),enabled boolean NOT NULL DEFAULT false,global_enabled boolean NOT NULL DEFAULT false,coordination_ready boolean NOT NULL DEFAULT false,revision integer NOT NULL DEFAULT 1 CHECK(revision>0));
CREATE TABLE public.ienvia_campaign_runs(
 owner_id uuid NOT NULL,id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),document jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('ativa','pausada','concluida','cancelada')),reason text,
 recipient integer NOT NULL DEFAULT 0,step integer NOT NULL DEFAULT 0,completed integer NOT NULL DEFAULT 0,excluded integer[] NOT NULL DEFAULT '{}',person_instance uuid,
 batch_count integer NOT NULL DEFAULT 0,batch_target integer NOT NULL DEFAULT 1,due_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 pending uuid,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(owner_id,id),
 FOREIGN KEY(owner_id,id) REFERENCES public.ienvia_campaign_drafts(owner_id,id)
);
CREATE TABLE public.ienvia_campaign_lanes(owner_id uuid NOT NULL REFERENCES public.zapia_users(user_id),phone text NOT NULL CHECK(phone~'^[1-9][0-9]{7,14}$'),blocked boolean NOT NULL DEFAULT false,late_request_id uuid,request_id uuid,purpose text CHECK(purpose IN ('ai','campaign')),ticket uuid,PRIMARY KEY(owner_id,phone));
CREATE TABLE public.ienvia_campaign_capabilities(
 owner_id uuid NOT NULL,instance_id uuid NOT NULL,executor_id uuid NOT NULL,token uuid NOT NULL DEFAULT gen_random_uuid(),
 policy_revision integer NOT NULL,assignment_revision integer NOT NULL,lease_id uuid,binding_revision integer,self_jid text NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(owner_id,instance_id),FOREIGN KEY(owner_id,instance_id) REFERENCES public.ienvia_channels(owner_id,id)
);
CREATE TABLE public.ienvia_campaign_attempts(
 owner_id uuid NOT NULL,request_id uuid NOT NULL,run_id uuid NOT NULL,instance_id uuid NOT NULL,executor_id uuid NOT NULL,
 run_revision integer NOT NULL,recipient integer NOT NULL,step integer NOT NULL,phone text NOT NULL,material jsonb NOT NULL,
 provider_message_id text NOT NULL,self_jid text NOT NULL,capability uuid NOT NULL,claimed_at timestamptz,transport_at timestamptz,send_nonce uuid NOT NULL DEFAULT gen_random_uuid(),resolved text,completed_at timestamptz,late_provider_id text,late_at timestamptz,late_reviewed_at timestamptz,
 PRIMARY KEY(owner_id,request_id),FOREIGN KEY(owner_id,run_id) REFERENCES public.ienvia_campaign_runs(owner_id,id),
 FOREIGN KEY(owner_id,request_id) REFERENCES public.ienvia_instance_dispatches(owner_id,request_id)
);
CREATE INDEX campaign_runs_due ON public.ienvia_campaign_runs(owner_id,due_at,id) WHERE status='ativa';
CREATE INDEX campaign_attempts_run ON public.ienvia_campaign_attempts(owner_id,run_id,request_id);
ALTER TABLE public.ienvia_campaign_execution_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ienvia_campaign_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ienvia_campaign_lanes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ienvia_campaign_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ienvia_campaign_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_campaign_execution_accounts,public.ienvia_campaign_runs,public.ienvia_campaign_lanes,public.ienvia_campaign_capabilities,public.ienvia_campaign_attempts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.ienvia_campaign_execution_guard(p_owner uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF public.zapia_is_user_active(p_owner) IS NOT TRUE THEN RAISE EXCEPTION 'Conta indisponível' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.ienvia_campaign_write_accounts WHERE owner_id=p_owner AND enabled FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Escrita desabilitada' USING ERRCODE='55000';END IF;
 PERFORM 1 FROM public.ienvia_campaign_execution_accounts WHERE owner_id=p_owner AND enabled AND global_enabled AND coordination_ready FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Execução não homologada ou pausada globalmente' USING ERRCODE='55000';END IF;
END $$;
CREATE FUNCTION public.ienvia_campaign_window(o jsonb,t timestamptz) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE local_time timestamp;day integer;minute integer;start_min integer;end_min integer;
BEGIN
 IF (o->>'restricao_horaria')::boolean IS NOT TRUE THEN RETURN true;END IF;local_time:=t AT TIME ZONE (o->>'fuso');day:=extract(dow FROM local_time)::integer;minute:=extract(hour FROM local_time)::integer*60+extract(minute FROM local_time)::integer;start_min:=split_part(o->>'inicio',':',1)::integer*60+split_part(o->>'inicio',':',2)::integer;end_min:=split_part(o->>'fim',':',1)::integer*60+split_part(o->>'fim',':',2)::integer;
 IF start_min<end_min THEN RETURN o->'dias' @> to_jsonb(ARRAY[day]) AND minute>=start_min AND minute<end_min;END IF;
 RETURN (o->'dias' @> to_jsonb(ARRAY[day]) AND minute>=start_min) OR (o->'dias' @> to_jsonb(ARRAY[(day+6)%7]) AND minute<end_min);
END $$;
CREATE FUNCTION public.ienvia_campaign_run_dto(r public.ienvia_campaign_runs) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',r.id,'revision',r.revision,'status',r.status,'reason',r.reason,'recipient',r.recipient,'step',r.step,'completed',r.completed,'total',jsonb_array_length(r.document->'destinatarios'),'dueAt',r.due_at,'pending',r.pending,'excluded',cardinality(r.excluded),'excludedIndices',to_jsonb(r.excluded),'plano',r.document->'plano','opcoes',r.document->'opcoes')
$$;
CREATE FUNCTION public.ienvia_campaign_execution_get(p_owner uuid,p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE r public.ienvia_campaign_runs;attempt jsonb;
BEGIN
 PERFORM public.ienvia_campaign_access(p_owner,false);SELECT * INTO r FROM public.ienvia_campaign_runs WHERE owner_id=p_owner AND id=p_id;
 IF r.pending IS NOT NULL THEN SELECT jsonb_build_object('kind','campaign','requestId',a.request_id,'ticket',d.ticket,'recipient',a.recipient,'step',a.step,'instanceId',a.instance_id,'state',d.state,'phone',a.phone,'name',r.document->'destinatarios'->a.recipient->>'nome','recipientId',overlay(overlay(md5(p_id::text||':'||a.phone) placing '5' from 13 for 1) placing '8' from 17 for 1)::uuid,'material',a.material,'claimedAt',a.claimed_at) INTO attempt FROM public.ienvia_campaign_attempts a JOIN public.ienvia_instance_dispatches d USING(owner_id,request_id) WHERE a.owner_id=p_owner AND a.request_id=r.pending;END IF;
 RETURN jsonb_build_object('ownerId',p_owner,'writesEnabled',public.ienvia_campaign_can_write(p_owner),'run',CASE WHEN r.id IS NOT NULL THEN public.ienvia_campaign_run_dto(r) ELSE NULL END,'attempt',attempt,'lateAttempt',CASE WHEN r.id IS NOT NULL THEN public.ienvia_campaign_late_review(r) ELSE NULL END,'aiAttempt',CASE WHEN r.id IS NOT NULL THEN public.ienvia_campaign_ai_review(r) ELSE NULL END);
END $$;
CREATE FUNCTION public.ienvia_campaign_execution_control(p_id uuid,p_revision integer,p_action text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE u uuid:=auth.uid();r public.ienvia_campaign_runs;d public.ienvia_campaign_drafts;o jsonb;
BEGIN
 PERFORM public.ienvia_campaign_access(u,true);
 IF p_revision IS NULL OR p_revision<1 OR p_action IS NULL OR p_action NOT IN ('iniciar','pausar','retomar','pular','cancelar') THEN RAISE EXCEPTION 'Comando inválido' USING ERRCODE='22023';END IF;
 IF p_action IN ('iniciar','retomar','pular') THEN PERFORM public.ienvia_campaign_execution_guard(u);END IF;
 -- Draft lock serializa início, edição e exclusão de destinatários, mesmo entre processos.
 SELECT * INTO d FROM public.ienvia_campaign_drafts WHERE owner_id=u AND id=p_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Campanha ausente' USING ERRCODE='P0002';END IF;
 SELECT * INTO r FROM public.ienvia_campaign_runs WHERE owner_id=u AND id=p_id FOR UPDATE;
 IF p_action='iniciar' THEN
  IF r.id IS NOT NULL OR d.revision<>p_revision THEN RAISE EXCEPTION 'Campanha mudou ou já iniciada' USING ERRCODE='40001';END IF;
  PERFORM public.ienvia_campaign_validate_document(u,d.document);o:=d.document->'opcoes';
  INSERT INTO public.ienvia_campaign_runs(owner_id,id,revision,document,status,batch_target,due_at) VALUES(u,p_id,p_revision+1,d.document,'ativa',floor(random()*((o->>'lote_max')::integer-(o->>'lote_min')::integer+1))::integer+(o->>'lote_min')::integer,greatest(clock_timestamp(),coalesce((o->>'inicio_em')::timestamptz,clock_timestamp()))) RETURNING * INTO r;
 ELSE
  IF r.id IS NULL THEN RAISE EXCEPTION 'Execução ausente' USING ERRCODE='P0002';END IF;IF r.revision<>p_revision THEN RAISE EXCEPTION 'Revisão mudou' USING ERRCODE='40001';END IF;
  IF r.status IN ('concluida','cancelada') THEN RAISE EXCEPTION 'Execução encerrada' USING ERRCODE='55000';END IF;
  IF p_action='retomar' AND (r.status<>'pausada' OR r.pending IS NOT NULL OR public.ienvia_campaign_late_review(r) IS NOT NULL OR public.ienvia_campaign_ai_review(r) IS NOT NULL) THEN RAISE EXCEPTION 'Tentativa pendente impede retomada' USING ERRCODE='55000';END IF;
  IF p_action='pular' AND (r.status<>'ativa' OR r.pending IS NOT NULL) THEN RAISE EXCEPTION 'Não pode pular' USING ERRCODE='55000';END IF;
  UPDATE public.ienvia_campaign_runs SET revision=revision+1,status=CASE p_action WHEN 'pausar' THEN 'pausada' WHEN 'retomar' THEN 'ativa' WHEN 'cancelar' THEN 'cancelada' ELSE status END,reason=CASE p_action WHEN 'pausar' THEN 'manual' WHEN 'cancelar' THEN 'manual' ELSE NULL END,due_at=CASE WHEN p_action='pular' THEN clock_timestamp() WHEN p_action='retomar' THEN greatest(due_at,clock_timestamp()) ELSE due_at END WHERE owner_id=u AND id=p_id RETURNING * INTO r;
 END IF;
 RETURN public.ienvia_campaign_execution_get(u,p_id);
END $$;
CREATE FUNCTION public.ienvia_campaign_freeze_started_draft() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN IF EXISTS(SELECT 1 FROM public.ienvia_campaign_runs WHERE owner_id=OLD.owner_id AND id=OLD.id) THEN RAISE EXCEPTION 'Plano iniciado é imutável; crie outro rascunho' USING ERRCODE='55000';END IF;RETURN NEW;END $$;
CREATE TRIGGER campaign_freeze_started_draft BEFORE UPDATE ON public.ienvia_campaign_drafts FOR EACH ROW EXECUTE FUNCTION public.ienvia_campaign_freeze_started_draft();

CREATE FUNCTION public.ienvia_campaign_heartbeat(p_owner uuid,p_instance uuid,p_executor uuid,p_lease uuid,p_self text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' SET lock_timeout='2s' AS $$
DECLARE c public.ienvia_channels;a public.ienvia_instance_assignments;l public.ienvia_instance_session_leases;b jsonb;cap public.ienvia_campaign_capabilities;
BEGIN
 PERFORM public.ienvia_campaign_execution_guard(p_owner);SELECT * INTO c FROM public.ienvia_channels WHERE owner_id=p_owner AND id=p_instance FOR UPDATE;SELECT * INTO a FROM public.ienvia_instance_assignments WHERE owner_id=p_owner AND instance_id=p_instance FOR SHARE;
 IF c.id IS NULL OR NOT c.campaigns_enabled OR a.executor_id IS DISTINCT FROM p_executor OR a.enabled IS NOT TRUE OR NOT EXISTS(SELECT 1 FROM public.ienvia_instance_executors WHERE owner_id=p_owner AND id=p_executor AND transport=c.transport AND enabled) THEN RAISE EXCEPTION 'Instância não autorizada' USING ERRCODE='42501';END IF;
 IF p_self IS NULL OR p_self!~'^[1-9][0-9]{7,14}@s[.]whatsapp[.]net$' THEN RAISE EXCEPTION 'Identidade não confirmada' USING ERRCODE='22023';END IF;
 IF c.transport='local_worker' THEN l:=public.ienvia_assert_instance_session(p_owner,p_instance,p_executor,p_lease);IF l.self_jid<>p_self THEN RAISE EXCEPTION 'Identidade divergente' USING ERRCODE='42501';END IF;
 ELSE IF p_lease IS NOT NULL THEN RAISE EXCEPTION 'Lease de outro transporte' USING ERRCODE='22023';END IF;b:=public.ienvia_executor_evolution_binding(p_owner,p_instance,p_executor);END IF;
 INSERT INTO public.ienvia_campaign_capabilities(owner_id,instance_id,executor_id,policy_revision,assignment_revision,lease_id,binding_revision,self_jid,expires_at) VALUES(p_owner,p_instance,p_executor,c.revision,a.revision,p_lease,(b->>'bindingRevision')::integer,p_self,clock_timestamp()+interval '15 seconds') ON CONFLICT(owner_id,instance_id) DO UPDATE SET executor_id=p_executor,token=CASE WHEN public.ienvia_campaign_capabilities.executor_id=p_executor AND public.ienvia_campaign_capabilities.policy_revision=c.revision AND public.ienvia_campaign_capabilities.assignment_revision=a.revision AND public.ienvia_campaign_capabilities.lease_id IS NOT DISTINCT FROM p_lease AND public.ienvia_campaign_capabilities.self_jid=p_self AND public.ienvia_campaign_capabilities.binding_revision IS NOT DISTINCT FROM (b->>'bindingRevision')::integer THEN public.ienvia_campaign_capabilities.token ELSE gen_random_uuid() END,policy_revision=c.revision,assignment_revision=a.revision,lease_id=p_lease,binding_revision=(b->>'bindingRevision')::integer,self_jid=p_self,expires_at=clock_timestamp()+interval '15 seconds' RETURNING * INTO cap;
 RETURN jsonb_build_object('ownerId',p_owner,'instanceId',p_instance,'executorId',p_executor,'token',cap.token,'expiresAt',cap.expires_at);
END $$;
CREATE FUNCTION public.ienvia_campaign_assert_capability(p_owner uuid,p_instance uuid,p_executor uuid,p_token uuid) RETURNS public.ienvia_campaign_capabilities LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.ienvia_channels;cap public.ienvia_campaign_capabilities;a public.ienvia_instance_assignments;b jsonb;
BEGIN
 SELECT * INTO c FROM public.ienvia_channels WHERE owner_id=p_owner AND id=p_instance FOR UPDATE;SELECT * INTO cap FROM public.ienvia_campaign_capabilities WHERE owner_id=p_owner AND instance_id=p_instance AND executor_id=p_executor AND token=p_token FOR SHARE;SELECT * INTO a FROM public.ienvia_instance_assignments WHERE owner_id=p_owner AND instance_id=p_instance FOR SHARE;
 IF c.id IS NULL OR cap.token IS NULL OR NOT c.campaigns_enabled OR cap.expires_at<=clock_timestamp() OR c.revision<>cap.policy_revision OR a.revision IS DISTINCT FROM cap.assignment_revision OR a.executor_id IS DISTINCT FROM p_executor OR a.enabled IS NOT TRUE OR NOT EXISTS(SELECT 1 FROM public.ienvia_instance_executors WHERE owner_id=p_owner AND id=p_executor AND transport=c.transport AND enabled) THEN RAISE EXCEPTION 'Capability indisponível ou política mudou' USING ERRCODE='55000';END IF;
 IF c.transport='local_worker' THEN PERFORM public.ienvia_assert_instance_session(p_owner,p_instance,p_executor,cap.lease_id);ELSE b:=public.ienvia_executor_evolution_binding(p_owner,p_instance,p_executor);IF (b->>'bindingRevision')::integer IS DISTINCT FROM cap.binding_revision THEN RAISE EXCEPTION 'Vínculo mudou' USING ERRCODE='40001';END IF;END IF;RETURN cap;
END $$;
CREATE FUNCTION public.ienvia_campaign_work(p_owner uuid,p_id uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE r public.ienvia_campaign_runs;a public.ienvia_campaign_attempts;d public.ienvia_instance_dispatches;peer jsonb;ids jsonb;i uuid;
BEGIN
 PERFORM public.ienvia_campaign_execution_guard(p_owner);SELECT * INTO a FROM public.ienvia_campaign_attempts WHERE owner_id=p_owner AND request_id=p_request;
 IF FOUND THEN IF a.run_id<>p_id THEN RAISE EXCEPTION 'Pedido reutilizado' USING ERRCODE='40001';END IF;SELECT * INTO d FROM public.ienvia_instance_dispatches WHERE owner_id=p_owner AND request_id=p_request;RETURN jsonb_build_object('ownerId',p_owner,'campaignId',p_id,'state',d.state,'duplicate',true);END IF;
 SELECT * INTO r FROM public.ienvia_campaign_runs WHERE owner_id=p_owner AND id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'Execução ausente' USING ERRCODE='P0002';END IF;
 IF r.status<>'ativa' OR r.pending IS NOT NULL THEN RETURN jsonb_build_object('ownerId',p_owner,'campaignId',p_id,'state',CASE WHEN r.pending IS NOT NULL THEN 'pending' ELSE r.status END);END IF;
 IF r.due_at>clock_timestamp() OR NOT public.ienvia_campaign_window(r.document->'opcoes',clock_timestamp()) THEN RETURN jsonb_build_object('ownerId',p_owner,'campaignId',p_id,'state','scheduled','dueAt',r.due_at);END IF;
 peer:=r.document->'destinatarios'->r.recipient;ids:=r.document->'plano'->'instanceIds';i:=coalesce(r.person_instance,(ids->>CASE WHEN r.document->'plano'->>'distribution'='fixo' THEN 0 ELSE r.recipient%jsonb_array_length(ids) END)::uuid);
 RETURN jsonb_build_object('ownerId',p_owner,'campaignId',p_id,'state','ready','revision',r.revision,'recipient',r.recipient,'step',r.step,'instanceId',i,'executorId',(SELECT executor_id FROM public.ienvia_instance_assignments WHERE owner_id=p_owner AND instance_id=i AND enabled),'person',peer,'block',r.document->'plano'->'blocos'->r.step);
END $$;
CREATE FUNCTION public.ienvia_campaign_reserve(p_owner uuid,p_id uuid,p_executor uuid,p_request uuid,p_revision integer,p_token uuid,p_material jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE r public.ienvia_campaign_runs;w jsonb;cap public.ienvia_campaign_capabilities;d public.ienvia_instance_dispatches;peer text;digest text;block jsonb;exists_file integer;
BEGIN
 PERFORM public.ienvia_campaign_execution_guard(p_owner);SELECT * INTO r FROM public.ienvia_campaign_runs WHERE owner_id=p_owner AND id=p_id FOR UPDATE;
 IF r.id IS NULL OR p_request IS NULL OR r.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Execução mudou' USING ERRCODE='40001';END IF;
 w:=public.ienvia_campaign_work(p_owner,p_id,p_request);IF w->>'state'<>'ready' OR w?'duplicate' THEN RAISE EXCEPTION 'Etapa não disponível' USING ERRCODE='55000';END IF;
 cap:=public.ienvia_campaign_assert_capability(p_owner,(w->>'instanceId')::uuid,p_executor,p_token);peer:=w->'person'->>'telefone';block:=w->'block';
 IF EXISTS(SELECT 1 FROM public.ienvia_campaign_capabilities WHERE owner_id=p_owner AND self_jid=peer||'@s.whatsapp.net') OR EXISTS(SELECT 1 FROM public.ienvia_instance_session_leases WHERE owner_id=p_owner AND self_jid=peer||'@s.whatsapp.net') THEN RAISE EXCEPTION 'Destinatário é instância própria' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_material) IS DISTINCT FROM 'object' OR octet_length(p_material::text)>32000 OR p_material->>'tipo' IS DISTINCT FROM block->>'tipo' THEN RAISE EXCEPTION 'Material inválido' USING ERRCODE='22023';END IF;
 IF block->>'tipo'='texto' THEN IF p_material-ARRAY['tipo','texto']<>'{}'::jsonb OR jsonb_typeof(p_material->'texto') IS DISTINCT FROM 'string' OR length(btrim(p_material->>'texto')) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Texto inválido' USING ERRCODE='22023';END IF;
 ELSE
  IF p_material-ARRAY['tipo','arquivoId','pastaId','mime','tamanho','sha256','notaVoz']<>'{}'::jsonb OR p_material->>'pastaId' IS DISTINCT FROM block->>'pastaId' OR jsonb_typeof(p_material->'arquivoId') IS DISTINCT FROM 'string' OR p_material->>'sha256'!~'^[a-f0-9]{64}$' OR (block->>'tipo'='audio' AND p_material->'notaVoz' IS DISTINCT FROM block->'notaVoz') THEN RAISE EXCEPTION 'Mídia inválida' USING ERRCODE='22023';END IF;
  EXECUTE 'SELECT count(*) FROM public.ienvia_campanha_arquivos WHERE owner_id=$1 AND pasta_id=$2 AND arquivo_id=$3 AND tipo=$4 AND mime=$5 AND tamanho=$6 AND sha256=$7 AND NOT excluindo' INTO exists_file USING p_owner,(p_material->>'pastaId')::uuid,(p_material->>'arquivoId')::uuid,p_material->>'tipo',p_material->>'mime',(p_material->>'tamanho')::bigint,p_material->>'sha256';IF exists_file<>1 THEN RAISE EXCEPTION 'Mídia privada indisponível' USING ERRCODE='42501';END IF;
 END IF;
 INSERT INTO public.ienvia_campaign_lanes(owner_id,phone) VALUES(p_owner,peer) ON CONFLICT DO NOTHING;PERFORM 1 FROM public.ienvia_campaign_lanes WHERE owner_id=p_owner AND phone=peer AND NOT blocked AND late_request_id IS NULL AND request_id IS NULL FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Conversa ocupada ou bloqueada' USING ERRCODE='55000';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('campaign',p_id,'recipient',r.recipient,'step',r.step,'material',p_material,'instance',cap.instance_id,'revision',r.revision)::text,'UTF8')),'hex');
 INSERT INTO public.ienvia_instance_dispatches(owner_id,request_id,instance_id,executor_id,digest,purpose,policy_revision,assignment_revision) VALUES(p_owner,p_request,cap.instance_id,p_executor,digest,'campaign',cap.policy_revision,cap.assignment_revision) RETURNING * INTO d;
 INSERT INTO public.ienvia_campaign_attempts(owner_id,request_id,run_id,instance_id,executor_id,run_revision,recipient,step,phone,material,provider_message_id,self_jid,capability) VALUES(p_owner,p_request,p_id,cap.instance_id,p_executor,r.revision,r.recipient,r.step,peer,p_material,upper(replace(p_request::text,'-','')),cap.self_jid,p_token);
 UPDATE public.ienvia_campaign_runs SET pending=p_request,person_instance=cap.instance_id WHERE owner_id=p_owner AND id=p_id;UPDATE public.ienvia_campaign_lanes SET request_id=p_request,purpose='campaign',ticket=d.ticket WHERE owner_id=p_owner AND phone=peer;
 RETURN jsonb_build_object('ownerId',p_owner,'campaignId',p_id,'instanceId',cap.instance_id,'executorId',p_executor,'requestId',p_request,'ticket',d.ticket,'state','reserved','digest',digest);
END $$;
CREATE FUNCTION public.ienvia_campaign_claim_provider(p_owner uuid,p_id uuid,p_executor uuid,p_request uuid,p_ticket uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE r public.ienvia_campaign_runs;a public.ienvia_campaign_attempts;d public.ienvia_instance_dispatches;cap public.ienvia_campaign_capabilities;t uuid;material jsonb;n integer;
BEGIN
 PERFORM public.ienvia_campaign_execution_guard(p_owner);SELECT * INTO r FROM public.ienvia_campaign_runs WHERE owner_id=p_owner AND id=p_id FOR UPDATE;SELECT * INTO a FROM public.ienvia_campaign_attempts WHERE owner_id=p_owner AND request_id=p_request AND run_id=p_id AND executor_id=p_executor;
 IF a.request_id IS NULL OR r.status<>'ativa' OR r.pending IS DISTINCT FROM p_request OR r.revision<>a.run_revision OR r.due_at>clock_timestamp() OR NOT public.ienvia_campaign_window(r.document->'opcoes',clock_timestamp()) THEN RAISE EXCEPTION 'Execução não autorizada' USING ERRCODE='55000';END IF;
 cap:=public.ienvia_campaign_assert_capability(p_owner,a.instance_id,p_executor,a.capability);
 PERFORM 1 FROM public.ienvia_campaign_lanes WHERE owner_id=p_owner AND phone=a.phone AND request_id=p_request AND ticket=p_ticket AND NOT blocked AND late_request_id IS NULL FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Conversa bloqueada ou ocupada' USING ERRCODE='55000';END IF;
 SELECT * INTO d FROM public.ienvia_instance_dispatches WHERE owner_id=p_owner AND request_id=p_request AND executor_id=p_executor AND ticket=p_ticket FOR UPDATE;
 IF d.request_id IS NULL OR d.state<>'reserved' OR d.reserved_until<=clock_timestamp() OR a.claimed_at IS NOT NULL THEN RAISE EXCEPTION 'Intenção já consumida ou expirada' USING ERRCODE='55000';END IF;
 material:=a.material;
 IF material->>'tipo'<>'texto' THEN EXECUTE 'SELECT count(*) FROM (SELECT 1 FROM public.ienvia_campanha_arquivos WHERE owner_id=$1 AND arquivo_id=$2 AND pasta_id=$3 AND sha256=$4 AND NOT excluindo FOR SHARE) locked_file' INTO n USING p_owner,(material->>'arquivoId')::uuid,(material->>'pastaId')::uuid,material->>'sha256';IF n<>1 THEN RAISE EXCEPTION 'Arquivo mudou' USING ERRCODE='55000';END IF;END IF;
 UPDATE public.ienvia_campaign_attempts SET claimed_at=clock_timestamp() WHERE owner_id=p_owner AND request_id=p_request;
 UPDATE public.ienvia_instance_dispatches SET state='started',started_at=clock_timestamp(),updated_at=clock_timestamp() WHERE owner_id=p_owner AND request_id=p_request;
 IF cap.lease_id IS NOT NULL THEN
  t:=public.ienvia_instance_thread_id(p_owner,a.self_jid,a.phone||'@s.whatsapp.net',a.instance_id);
  WITH inserted AS (INSERT INTO public.ienvia_instance_messages(owner_id,thread_id,provider_message_id,from_me,text_body,media_type,has_content,message_at,dispatch_request_id,dispatch_state) VALUES(p_owner,t,a.provider_message_id,true,material->>'texto',CASE WHEN material->>'tipo'='texto' THEN 'text' WHEN material->>'tipo'='imagem' THEN 'image' ELSE 'audio' END,true,clock_timestamp(),p_request,'started') RETURNING id) INSERT INTO public.ienvia_instance_message_origins(owner_id,message_id,instance_id) SELECT p_owner,id,a.instance_id FROM inserted;
 END IF;
 RETURN jsonb_build_object('ownerId',p_owner,'campaignId',p_id,'instanceId',a.instance_id,'executorId',p_executor,'requestId',p_request,'ticket',p_ticket,'recipient',a.phone||'@s.whatsapp.net','material',a.material,'providerMessageId',a.provider_message_id,'state','started','sendNonce',a.send_nonce);
END $$;
CREATE FUNCTION public.ienvia_campaign_finish(p_owner uuid,p_id uuid,p_executor uuid,p_request uuid,p_ticket uuid,p_state text,p_provider_id text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE r public.ienvia_campaign_runs;a public.ienvia_campaign_attempts;d public.ienvia_instance_dispatches;o jsonb;done_person boolean;delay_ms bigint;cap public.ienvia_campaign_capabilities;t uuid;
BEGIN
 IF p_state IS NULL OR p_state NOT IN ('accepted','uncertain') OR (p_state='accepted' AND (p_provider_id IS NULL OR p_provider_id!~'^[!-~]{1,128}$')) THEN RAISE EXCEPTION 'Conclusão inválida' USING ERRCODE='22023';END IF;
 SELECT * INTO r FROM public.ienvia_campaign_runs WHERE owner_id=p_owner AND id=p_id FOR UPDATE;SELECT * INTO a FROM public.ienvia_campaign_attempts WHERE owner_id=p_owner AND request_id=p_request AND run_id=p_id AND executor_id=p_executor;
 IF a.request_id IS NULL THEN RAISE EXCEPTION 'Tentativa ausente' USING ERRCODE='P0002';END IF;
 PERFORM 1 FROM public.ienvia_channels WHERE owner_id=p_owner AND id=a.instance_id FOR UPDATE;
 SELECT * INTO d FROM public.ienvia_instance_dispatches WHERE owner_id=p_owner AND request_id=p_request AND ticket=p_ticket AND executor_id=p_executor FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Ticket inválido' USING ERRCODE='42501';END IF;
 IF a.resolved='nao_enviada' AND p_state='accepted' THEN IF a.late_at IS NOT NULL THEN RETURN jsonb_build_object('ownerId',p_owner,'campaignId',p_id,'state','uncertain','late',true,'duplicate',true);END IF;UPDATE public.ienvia_campaign_attempts SET late_provider_id=p_provider_id,late_at=clock_timestamp() WHERE owner_id=p_owner AND request_id=p_request;UPDATE public.ienvia_campaign_runs SET status=CASE WHEN status IN ('cancelada','concluida') THEN status ELSE 'pausada' END,reason='late_confirmation',revision=revision+1 WHERE owner_id=p_owner AND id=p_id;RETURN jsonb_build_object('ownerId',p_owner,'campaignId',p_id,'state','uncertain','late',true);END IF;
 IF a.resolved IS NOT NULL OR a.completed_at IS NOT NULL THEN RETURN jsonb_build_object('ownerId',p_owner,'campaignId',p_id,'state',d.state,'duplicate',true);END IF;
 IF r.pending IS DISTINCT FROM p_request OR d.state NOT IN ('reserved','started','uncertain') OR p_state='accepted' AND (a.claimed_at IS NULL OR a.transport_at IS NULL) THEN RAISE EXCEPTION 'Etapa não concluível' USING ERRCODE='55000';END IF;
 IF p_state='uncertain' THEN
  IF d.state='uncertain' THEN RETURN jsonb_build_object('ownerId',p_owner,'campaignId',p_id,'state','uncertain');END IF;
  UPDATE public.ienvia_instance_dispatches SET state='uncertain',updated_at=clock_timestamp() WHERE owner_id=p_owner AND request_id=p_request;
  UPDATE public.ienvia_campaign_runs SET status=CASE WHEN status='cancelada' THEN status ELSE 'pausada' END,reason='uncertain',revision=revision+1 WHERE owner_id=p_owner AND id=p_id;RETURN jsonb_build_object('ownerId',p_owner,'campaignId',p_id,'state','uncertain');
 END IF;
 IF EXISTS(SELECT 1 FROM public.ienvia_instance_messages WHERE owner_id=p_owner AND dispatch_request_id=p_request AND provider_message_id<>p_provider_id) THEN RAISE EXCEPTION 'Recibo de outra intenção' USING ERRCODE='40001';END IF;
 SELECT * INTO cap FROM public.ienvia_campaign_capabilities WHERE owner_id=p_owner AND instance_id=a.instance_id;
 IF NOT EXISTS(SELECT 1 FROM public.ienvia_instance_messages WHERE owner_id=p_owner AND dispatch_request_id=p_request) THEN
  t:=public.ienvia_instance_thread_id(p_owner,a.self_jid,a.phone||'@s.whatsapp.net',a.instance_id);
  WITH inserted AS (INSERT INTO public.ienvia_instance_messages(owner_id,thread_id,provider_message_id,from_me,text_body,media_type,has_content,message_at,dispatch_request_id,dispatch_state) VALUES(p_owner,t,p_provider_id,true,a.material->>'texto',CASE WHEN a.material->>'tipo'='texto' THEN 'text' WHEN a.material->>'tipo'='imagem' THEN 'image' ELSE 'audio' END,true,clock_timestamp(),p_request,'started') RETURNING id) INSERT INTO public.ienvia_instance_message_origins(owner_id,message_id,instance_id) SELECT p_owner,id,a.instance_id FROM inserted;
 END IF;
 UPDATE public.ienvia_instance_dispatches SET state='accepted',provider_message_id=p_provider_id,updated_at=clock_timestamp() WHERE owner_id=p_owner AND request_id=p_request;
 UPDATE public.ienvia_campaign_attempts SET completed_at=clock_timestamp() WHERE owner_id=p_owner AND request_id=p_request;
 UPDATE public.ienvia_campaign_lanes SET request_id=NULL,purpose=NULL,ticket=NULL WHERE owner_id=p_owner AND phone=a.phone AND request_id=p_request;
 o:=r.document->'opcoes';done_person:=r.step+1>=jsonb_array_length(r.document->'plano'->'blocos');
 IF done_person THEN
  IF r.batch_count+1>=r.batch_target THEN delay_ms:=floor(random()*((o->>'pausa_lote_max_ms')::bigint-(o->>'pausa_lote_min_ms')::bigint+1))::bigint+(o->>'pausa_lote_min_ms')::bigint;
  ELSE delay_ms:=floor(random()*((o->>'intervalo_max_ms')::bigint-(o->>'intervalo_min_ms')::bigint+1))::bigint+(o->>'intervalo_min_ms')::bigint;END IF;
 ELSE delay_ms:=(o->>'intervalo_etapas_ms')::bigint;END IF;
 UPDATE public.ienvia_campaign_runs SET pending=NULL,revision=revision+1,recipient=recipient+CASE WHEN done_person THEN 1 ELSE 0 END,person_instance=CASE WHEN done_person THEN NULL ELSE person_instance END,step=CASE WHEN done_person THEN 0 ELSE step+1 END,completed=completed+CASE WHEN done_person THEN 1 ELSE 0 END,batch_count=CASE WHEN done_person AND batch_count+1>=batch_target THEN 0 WHEN done_person THEN batch_count+1 ELSE batch_count END,batch_target=CASE WHEN done_person AND batch_count+1>=batch_target THEN floor(random()*((o->>'lote_max')::integer-(o->>'lote_min')::integer+1))::integer+(o->>'lote_min')::integer ELSE batch_target END,due_at=clock_timestamp()+delay_ms*interval '1 millisecond',status=CASE WHEN done_person AND recipient+1>=jsonb_array_length(document->'destinatarios') AND status<>'cancelada' THEN 'concluida' ELSE status END WHERE owner_id=p_owner AND id=p_id;
 PERFORM public.ienvia_campaign_skip_excluded(p_owner,p_id);
 RETURN jsonb_build_object('ownerId',p_owner,'campaignId',p_id,'state','accepted');
END $$;
-- Os helpers privados não são capabilities públicas.
REVOKE ALL ON FUNCTION public.ienvia_campaign_execution_guard(uuid),public.ienvia_campaign_window(jsonb,timestamptz),public.ienvia_campaign_run_dto(public.ienvia_campaign_runs),public.ienvia_campaign_freeze_started_draft(),public.ienvia_campaign_assert_capability(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ienvia_campaign_execution_get(uuid,uuid),public.ienvia_campaign_execution_control(uuid,integer,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_campaign_execution_get(uuid,uuid),public.ienvia_campaign_execution_control(uuid,integer,text) TO authenticated;
REVOKE ALL ON FUNCTION public.ienvia_campaign_heartbeat(uuid,uuid,uuid,uuid,text),public.ienvia_campaign_work(uuid,uuid,uuid),public.ienvia_campaign_reserve(uuid,uuid,uuid,uuid,integer,uuid,jsonb),public.ienvia_campaign_claim_provider(uuid,uuid,uuid,uuid,uuid),public.ienvia_campaign_finish(uuid,uuid,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_campaign_heartbeat(uuid,uuid,uuid,uuid,text),public.ienvia_campaign_work(uuid,uuid,uuid),public.ienvia_campaign_reserve(uuid,uuid,uuid,uuid,integer,uuid,jsonb),public.ienvia_campaign_claim_provider(uuid,uuid,uuid,uuid,uuid),public.ienvia_campaign_finish(uuid,uuid,uuid,uuid,uuid,text,text) TO service_role;

CREATE FUNCTION public.ienvia_campaign_execution_fault(p_owner uuid,p_id uuid,p_revision integer,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_reason IS NULL OR p_reason NOT IN ('offline','guard','preparation') THEN RAISE EXCEPTION 'Motivo inválido' USING ERRCODE='22023';END IF;
 UPDATE public.ienvia_campaign_runs SET status='pausada',reason=p_reason,revision=revision+1 WHERE owner_id=p_owner AND id=p_id AND revision=p_revision AND status='ativa' AND pending IS NULL;
 RETURN jsonb_build_object('ownerId',p_owner,'campaignId',p_id,'state','blocked');
END $$;
CREATE FUNCTION public.ienvia_campaign_abort_reserved(p_owner uuid,p_id uuid,p_executor uuid,p_request uuid,p_ticket uuid,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.ienvia_campaign_runs;a public.ienvia_campaign_attempts;d public.ienvia_instance_dispatches;
BEGIN
 SELECT * INTO r FROM public.ienvia_campaign_runs WHERE owner_id=p_owner AND id=p_id FOR UPDATE;SELECT * INTO a FROM public.ienvia_campaign_attempts WHERE owner_id=p_owner AND run_id=p_id AND request_id=p_request AND executor_id=p_executor;
 IF a.request_id IS NULL THEN RAISE EXCEPTION 'Tentativa ausente' USING ERRCODE='P0002';END IF;
 PERFORM 1 FROM public.ienvia_channels WHERE owner_id=p_owner AND id=a.instance_id FOR UPDATE;
 SELECT * INTO d FROM public.ienvia_instance_dispatches WHERE owner_id=p_owner AND request_id=p_request AND ticket=p_ticket FOR UPDATE;
 IF NOT FOUND OR d.state<>'reserved' OR a.claimed_at IS NOT NULL OR r.pending IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'Início não pode ser descartado' USING ERRCODE='55000';END IF;
 UPDATE public.ienvia_instance_dispatches SET state='not_started',updated_at=clock_timestamp() WHERE owner_id=p_owner AND request_id=p_request;
 UPDATE public.ienvia_campaign_attempts SET resolved='not_started' WHERE owner_id=p_owner AND request_id=p_request;
 UPDATE public.ienvia_campaign_lanes SET request_id=NULL,purpose=NULL,ticket=NULL WHERE owner_id=p_owner AND phone=a.phone AND request_id=p_request;
 UPDATE public.ienvia_campaign_runs SET pending=NULL,status=CASE WHEN status='cancelada' THEN status ELSE 'pausada' END,reason='guard',revision=revision+1 WHERE owner_id=p_owner AND id=p_id;
 RETURN jsonb_build_object('ownerId',p_owner,'campaignId',p_id,'state','not_started');
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campaign_execution_fault(uuid,uuid,integer,text),public.ienvia_campaign_abort_reserved(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_campaign_execution_fault(uuid,uuid,integer,text),public.ienvia_campaign_abort_reserved(uuid,uuid,uuid,uuid,uuid,text) TO service_role;

CREATE FUNCTION public.ienvia_campaign_global_control(p_revision integer,p_enabled boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid();g public.ienvia_campaign_execution_accounts;
BEGIN
 PERFORM public.ienvia_campaign_access(u,true);SELECT * INTO g FROM public.ienvia_campaign_execution_accounts WHERE owner_id=u FOR UPDATE;
 IF NOT FOUND OR p_enabled IS NULL OR p_revision IS DISTINCT FROM g.revision THEN RAISE EXCEPTION 'Política mudou' USING ERRCODE='40001';END IF;
 IF p_enabled AND (NOT g.enabled OR NOT g.coordination_ready) THEN RAISE EXCEPTION 'Coordenação não homologada' USING ERRCODE='55000';END IF;
 UPDATE public.ienvia_campaign_execution_accounts SET global_enabled=p_enabled,revision=revision+1 WHERE owner_id=u RETURNING * INTO g;
 RETURN jsonb_build_object('ownerId',u,'revision',g.revision,'enabled',g.global_enabled);
END $$;
CREATE FUNCTION public.ienvia_campaign_conversation_control(p_phone text,p_blocked boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid();
BEGIN
 PERFORM public.ienvia_campaign_access(u,true);IF p_phone IS NULL OR p_phone!~'^[1-9][0-9]{7,14}$' OR p_blocked IS NULL THEN RAISE EXCEPTION 'Conversa inválida' USING ERRCODE='22023';END IF;
 -- Controle manual explícito, nunca chamado em resposta a palavras/mensagens recebidas.
 INSERT INTO public.ienvia_campaign_lanes(owner_id,phone,blocked) VALUES(u,p_phone,p_blocked) ON CONFLICT(owner_id,phone) DO UPDATE SET blocked=p_blocked;
 RETURN jsonb_build_object('ownerId',u,'phone',p_phone,'blocked',p_blocked);
END $$;
CREATE TABLE public.ienvia_campaign_ai_claims(owner_id uuid NOT NULL,request_id uuid NOT NULL,phone text NOT NULL,ticket uuid NOT NULL DEFAULT gen_random_uuid(),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),resolved text,late_accepted boolean NOT NULL DEFAULT false,transport_at timestamptz,state text NOT NULL DEFAULT 'started' CHECK(state IN ('started','accepted','not_started','uncertain')),PRIMARY KEY(owner_id,request_id),FOREIGN KEY(owner_id,phone) REFERENCES public.ienvia_campaign_lanes(owner_id,phone));
ALTER TABLE public.ienvia_campaign_ai_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_campaign_ai_claims FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ienvia_campaign_ai_claim(p_owner uuid,p_request uuid,p_phone text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.ienvia_campaign_ai_claims;
BEGIN
 PERFORM public.ienvia_campaign_ai_guard(p_owner);IF p_request IS NULL OR p_phone IS NULL OR p_phone!~'^[1-9][0-9]{7,14}$' THEN RAISE EXCEPTION 'Conversa inválida' USING ERRCODE='22023';END IF;
 PERFORM public.ienvia_campaign_ai_recover(p_owner,p_phone);
 INSERT INTO public.ienvia_campaign_lanes(owner_id,phone) VALUES(p_owner,p_phone) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM public.ienvia_campaign_lanes WHERE owner_id=p_owner AND phone=p_phone FOR UPDATE;
 SELECT * INTO a FROM public.ienvia_campaign_ai_claims WHERE owner_id=p_owner AND request_id=p_request;
 IF FOUND THEN IF a.phone<>p_phone THEN RAISE EXCEPTION 'Pedido reutilizado' USING ERRCODE='40001';END IF;RETURN jsonb_build_object('ownerId',p_owner,'claimed',false,'state',a.state);END IF;
 IF EXISTS(SELECT 1 FROM public.ienvia_campaign_lanes WHERE owner_id=p_owner AND phone=p_phone AND (blocked OR late_request_id IS NOT NULL OR request_id IS NOT NULL)) THEN RAISE EXCEPTION 'Conversa ocupada' USING ERRCODE='55000';END IF;
 INSERT INTO public.ienvia_campaign_ai_claims(owner_id,request_id,phone) VALUES(p_owner,p_request,p_phone) RETURNING * INTO a;
 UPDATE public.ienvia_campaign_lanes SET request_id=p_request,ticket=a.ticket,purpose='ai' WHERE owner_id=p_owner AND phone=p_phone;
 RETURN jsonb_build_object('ownerId',p_owner,'claimed',true,'requestId',p_request,'ticket',a.ticket);
END $$;
CREATE FUNCTION public.ienvia_campaign_ai_finish(p_owner uuid,p_request uuid,p_ticket uuid,p_state text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.ienvia_campaign_ai_claims;
BEGIN
 IF p_state IS NULL OR p_state NOT IN ('accepted','not_started','uncertain') THEN RAISE EXCEPTION 'Estado inválido' USING ERRCODE='22023';END IF;
 SELECT * INTO a FROM public.ienvia_campaign_ai_claims WHERE owner_id=p_owner AND request_id=p_request AND ticket=p_ticket;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ticket inválido' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.ienvia_campaign_lanes WHERE owner_id=p_owner AND phone=a.phone FOR UPDATE;
 SELECT * INTO a FROM public.ienvia_campaign_ai_claims WHERE owner_id=p_owner AND request_id=p_request AND ticket=p_ticket FOR UPDATE;
 IF p_state='accepted' AND a.state='not_started' AND a.resolved='nao_enviada' THEN
  IF a.late_accepted THEN RETURN jsonb_build_object('ownerId',p_owner,'state','late_conflict');END IF;
  UPDATE public.ienvia_campaign_ai_claims SET late_accepted=true WHERE owner_id=p_owner AND request_id=p_request;UPDATE public.ienvia_campaign_lanes SET late_request_id=p_request WHERE owner_id=p_owner AND phone=a.phone;
  UPDATE public.ienvia_campaign_runs SET status='pausada',reason='late_ai_after_review',revision=revision+1 WHERE owner_id=p_owner AND status IN ('ativa','pausada') AND EXISTS(SELECT 1 FROM jsonb_array_elements(document->'destinatarios') x WHERE x->>'telefone'=a.phone);
  RETURN jsonb_build_object('ownerId',p_owner,'state','late_conflict');
 END IF;
 IF a.state IN ('accepted','not_started') THEN RETURN jsonb_build_object('ownerId',p_owner,'state',a.state);END IF;
 UPDATE public.ienvia_campaign_ai_claims SET state=p_state WHERE owner_id=p_owner AND request_id=p_request;
 IF p_state<>'uncertain' THEN UPDATE public.ienvia_campaign_lanes SET request_id=NULL,ticket=NULL,purpose=NULL WHERE owner_id=p_owner AND phone=a.phone AND request_id=p_request;END IF;
 RETURN jsonb_build_object('ownerId',p_owner,'state',p_state);
END $$;
CREATE FUNCTION public.ienvia_campaign_execution_resolve(p_id uuid,p_revision integer,p_request uuid,p_ticket uuid,p_decision text,p_confirm boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE u uuid:=auth.uid();r public.ienvia_campaign_runs;a public.ienvia_campaign_attempts;d public.ienvia_instance_dispatches;
BEGIN
 PERFORM public.ienvia_campaign_access(u,true);IF p_confirm IS NOT TRUE OR p_decision IS NULL OR p_decision NOT IN ('confirmada','nao_enviada') THEN RAISE EXCEPTION 'Conferência obrigatória' USING ERRCODE='22023';END IF;
 SELECT * INTO r FROM public.ienvia_campaign_runs WHERE owner_id=u AND id=p_id FOR UPDATE;
 IF r.id IS NULL OR r.revision IS DISTINCT FROM p_revision OR r.pending IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'Tentativa ou revisão mudou' USING ERRCODE='40001';END IF;
 SELECT * INTO a FROM public.ienvia_campaign_attempts WHERE owner_id=u AND run_id=p_id AND request_id=p_request;
 PERFORM 1 FROM public.ienvia_channels WHERE owner_id=u AND id=a.instance_id FOR UPDATE;
 SELECT * INTO d FROM public.ienvia_instance_dispatches WHERE owner_id=u AND request_id=p_request AND ticket=p_ticket FOR UPDATE;
 IF NOT FOUND OR d.state<>'uncertain' OR a.resolved IS NOT NULL THEN RAISE EXCEPTION 'Tentativa não conferível' USING ERRCODE='55000';END IF;
 IF p_decision='confirmada' THEN
  UPDATE public.ienvia_campaign_attempts SET claimed_at=coalesce(claimed_at,clock_timestamp()),transport_at=coalesce(transport_at,clock_timestamp()) WHERE owner_id=u AND request_id=p_request;
  PERFORM public.ienvia_campaign_finish(u,p_id,a.executor_id,p_request,p_ticket,'accepted',a.provider_message_id);
 ELSE
  UPDATE public.ienvia_instance_dispatches SET state='not_started',updated_at=clock_timestamp() WHERE owner_id=u AND request_id=p_request;
  UPDATE public.ienvia_campaign_lanes SET request_id=NULL,ticket=NULL,purpose=NULL WHERE owner_id=u AND phone=a.phone AND request_id=p_request;
  UPDATE public.ienvia_campaign_runs SET pending=NULL,status=CASE WHEN status='cancelada' THEN status ELSE 'pausada' END,reason='manual_review',revision=revision+1 WHERE owner_id=u AND id=p_id;
 END IF;
 UPDATE public.ienvia_campaign_attempts SET resolved=p_decision WHERE owner_id=u AND request_id=p_request;
 RETURN public.ienvia_campaign_execution_get(u,p_id);
END $$;
CREATE FUNCTION public.ienvia_campaign_recover(p_owner uuid,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.ienvia_campaign_runs;d public.ienvia_instance_dispatches;
BEGIN
 SELECT * INTO r FROM public.ienvia_campaign_runs WHERE owner_id=p_owner AND id=p_id FOR UPDATE;
 IF r.id IS NOT NULL AND r.recipient<jsonb_array_length(r.document->'destinatarios') THEN PERFORM public.ienvia_campaign_ai_recover(p_owner,r.document->'destinatarios'->r.recipient->>'telefone');END IF;
 IF r.pending IS NOT NULL THEN
  SELECT * INTO d FROM public.ienvia_instance_dispatches WHERE owner_id=p_owner AND request_id=r.pending FOR UPDATE;
  IF (d.state='reserved' AND d.reserved_until<clock_timestamp()) OR (d.state='started' AND d.started_at<clock_timestamp()-interval '60 seconds') THEN
   UPDATE public.ienvia_instance_dispatches SET state='uncertain',updated_at=clock_timestamp() WHERE owner_id=p_owner AND request_id=r.pending;
   UPDATE public.ienvia_campaign_runs SET status=CASE WHEN status='cancelada' THEN status ELSE 'pausada' END,reason='recovered_uncertain',revision=revision+1 WHERE owner_id=p_owner AND id=p_id;
  END IF;
 END IF;
 RETURN jsonb_build_object('ownerId',p_owner,'campaignId',p_id,'recovered',true);
END $$;
CREATE FUNCTION public.ienvia_campaign_media_candidates(p_owner uuid,p_folder uuid,p_type text,p_offset integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE items jsonb;
BEGIN
 PERFORM public.ienvia_campaign_execution_guard(p_owner);IF p_folder IS NULL OR p_type IS NULL OR p_type NOT IN ('audio','imagem') OR p_offset IS NULL OR p_offset<0 OR p_offset>9900 THEN RAISE EXCEPTION 'Página inválida' USING ERRCODE='22023';END IF;
 EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(q)),''[]''::jsonb) FROM (SELECT owner_id,arquivo_id,pasta_id,tipo,mime,tamanho,sha256,ordem FROM public.ienvia_campanha_arquivos WHERE owner_id=$1 AND pasta_id=$2 AND tipo=$3 AND NOT excluindo ORDER BY ordem,arquivo_id OFFSET $4 LIMIT 100) q' INTO items USING p_owner,p_folder,p_type,p_offset;
 RETURN jsonb_build_object('ownerId',p_owner,'items',items);
END $$;
CREATE FUNCTION public.ienvia_campaign_protect_media() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.ienvia_campaign_attempts a JOIN public.ienvia_instance_dispatches d USING(owner_id,request_id) WHERE a.owner_id=OLD.owner_id AND a.material->>'arquivoId'=OLD.arquivo_id::text AND d.state IN ('reserved','started','uncertain')) THEN RAISE EXCEPTION 'Arquivo reservado ou incerto' USING ERRCODE='55000';END IF;IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
DO $$ BEGIN IF to_regclass('public.ienvia_campanha_arquivos') IS NOT NULL THEN EXECUTE 'CREATE TRIGGER campaign_protect_private_media BEFORE DELETE OR UPDATE ON public.ienvia_campanha_arquivos FOR EACH ROW EXECUTE FUNCTION public.ienvia_campaign_protect_media()';END IF;END $$;
REVOKE ALL ON FUNCTION public.ienvia_campaign_protect_media() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ienvia_campaign_global_control(integer,boolean),public.ienvia_campaign_conversation_control(text,boolean),public.ienvia_campaign_execution_resolve(uuid,integer,uuid,uuid,text,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_campaign_global_control(integer,boolean),public.ienvia_campaign_conversation_control(text,boolean),public.ienvia_campaign_execution_resolve(uuid,integer,uuid,uuid,text,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.ienvia_campaign_ai_claim(uuid,uuid,text),public.ienvia_campaign_ai_finish(uuid,uuid,uuid,text),public.ienvia_campaign_recover(uuid,uuid),public.ienvia_campaign_media_candidates(uuid,uuid,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_campaign_ai_claim(uuid,uuid,text),public.ienvia_campaign_ai_finish(uuid,uuid,uuid,text),public.ienvia_campaign_recover(uuid,uuid),public.ienvia_campaign_media_candidates(uuid,uuid,text,integer) TO service_role;

CREATE FUNCTION public.ienvia_campaign_begin_transport(p_owner uuid,p_id uuid,p_executor uuid,p_request uuid,p_ticket uuid,p_nonce uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' SET lock_timeout='2s' AS $$
DECLARE r public.ienvia_campaign_runs;a public.ienvia_campaign_attempts;
BEGIN
 PERFORM public.ienvia_campaign_execution_guard(p_owner);SELECT * INTO r FROM public.ienvia_campaign_runs WHERE owner_id=p_owner AND id=p_id FOR UPDATE;SELECT * INTO a FROM public.ienvia_campaign_attempts WHERE owner_id=p_owner AND run_id=p_id AND request_id=p_request AND executor_id=p_executor;
 IF a.request_id IS NULL OR p_nonce IS NULL OR a.send_nonce<>p_nonce OR a.claimed_at IS NULL OR a.transport_at IS NOT NULL OR a.resolved IS NOT NULL OR a.completed_at IS NOT NULL OR r.status<>'ativa' OR r.pending IS DISTINCT FROM p_request OR r.revision<>a.run_revision OR NOT public.ienvia_campaign_window(r.document->'opcoes',clock_timestamp()) THEN RAISE EXCEPTION 'Transporte não autorizado ou já consumido' USING ERRCODE='55000';END IF;
 PERFORM public.ienvia_campaign_assert_capability(p_owner,a.instance_id,p_executor,a.capability);
 PERFORM 1 FROM public.ienvia_campaign_lanes WHERE owner_id=p_owner AND phone=a.phone AND request_id=p_request AND ticket=p_ticket AND NOT blocked AND late_request_id IS NULL FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Conversa bloqueada' USING ERRCODE='55000';END IF;
 PERFORM 1 FROM public.ienvia_instance_dispatches WHERE owner_id=p_owner AND request_id=p_request AND executor_id=p_executor AND ticket=p_ticket AND state='started' FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Ticket indisponível' USING ERRCODE='55000';END IF;
 UPDATE public.ienvia_campaign_attempts SET transport_at=clock_timestamp() WHERE owner_id=p_owner AND request_id=p_request;
 RETURN jsonb_build_object('ownerId',p_owner,'campaignId',p_id,'instanceId',a.instance_id,'executorId',p_executor,'requestId',p_request,'recipient',a.phone||'@s.whatsapp.net','providerMessageId',a.provider_message_id,'material',a.material,'transportStarted',true);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campaign_begin_transport(uuid,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_campaign_begin_transport(uuid,uuid,uuid,uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.ienvia_campaign_execution_scan(p_owner uuid,p_executor uuid,p_after uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE items jsonb;more boolean;last_id uuid;
BEGIN
 PERFORM public.ienvia_campaign_execution_guard(p_owner);
 SELECT coalesce(jsonb_agg(q.id ORDER BY q.id),'[]'::jsonb) INTO items FROM (SELECT id FROM public.ienvia_campaign_runs WHERE owner_id=p_owner AND EXISTS(SELECT 1 FROM public.ienvia_instance_assignments a WHERE a.owner_id=p_owner AND a.instance_id=public.ienvia_campaign_current_instance(ienvia_campaign_runs) AND a.executor_id=p_executor AND a.enabled) AND (status='ativa' OR pending IS NOT NULL) AND (p_after IS NULL OR id>p_after) ORDER BY id LIMIT 50) q;
 last_id:=(items->>-1)::uuid;SELECT EXISTS(SELECT 1 FROM public.ienvia_campaign_runs WHERE owner_id=p_owner AND EXISTS(SELECT 1 FROM public.ienvia_instance_assignments a WHERE a.owner_id=p_owner AND a.instance_id=public.ienvia_campaign_current_instance(ienvia_campaign_runs) AND a.executor_id=p_executor AND a.enabled) AND (status='ativa' OR pending IS NOT NULL) AND id>last_id) INTO more;
 RETURN jsonb_build_object('ownerId',p_owner,'items',items,'hasMore',more,'nextCursor',CASE WHEN more THEN last_id ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campaign_execution_scan(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_campaign_execution_scan(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.ienvia_campaign_ai_guard(p_owner uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF public.zapia_is_user_active(p_owner) IS NOT TRUE THEN RAISE EXCEPTION 'Conta indisponível' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.ienvia_campaign_execution_accounts WHERE owner_id=p_owner AND coordination_ready FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Coordenação não disponível' USING ERRCODE='55000';END IF;
 -- IA independe dos opt-ins e da pausa global de Campanhas.
END $$;
CREATE FUNCTION public.ienvia_campaign_ai_ready(p_owner uuid,p_request uuid,p_ticket uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.ienvia_campaign_ai_guard(p_owner);
 PERFORM 1 FROM public.ienvia_campaign_lanes l JOIN public.ienvia_campaign_ai_claims a ON a.owner_id=l.owner_id AND a.phone=l.phone AND a.request_id=l.request_id WHERE l.owner_id=p_owner AND l.request_id=p_request AND l.ticket=p_ticket AND l.purpose='ai' AND NOT l.blocked AND l.late_request_id IS NULL AND a.state='started' AND a.transport_at IS NULL FOR UPDATE OF l,a;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não autorizada' USING ERRCODE='55000';END IF;
 UPDATE public.ienvia_campaign_ai_claims SET transport_at=clock_timestamp() WHERE owner_id=p_owner AND request_id=p_request;RETURN jsonb_build_object('ownerId',p_owner,'allowed',true);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campaign_ai_guard(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ienvia_campaign_ai_ready(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_campaign_ai_ready(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.ienvia_campaign_skip_excluded(p_owner uuid,p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.ienvia_campaign_runs;
BEGIN
 SELECT * INTO r FROM public.ienvia_campaign_runs WHERE owner_id=p_owner AND id=p_id FOR UPDATE;
 WHILE r.pending IS NULL AND r.recipient=ANY(r.excluded) LOOP r.recipient:=r.recipient+1;END LOOP;
 UPDATE public.ienvia_campaign_runs SET recipient=r.recipient,step=CASE WHEN recipient<>r.recipient THEN 0 ELSE step END,person_instance=CASE WHEN recipient<>r.recipient THEN NULL ELSE person_instance END,status=CASE WHEN status<>'cancelada' AND r.recipient>=jsonb_array_length(document->'destinatarios') THEN 'concluida' ELSE status END WHERE owner_id=p_owner AND id=p_id;
END $$;
CREATE FUNCTION public.ienvia_campaign_execution_exclude(p_id uuid,p_revision integer,p_recipient uuid,p_confirm boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid();r public.ienvia_campaign_runs;n integer;
BEGIN
 PERFORM public.ienvia_campaign_access(u,true);SELECT * INTO r FROM public.ienvia_campaign_runs WHERE owner_id=u AND id=p_id FOR UPDATE;
 IF r.id IS NULL OR p_revision IS DISTINCT FROM r.revision THEN RAISE EXCEPTION 'Revisão mudou' USING ERRCODE='40001';END IF;
 IF p_confirm IS NOT TRUE OR r.pending IS NOT NULL OR public.ienvia_campaign_late_review(r) IS NOT NULL OR r.status NOT IN ('ativa','pausada') THEN RAISE EXCEPTION 'Não é possível remover agora' USING ERRCODE='55000';END IF;
 SELECT ordinality::integer-1 INTO n FROM jsonb_array_elements(r.document->'destinatarios') WITH ORDINALITY WHERE overlay(overlay(md5(p_id::text||':'||(value->>'telefone')) placing '5' from 13 for 1) placing '8' from 17 for 1)::uuid=p_recipient;
 IF n IS NULL OR n<r.recipient OR n=ANY(r.excluded) THEN RAISE EXCEPTION 'Pessoa indisponível' USING ERRCODE='55000';END IF;
 UPDATE public.ienvia_campaign_runs SET excluded=array_append(excluded,n),revision=revision+1 WHERE owner_id=u AND id=p_id;
 PERFORM public.ienvia_campaign_skip_excluded(u,p_id);RETURN public.ienvia_campaign_execution_get(u,p_id);
END $$;
CREATE FUNCTION public.ienvia_campaign_execution_edit(p_id uuid,p_revision integer,p_plan jsonb,p_options jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid();r public.ienvia_campaign_runs;doc jsonb;
BEGIN
 PERFORM public.ienvia_campaign_access(u,true);SELECT * INTO r FROM public.ienvia_campaign_runs WHERE owner_id=u AND id=p_id FOR UPDATE;
 IF r.id IS NULL OR p_revision IS DISTINCT FROM r.revision THEN RAISE EXCEPTION 'Revisão mudou' USING ERRCODE='40001';END IF;
 IF r.status<>'pausada' OR r.pending IS NOT NULL OR public.ienvia_campaign_late_review(r) IS NOT NULL THEN RAISE EXCEPTION 'Pause e confira a tentativa antes de editar' USING ERRCODE='55000';END IF;
 doc:=jsonb_build_object('plano',p_plan,'opcoes',p_options,'destinatarios',r.document->'destinatarios');PERFORM public.ienvia_campaign_validate_document(u,doc);
 IF r.step>=jsonb_array_length(p_plan->'blocos') OR r.step>0 AND r.person_instance IS NOT NULL AND NOT p_plan->'instanceIds' @> jsonb_build_array(r.person_instance) THEN RAISE EXCEPTION 'Etapas/instância da pessoa atual precisam ser preservadas' USING ERRCODE='22023';END IF;
 UPDATE public.ienvia_campaign_runs SET document=doc,revision=revision+1,person_instance=CASE WHEN step=0 THEN NULL ELSE person_instance END WHERE owner_id=u AND id=p_id;
 RETURN public.ienvia_campaign_execution_get(u,p_id);
END $$;
CREATE FUNCTION public.ienvia_campaign_execution_features(p_owner uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE g public.ienvia_campaign_execution_accounts;
BEGIN
 PERFORM public.ienvia_campaign_access(p_owner,false);SELECT * INTO g FROM public.ienvia_campaign_execution_accounts WHERE owner_id=p_owner;
 RETURN jsonb_build_object('ownerId',p_owner,'writesEnabled',public.ienvia_campaign_can_write(p_owner),'executionEnabled',coalesce(g.enabled AND g.coordination_ready,false),'globalEnabled',coalesce(g.global_enabled,false),'revision',g.revision);
END $$;
CREATE FUNCTION public.ienvia_campaign_execution_summaries(p_owner uuid,p_ids jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE items jsonb;
BEGIN
 PERFORM public.ienvia_campaign_access(p_owner,false);IF p_ids IS NULL OR jsonb_typeof(p_ids)<>'array' OR jsonb_array_length(p_ids)>50 OR jsonb_array_length(p_ids)<1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_ids) v WHERE jsonb_typeof(v)<>'string') THEN RAISE EXCEPTION 'Recorte inválido' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(public.ienvia_campaign_run_dto(r) ORDER BY r.id),'[]'::jsonb) INTO items FROM public.ienvia_campaign_runs r WHERE owner_id=p_owner AND id IN (SELECT jsonb_array_elements_text(p_ids)::uuid);
 RETURN jsonb_build_object('ownerId',p_owner,'writesEnabled',public.ienvia_campaign_can_write(p_owner),'items',items);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campaign_skip_excluded(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ienvia_campaign_execution_exclude(uuid,integer,uuid,boolean),public.ienvia_campaign_execution_edit(uuid,integer,jsonb,jsonb),public.ienvia_campaign_execution_features(uuid),public.ienvia_campaign_execution_summaries(uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_campaign_execution_exclude(uuid,integer,uuid,boolean),public.ienvia_campaign_execution_edit(uuid,integer,jsonb,jsonb),public.ienvia_campaign_execution_features(uuid),public.ienvia_campaign_execution_summaries(uuid,jsonb) TO authenticated;

CREATE FUNCTION public.ienvia_campaign_ai_review(r public.ienvia_campaign_runs) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('kind','ai','requestId',a.request_id,'ticket',a.ticket,'state',CASE WHEN a.late_accepted THEN 'uncertain' ELSE a.state END,'late',a.late_accepted,'step',0,'recipientId',overlay(overlay(md5(r.id::text||':'||a.phone) placing '5' from 13 for 1) placing '8' from 17 for 1)::uuid,'phone',a.phone,'name',x.value->>'nome')
 FROM public.ienvia_campaign_ai_claims a JOIN public.ienvia_campaign_lanes l ON l.owner_id=a.owner_id AND l.phone=a.phone JOIN LATERAL jsonb_array_elements(r.document->'destinatarios') x(value) ON x.value->>'telefone'=a.phone WHERE a.owner_id=r.owner_id AND (a.late_accepted AND l.late_request_id=a.request_id OR a.state IN ('started','uncertain') AND l.purpose='ai' AND l.request_id=a.request_id AND a.phone=r.document->'destinatarios'->r.recipient->>'telefone') ORDER BY a.late_accepted DESC LIMIT 1
$$;
CREATE FUNCTION public.ienvia_campaign_execution_resolve_ai(p_id uuid,p_revision integer,p_request uuid,p_ticket uuid,p_decision text,p_confirm boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE u uuid:=auth.uid();r public.ienvia_campaign_runs;a public.ienvia_campaign_ai_claims;review jsonb;
BEGIN
 PERFORM public.ienvia_campaign_access(u,true);SELECT * INTO r FROM public.ienvia_campaign_runs WHERE owner_id=u AND id=p_id FOR UPDATE;
 IF r.id IS NULL OR r.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Revisão mudou' USING ERRCODE='40001';END IF;
 IF p_confirm IS NOT TRUE OR p_decision IS NULL OR p_decision NOT IN ('confirmada','nao_enviada') OR r.pending IS NOT NULL THEN RAISE EXCEPTION 'Conferência obrigatória' USING ERRCODE='55000';END IF;
 review:=public.ienvia_campaign_ai_review(r);IF review->>'requestId' IS DISTINCT FROM p_request::text OR review->>'ticket' IS DISTINCT FROM p_ticket::text OR review->>'state'<>'uncertain' THEN RAISE EXCEPTION 'Tentativa mudou' USING ERRCODE='40001';END IF;
 SELECT * INTO a FROM public.ienvia_campaign_ai_claims WHERE owner_id=u AND request_id=p_request AND ticket=p_ticket;
 PERFORM 1 FROM public.ienvia_campaign_lanes WHERE owner_id=u AND phone=a.phone FOR UPDATE;SELECT * INTO a FROM public.ienvia_campaign_ai_claims WHERE owner_id=u AND request_id=p_request AND ticket=p_ticket FOR UPDATE;
 IF a.late_accepted AND p_decision<>'confirmada' OR a.state<>'uncertain' AND NOT a.late_accepted THEN RAISE EXCEPTION 'Confira o aceite tardio' USING ERRCODE='55000';END IF;
 UPDATE public.ienvia_campaign_ai_claims SET state=CASE WHEN p_decision='confirmada' THEN 'accepted' ELSE 'not_started' END,resolved=p_decision,late_accepted=false WHERE owner_id=u AND request_id=p_request;
 UPDATE public.ienvia_campaign_lanes SET request_id=CASE WHEN request_id=p_request THEN NULL ELSE request_id END,ticket=CASE WHEN request_id=p_request THEN NULL ELSE ticket END,purpose=CASE WHEN request_id=p_request THEN NULL ELSE purpose END,late_request_id=CASE WHEN late_request_id=p_request THEN NULL ELSE late_request_id END WHERE owner_id=u AND phone=a.phone;
 UPDATE public.ienvia_campaign_runs SET status=CASE WHEN status IN ('concluida','cancelada') THEN status ELSE 'pausada' END,reason=NULL,revision=revision+1 WHERE owner_id=u AND id=p_id;
 RETURN public.ienvia_campaign_execution_get(u,p_id);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campaign_ai_review(public.ienvia_campaign_runs) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ienvia_campaign_execution_resolve_ai(uuid,integer,uuid,uuid,text,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_campaign_execution_resolve_ai(uuid,integer,uuid,uuid,text,boolean) TO authenticated;

CREATE FUNCTION public.ienvia_campaign_ai_recover(p_owner uuid,p_phone text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.ienvia_campaign_ai_claims;
BEGIN
 PERFORM 1 FROM public.ienvia_campaign_lanes WHERE owner_id=p_owner AND phone=p_phone FOR UPDATE;
 SELECT c.* INTO a FROM public.ienvia_campaign_ai_claims c JOIN public.ienvia_campaign_lanes l ON l.owner_id=c.owner_id AND l.request_id=c.request_id AND l.phone=c.phone WHERE c.owner_id=p_owner AND c.phone=p_phone AND c.state='started' AND c.created_at<clock_timestamp()-interval '60 seconds' FOR UPDATE OF c;
 IF NOT FOUND THEN RETURN;END IF;
 UPDATE public.ienvia_campaign_ai_claims SET state=CASE WHEN transport_at IS NULL THEN 'not_started' ELSE 'uncertain' END WHERE owner_id=p_owner AND request_id=a.request_id;
 IF a.transport_at IS NULL THEN UPDATE public.ienvia_campaign_lanes SET request_id=NULL,purpose=NULL,ticket=NULL WHERE owner_id=p_owner AND phone=p_phone AND request_id=a.request_id;END IF;
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campaign_ai_recover(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.ienvia_campaign_current_instance(r public.ienvia_campaign_runs) RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(r.person_instance,(r.document->'plano'->'instanceIds'->>CASE WHEN r.document->'plano'->>'distribution'='fixo' THEN 0 ELSE r.recipient%greatest(jsonb_array_length(r.document->'plano'->'instanceIds'),1) END)::uuid)
$$;
CREATE TABLE public.ienvia_campaign_worker_boots(owner_id uuid NOT NULL REFERENCES public.zapia_users(user_id),executor_id uuid NOT NULL,boot_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(owner_id,executor_id,boot_id));
ALTER TABLE public.ienvia_campaign_worker_boots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_campaign_worker_boots FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ienvia_campaign_worker_boot(p_owner uuid,p_executor uuid,p_boot uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='5s' SET lock_timeout='2s' AS $$
BEGIN
 PERFORM public.ienvia_campaign_execution_guard(p_owner);IF p_boot IS NULL OR NOT EXISTS(SELECT 1 FROM public.ienvia_instance_executors WHERE owner_id=p_owner AND id=p_executor AND enabled) THEN RAISE EXCEPTION 'Worker indisponível' USING ERRCODE='42501';END IF;
 INSERT INTO public.ienvia_campaign_worker_boots(owner_id,executor_id,boot_id) VALUES(p_owner,p_executor,p_boot) ON CONFLICT DO NOTHING;
 IF FOUND THEN UPDATE public.ienvia_campaign_runs r SET status='pausada',reason='startup_manual',revision=revision+1 WHERE r.owner_id=p_owner AND r.status='ativa' AND r.document->'plano'->>'retomada'='manual' AND EXISTS(SELECT 1 FROM public.ienvia_instance_assignments a WHERE a.owner_id=p_owner AND a.instance_id=public.ienvia_campaign_current_instance(r) AND a.executor_id=p_executor AND a.enabled);END IF;
 RETURN jsonb_build_object('ownerId',p_owner,'bootId',p_boot,'registered',true);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campaign_current_instance(public.ienvia_campaign_runs),public.ienvia_campaign_worker_boot(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_campaign_worker_boot(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.ienvia_campaign_late_review(r public.ienvia_campaign_runs) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('kind','campaign_late','requestId',a.request_id,'ticket',d.ticket,'recipient',a.recipient,'step',a.step,'instanceId',a.instance_id,'state','uncertain','phone',a.phone,'name',r.document->'destinatarios'->a.recipient->>'nome','recipientId',overlay(overlay(md5(r.id::text||':'||a.phone) placing '5' from 13 for 1) placing '8' from 17 for 1)::uuid,'material',a.material)
 FROM public.ienvia_campaign_attempts a JOIN public.ienvia_instance_dispatches d USING(owner_id,request_id) WHERE a.owner_id=r.owner_id AND a.run_id=r.id AND a.late_at IS NOT NULL AND a.late_reviewed_at IS NULL ORDER BY a.late_at LIMIT 1
$$;
CREATE FUNCTION public.ienvia_campaign_execution_resolve_late(p_id uuid,p_revision integer,p_request uuid,p_ticket uuid,p_decision text,p_confirm boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE u uuid:=auth.uid();r public.ienvia_campaign_runs;a public.ienvia_campaign_attempts;review jsonb;
BEGIN
 PERFORM public.ienvia_campaign_access(u,true);SELECT * INTO r FROM public.ienvia_campaign_runs WHERE owner_id=u AND id=p_id FOR UPDATE;
 IF r.id IS NULL OR r.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Revisão mudou' USING ERRCODE='40001';END IF;
 IF p_confirm IS NOT TRUE OR p_decision IS DISTINCT FROM 'confirmada' OR r.pending IS NOT NULL THEN RAISE EXCEPTION 'Confira o aceite tardio e a tentativa atual' USING ERRCODE='55000';END IF;
 review:=public.ienvia_campaign_late_review(r);IF review->>'requestId' IS DISTINCT FROM p_request::text OR review->>'ticket' IS DISTINCT FROM p_ticket::text THEN RAISE EXCEPTION 'Tentativa mudou' USING ERRCODE='40001';END IF;
 SELECT * INTO a FROM public.ienvia_campaign_attempts WHERE owner_id=u AND run_id=p_id AND request_id=p_request FOR UPDATE;
 UPDATE public.ienvia_campaign_attempts SET late_reviewed_at=clock_timestamp() WHERE owner_id=u AND request_id=p_request;
 IF r.recipient=a.recipient AND r.step=a.step AND a.completed_at IS NULL THEN
  UPDATE public.ienvia_campaign_attempts SET resolved=NULL WHERE owner_id=u AND request_id=p_request;
  UPDATE public.ienvia_instance_dispatches SET state='uncertain' WHERE owner_id=u AND request_id=p_request;
  UPDATE public.ienvia_campaign_runs SET pending=p_request,reason=NULL WHERE owner_id=u AND id=p_id;
  PERFORM public.ienvia_campaign_finish(u,p_id,a.executor_id,p_request,p_ticket,'accepted',a.late_provider_id);
 ELSE UPDATE public.ienvia_campaign_runs SET revision=revision+1,reason=CASE WHEN reason='late_confirmation' THEN NULL ELSE reason END WHERE owner_id=u AND id=p_id;
 END IF;
 RETURN public.ienvia_campaign_execution_get(u,p_id);
END $$;
CREATE INDEX campaign_ai_active ON public.ienvia_campaign_ai_claims(owner_id,phone,created_at) WHERE state IN ('started','uncertain') OR late_accepted;
CREATE INDEX campaign_attempts_late ON public.ienvia_campaign_attempts(owner_id,run_id,late_at) WHERE late_at IS NOT NULL AND late_reviewed_at IS NULL;
REVOKE ALL ON FUNCTION public.ienvia_campaign_late_review(public.ienvia_campaign_runs) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ienvia_campaign_execution_resolve_late(uuid,integer,uuid,uuid,text,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_campaign_execution_resolve_late(uuid,integer,uuid,uuid,text,boolean) TO authenticated;

CREATE FUNCTION public.ienvia_campaign_worker_readiness(p_owner uuid,p_executor uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('ownerId',p_owner,'ready',public.zapia_is_user_active(p_owner) IS TRUE AND EXISTS(SELECT 1 FROM public.ienvia_campaign_execution_accounts WHERE owner_id=p_owner AND enabled AND coordination_ready) AND EXISTS(SELECT 1 FROM public.ienvia_campaign_write_accounts WHERE owner_id=p_owner AND enabled) AND EXISTS(SELECT 1 FROM public.ienvia_instance_executors WHERE owner_id=p_owner AND id=p_executor AND enabled))
$$;
REVOKE ALL ON FUNCTION public.ienvia_campaign_worker_readiness(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_campaign_worker_readiness(uuid,uuid) TO service_role;
