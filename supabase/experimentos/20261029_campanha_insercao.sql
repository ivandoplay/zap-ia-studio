-- Evita que INSERT direto contorne o lock da campanha ou edite pessoa iniciada.
-- Experimento: não aplicado em produção.
REVOKE INSERT ON public.ienvia_campanha_checkpoints FROM authenticated;
DROP POLICY ienvia_checkpoint_insert ON public.ienvia_campanha_checkpoints;
CREATE FUNCTION ienvia_private.adicionar_etapas(p_campanha uuid,p_etapas jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE situacao text; quantidade integer;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN 0; END IF;
 SELECT c.status INTO situacao FROM public.ienvia_campanhas_controle AS c
  WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha FOR UPDATE;
 IF NOT FOUND OR situacao='concluida' THEN RETURN 0; END IF;
 IF p_etapas IS NULL OR pg_catalog.jsonb_typeof(p_etapas)<>'array' THEN RAISE EXCEPTION 'Lista de etapas inválida' USING ERRCODE='23514'; END IF;
 IF pg_catalog.jsonb_array_length(p_etapas) NOT BETWEEN 1 AND 2000 OR pg_catalog.length(p_etapas::text)>1000000 THEN RAISE EXCEPTION 'Lista de etapas fora do limite' USING ERRCODE='23514'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_etapas) AS v(e)
   WHERE pg_catalog.jsonb_typeof(v.e) IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(v.e->'destinatario_id') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(v.e->'etapa') IS DISTINCT FROM 'number' OR (v.e-'destinatario_id'-'etapa')<>'{}'::jsonb
      OR (v.e->>'destinatario_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR (v.e->>'etapa') !~ '^([0-9]|[1-9][0-9])$') THEN RAISE EXCEPTION 'Etapa inválida' USING ERRCODE='23514'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_etapas) AS v(e)
   JOIN public.ienvia_campanha_checkpoints AS x ON x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.destinatario_id=(v.e->>'destinatario_id')::uuid
   WHERE x.status<>'pendente' OR x.material IS NOT NULL) THEN RAISE EXCEPTION 'Pessoa já iniciada não pode ser alterada' USING ERRCODE='23514'; END IF;
 INSERT INTO public.ienvia_campanha_checkpoints(owner_id,campanha_id,destinatario_id,etapa)
 SELECT (SELECT auth.uid()),p_campanha,(v.e->>'destinatario_id')::uuid,(v.e->>'etapa')::integer FROM pg_catalog.jsonb_array_elements(p_etapas) AS v(e);
 GET DIAGNOSTICS quantidade = ROW_COUNT;
 IF EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints AS x
   WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.destinatario_id IN
     (SELECT (v.e->>'destinatario_id')::uuid FROM pg_catalog.jsonb_array_elements(p_etapas) AS v(e))
   GROUP BY x.destinatario_id HAVING min(x.etapa)<>0 OR max(x.etapa)+1<>count(*))
 THEN RAISE EXCEPTION 'Etapas devem ser sequenciais desde zero' USING ERRCODE='23514'; END IF;
 RETURN quantidade;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.adicionar_etapas(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.adicionar_etapas(uuid,jsonb) TO authenticated;
CREATE FUNCTION public.ienvia_adicionar_etapas(p_campanha uuid,p_etapas jsonb) RETURNS integer
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT ienvia_private.adicionar_etapas($1,$2); $$;
REVOKE ALL ON FUNCTION public.ienvia_adicionar_etapas(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_adicionar_etapas(uuid,jsonb) TO authenticated;
