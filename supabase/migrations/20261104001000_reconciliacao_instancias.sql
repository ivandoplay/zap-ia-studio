-- SOMENTE LOCAL: revisão auditada, nunca um comando de envio/retry ou liberação cega.
CREATE TABLE public.ienvia_instance_dispatch_reviews (
 owner_id uuid NOT NULL,
 review_id uuid NOT NULL,
 instance_id uuid NOT NULL,
 request_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.zapia_users(user_id),
 expected_state text NOT NULL CHECK(expected_state IN ('reserved','started','uncertain','accepted','not_started')),
 before_state text NOT NULL CHECK(before_state IN ('reserved','started','uncertain','accepted','not_started')),
 after_state text NOT NULL CHECK(after_state IN ('reserved','started','uncertain','accepted','not_started')),
 action text NOT NULL CHECK(action IN ('expired_unstarted','retained_unknown','retained_reservation','observed_accepted','observed_not_started')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,review_id),
 FOREIGN KEY(owner_id,request_id) REFERENCES public.ienvia_instance_dispatches(owner_id,request_id),
 FOREIGN KEY(owner_id,instance_id) REFERENCES public.ienvia_channels(owner_id,id)
);
CREATE INDEX instance_dispatch_reviews_request ON public.ienvia_instance_dispatch_reviews(owner_id,request_id,created_at DESC);
ALTER TABLE public.ienvia_instance_dispatch_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_instance_dispatch_reviews FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.ienvia_dispatch_review_dto(r public.ienvia_instance_dispatch_reviews,p_duplicate boolean) RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT jsonb_build_object('ownerId',r.owner_id,'instanceId',r.instance_id,'requestId',r.request_id,'reviewId',r.review_id,'actorId',r.actor_id,'beforeState',r.before_state,'afterState',r.after_state,'action',r.action,'createdAt',r.created_at,'duplicate',p_duplicate,'queued',false,'canRetryAutomatically',false) $$;
REVOKE ALL ON FUNCTION public.ienvia_dispatch_review_dto(public.ienvia_instance_dispatch_reviews,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.ienvia_get_instance_dispatch(p_owner uuid,p_instance uuid,p_request uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='3s' SET lock_timeout='2s' AS $$
DECLARE u uuid:=auth.uid(); d public.ienvia_instance_dispatches; r public.ienvia_instance_dispatch_reviews; n bigint;
BEGIN
 IF u IS NULL OR public.zapia_is_user_active(u) IS NOT TRUE OR public.zapia_is_user_active(p_owner) IS NOT TRUE THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF u<>p_owner AND NOT EXISTS(SELECT 1 FROM public.zapia_users WHERE user_id=u AND is_active AND role='master') THEN RAISE EXCEPTION 'Conta não autorizada' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.ienvia_instance_dispatches WHERE owner_id=p_owner AND instance_id=p_instance AND request_id=p_request;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado' USING ERRCODE='P0002'; END IF;
 SELECT count(*) INTO n FROM public.ienvia_instance_dispatch_reviews WHERE owner_id=p_owner AND request_id=p_request;
 SELECT * INTO r FROM public.ienvia_instance_dispatch_reviews WHERE owner_id=p_owner AND request_id=p_request ORDER BY created_at DESC,review_id DESC LIMIT 1;
 RETURN jsonb_build_object('ownerId',d.owner_id,'instanceId',d.instance_id,'executorId',d.executor_id,'requestId',d.request_id,'state',d.state,
  'classification',CASE WHEN d.state='accepted' THEN 'accepted_by_provider' WHEN d.state='not_started' THEN 'not_started' WHEN d.state IN ('started','uncertain') THEN 'outcome_unknown' WHEN d.reserved_until<statement_timestamp() AND d.started_at IS NULL THEN 'expired_before_start' ELSE 'reserved_waiting_start' END,
  'blocking',d.state IN ('reserved','started','uncertain'),'canExpireUnstarted',d.state='reserved' AND d.started_at IS NULL AND d.reserved_until<statement_timestamp(),
  'createdAt',d.created_at,'updatedAt',d.updated_at,'startedAt',d.started_at,'reservedUntil',d.reserved_until,
  'reviewCount',n,'lastReview',CASE WHEN r.review_id IS NULL THEN NULL ELSE public.ienvia_dispatch_review_dto(r,false) END,
  'delivered',false,'queued',false,'canRetryAutomatically',false);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_get_instance_dispatch(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_get_instance_dispatch(uuid,uuid,uuid) TO authenticated;

CREATE FUNCTION public.ienvia_review_instance_dispatch(p_instance uuid,p_request uuid,p_expected_state text,p_review uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='3s' SET lock_timeout='2s' AS $$
DECLARE u uuid:=auth.uid(); d public.ienvia_instance_dispatches; r public.ienvia_instance_dispatch_reviews; before_state text; outcome text;
BEGIN
 IF u IS NULL OR public.zapia_is_user_active(u) IS NOT TRUE THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF p_review IS NULL OR p_expected_state IS NULL OR p_expected_state NOT IN ('reserved','started','uncertain','accepted','not_started') THEN RAISE EXCEPTION 'Revisão inválida' USING ERRCODE='22023'; END IF;
 -- Mesma ordem de locks do início/reserva. Não se lê estado e depois se decide fora da transação.
 PERFORM 1 FROM public.ienvia_channels WHERE owner_id=u AND id=p_instance FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Instância não encontrada' USING ERRCODE='P0002'; END IF;
 SELECT * INTO d FROM public.ienvia_instance_dispatches WHERE owner_id=u AND instance_id=p_instance AND request_id=p_request FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado' USING ERRCODE='P0002'; END IF;
 SELECT * INTO r FROM public.ienvia_instance_dispatch_reviews WHERE owner_id=u AND review_id=p_review;
 IF FOUND THEN
  IF r.instance_id IS DISTINCT FROM p_instance OR r.request_id IS DISTINCT FROM p_request OR r.expected_state IS DISTINCT FROM p_expected_state THEN RAISE EXCEPTION 'Identificador reutilizado com revisão diferente' USING ERRCODE='40001'; END IF;
  RETURN public.ienvia_dispatch_review_dto(r,true);
 END IF;
 IF d.state IS DISTINCT FROM p_expected_state THEN RAISE EXCEPTION 'Estado mudou; consultar novamente' USING ERRCODE='40001'; END IF;
 before_state:=d.state;
 IF d.state='reserved' AND d.started_at IS NULL AND d.reserved_until<clock_timestamp() THEN
  UPDATE public.ienvia_instance_dispatches SET state='not_started',updated_at=clock_timestamp() WHERE owner_id=u AND request_id=p_request RETURNING * INTO d;
  outcome:='expired_unstarted';
 ELSIF d.state IN ('started','uncertain') THEN outcome:='retained_unknown';
 ELSIF d.state='accepted' THEN outcome:='observed_accepted';
 ELSIF d.state='not_started' THEN outcome:='observed_not_started';
 ELSE outcome:='retained_reservation';
 END IF;
 INSERT INTO public.ienvia_instance_dispatch_reviews(owner_id,review_id,instance_id,request_id,actor_id,expected_state,before_state,after_state,action)
 VALUES(u,p_review,p_instance,p_request,u,p_expected_state,before_state,d.state,outcome) RETURNING * INTO r;
 RETURN public.ienvia_dispatch_review_dto(r,false);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_review_instance_dispatch(uuid,uuid,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_review_instance_dispatch(uuid,uuid,text,uuid) TO authenticated;
