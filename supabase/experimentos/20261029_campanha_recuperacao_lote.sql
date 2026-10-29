-- Recupera até 50 campanhas sob locks em ordem estável, para reduzir round trips.
CREATE FUNCTION ienvia_private.recuperar_lote_campanha(p_campanhas uuid[])
RETURNS TABLE(owner_id uuid,campanha_id uuid,status text,revisao bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE id uuid;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 IF p_campanhas IS NULL OR pg_catalog.cardinality(p_campanhas) NOT BETWEEN 1 AND 50 OR pg_catalog.array_position(p_campanhas,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Lote inválido' USING ERRCODE='23514'; END IF;
 FOR id IN SELECT DISTINCT u.id FROM pg_catalog.unnest(p_campanhas) AS u(id) ORDER BY u.id LOOP
  RETURN QUERY SELECT c.owner_id,c.campanha_id,c.status,c.revisao FROM ienvia_private.recuperar_campanha(id) c;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.recuperar_lote_campanha(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.recuperar_lote_campanha(uuid[]) TO authenticated;
CREATE FUNCTION public.ienvia_recuperar_lote_campanha(p_campanhas uuid[]) RETURNS TABLE(owner_id uuid,campanha_id uuid,status text,revisao bigint)
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM ienvia_private.recuperar_lote_campanha($1); $$;
REVOKE ALL ON FUNCTION public.ienvia_recuperar_lote_campanha(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_recuperar_lote_campanha(uuid[]) TO authenticated;
