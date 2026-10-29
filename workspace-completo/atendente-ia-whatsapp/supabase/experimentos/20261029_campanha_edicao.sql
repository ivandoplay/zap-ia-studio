-- Edição das opções e do plano na mesma transação. Somente laboratório.
CREATE FUNCTION ienvia_private.editar_configuracao_campanha(p_campanha uuid,p_plano jsonb,p_opcoes jsonb)
RETURNS SETOF public.ienvia_campanhas_controle LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.ienvia_campanhas_controle; n integer;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 SELECT * INTO c FROM public.ienvia_campanhas_controle AS x WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha FOR UPDATE;
 IF NOT FOUND OR c.status='concluida' THEN RETURN; END IF;
 IF p_opcoes IS NULL OR pg_catalog.jsonb_typeof(p_opcoes)<>'object' OR pg_catalog.length(p_opcoes::text)>20000 OR (p_opcoes-ARRAY['intervalo_min_ms','intervalo_max_ms','pausa_lote_min_ms','pausa_lote_max_ms','intervalo_etapas_ms','lote_min','lote_max','restricao_horaria','fuso','dias','inicio','fim','inicio_em'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Opções inválidas' USING ERRCODE='23514'; END IF;
 IF p_opcoes ? 'dias' AND pg_catalog.jsonb_typeof(p_opcoes->'dias')<>'array' THEN RAISE EXCEPTION 'Dias inválidos' USING ERRCODE='23514'; END IF;
 IF p_opcoes ? 'inicio_em' AND c.status<>'rascunho' THEN RAISE EXCEPTION 'Início agendado só pode ser alterado antes da campanha iniciar' USING ERRCODE='23514'; END IF;
 SELECT pg_catalog.count(*) INTO n FROM ienvia_private.editar_plano_campanha(p_campanha,p_plano);
 IF n<>1 THEN RETURN; END IF;
 RETURN QUERY UPDATE public.ienvia_campanhas_controle AS x SET
  intervalo_min_ms=COALESCE((p_opcoes->>'intervalo_min_ms')::bigint,x.intervalo_min_ms),
  intervalo_max_ms=COALESCE((p_opcoes->>'intervalo_max_ms')::bigint,x.intervalo_max_ms),
  pausa_lote_min_ms=COALESCE((p_opcoes->>'pausa_lote_min_ms')::bigint,x.pausa_lote_min_ms),
  pausa_lote_max_ms=COALESCE((p_opcoes->>'pausa_lote_max_ms')::bigint,x.pausa_lote_max_ms),
  intervalo_etapas_ms=COALESCE((p_opcoes->>'intervalo_etapas_ms')::bigint,x.intervalo_etapas_ms),
  lote_min=COALESCE((p_opcoes->>'lote_min')::integer,x.lote_min),lote_max=COALESCE((p_opcoes->>'lote_max')::integer,x.lote_max),
  lote_meta=CASE WHEN x.lote_meta NOT BETWEEN COALESCE((p_opcoes->>'lote_min')::integer,x.lote_min) AND COALESCE((p_opcoes->>'lote_max')::integer,x.lote_max)
    THEN COALESCE((p_opcoes->>'lote_min')::integer,x.lote_min)+pg_catalog.floor(pg_catalog.random()*(COALESCE((p_opcoes->>'lote_max')::integer,x.lote_max)-COALESCE((p_opcoes->>'lote_min')::integer,x.lote_min)+1))::integer ELSE x.lote_meta END,
  restricao_horaria=COALESCE((p_opcoes->>'restricao_horaria')::boolean,x.restricao_horaria),fuso=COALESCE(p_opcoes->>'fuso',x.fuso),
  dias=CASE WHEN p_opcoes ? 'dias' THEN (SELECT pg_catalog.array_agg(v.value::smallint ORDER BY v.ord) FROM pg_catalog.jsonb_array_elements_text(p_opcoes->'dias') WITH ORDINALITY AS v(value,ord)) ELSE x.dias END,
  inicio=COALESCE((p_opcoes->>'inicio')::time,x.inicio),fim=COALESCE((p_opcoes->>'fim')::time,x.fim),
  proxima_acao_em=COALESCE((p_opcoes->>'inicio_em')::timestamptz,x.proxima_acao_em),revisao=x.revisao+1
 WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha RETURNING x.*;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.editar_configuracao_campanha(uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.editar_configuracao_campanha(uuid,jsonb,jsonb) TO authenticated;
CREATE FUNCTION public.ienvia_editar_configuracao_campanha(p_campanha uuid,p_plano jsonb,p_opcoes jsonb) RETURNS SETOF public.ienvia_campanhas_controle
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM ienvia_private.editar_configuracao_campanha($1,$2,$3); $$;
REVOKE ALL ON FUNCTION public.ienvia_editar_configuracao_campanha(uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_editar_configuracao_campanha(uuid,jsonb,jsonb) TO authenticated;
