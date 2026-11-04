-- Mudança aditiva: leitura agregada e preferência visual. Não toca campanhas/mensagens existentes.
CREATE TABLE public.ienvia_user_appearance (
 user_id uuid PRIMARY KEY REFERENCES public.zapia_users(user_id) ON DELETE CASCADE,
 theme text NOT NULL CHECK(theme IN ('dark','light')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ienvia_user_appearance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_user_appearance FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ienvia_user_appearance TO authenticated;
CREATE POLICY appearance_self_read ON public.ienvia_user_appearance FOR SELECT TO authenticated
 USING(user_id=(SELECT auth.uid()) AND public.zapia_is_user_active((SELECT auth.uid())));

CREATE FUNCTION public.ienvia_set_appearance(p_theme text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid:=auth.uid();
BEGIN
 IF v_user IS NULL OR public.zapia_is_user_active(v_user) IS NOT TRUE THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF p_theme IS NULL OR p_theme NOT IN ('dark','light') THEN RAISE EXCEPTION 'Tema inválido' USING ERRCODE='22023'; END IF;
 INSERT INTO public.ienvia_user_appearance(user_id,theme) VALUES(v_user,p_theme)
 ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme,updated_at=pg_catalog.clock_timestamp();
 RETURN jsonb_build_object('theme',p_theme);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_set_appearance(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ienvia_set_appearance(text) TO authenticated;

CREATE FUNCTION public.ienvia_dashboard_summary_v1(p_owner uuid DEFAULT auth.uid()) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='5s' AS $$
DECLARE v_user uuid:=auth.uid(); v_now timestamptz:=now(); v_today date:=(now() AT TIME ZONE 'America/Fortaleza')::date; v_result jsonb;
BEGIN
 IF v_user IS NULL OR p_owner IS NULL OR public.zapia_is_user_active(v_user) IS NOT TRUE
 OR public.zapia_is_user_active(p_owner) IS NOT TRUE THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501'; END IF;
 IF v_user<>p_owner AND NOT EXISTS(SELECT 1 FROM public.zapia_users WHERE user_id=v_user AND role='master' AND is_active) THEN
   RAISE EXCEPTION 'Conta não autorizada' USING ERRCODE='42501';
 END IF;
 WITH contacts AS (
  SELECT count(*) AS total,count(*) FILTER(WHERE data->>'stage'='aguardando_humano') AS pending
  FROM public.zapia_contacts WHERE user_id=p_owner
 ), campaigns AS (
  SELECT count(*) AS total,count(*) FILTER(WHERE status='ativa') AS active,count(*) FILTER(WHERE status='pausada') AS paused,
   count(*) FILTER(WHERE status='rascunho') AS drafts,count(*) FILTER(WHERE status='concluida') AS completed
  FROM public.ienvia_campanhas_controle WHERE owner_id=p_owner
 ), activity AS (
  SELECT (last_message_at AT TIME ZONE 'America/Fortaleza')::date AS day,count(*) AS n
  FROM public.zapia_contacts WHERE user_id=p_owner
    AND last_message_at>=((v_today-6)::timestamp AT TIME ZONE 'America/Fortaleza')
    AND last_message_at<((v_today+1)::timestamp AT TIME ZONE 'America/Fortaleza')
  GROUP BY 1
 ), days AS (SELECT generate_series(v_today-6,v_today,interval '1 day')::date AS day)
 SELECT jsonb_build_object('schemaVersion',1,'tenantId',p_owner,'generatedAt',v_now,'timeZone','America/Fortaleza',
  'counts',jsonb_build_object('conversations',c.total,'pendingHuman',c.pending,'campaigns',p.total),
  'campaigns',jsonb_build_object('active',p.active,'paused',p.paused,'drafts',p.drafts,'completed',p.completed),
  'activityDefinition','last_contact_activity',
  'activity',(SELECT jsonb_agg(jsonb_build_object('date',d.day,'value',coalesce(a.n,0)) ORDER BY d.day) FROM days d LEFT JOIN activity a USING(day)))
 INTO v_result FROM contacts c CROSS JOIN campaigns p;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.ienvia_dashboard_summary_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ienvia_dashboard_summary_v1(uuid) TO authenticated;
