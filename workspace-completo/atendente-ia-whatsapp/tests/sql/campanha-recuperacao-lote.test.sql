\set ON_ERROR_STOP on
\ir campanha-prontas.test.sql
\ir ../../supabase/experimentos/20261029_campanha_recuperacao_lote.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
DO $$ DECLARE ids uuid[]; n int; BEGIN
 SELECT array_agg(campanha_id ORDER BY campanha_id) INTO ids FROM (SELECT campanha_id FROM public.ienvia_campanha_recuperaveis LIMIT 2) c;
 IF cardinality(ids)>0 THEN
  SELECT count(*) INTO n FROM public.ienvia_recuperar_lote_campanha(ids);IF n<>cardinality(ids) THEN RAISE EXCEPTION 'não recuperou lote';END IF;
 END IF;
 BEGIN PERFORM public.ienvia_recuperar_lote_campanha(array_fill('11111111-1111-4111-8111-111111111111'::uuid,ARRAY[51]));RAISE EXCEPTION 'limite excedido aceito';EXCEPTION WHEN check_violation THEN NULL;END;
END $$;
RESET ROLE;
