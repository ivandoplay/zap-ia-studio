-- Ensaio reversível: testa listagem, não muda public=true nem bloqueia URLs públicas existentes.
BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER POLICY "Public read zapia media" ON storage.objects TO authenticated
USING (bucket_id = 'zapia-media' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text AND (SELECT public.zapia_is_user_active((SELECT auth.uid()))));
DO $test$
DECLARE actor uuid; actors uuid[]; n bigint;
BEGIN
  SELECT array_agg(user_id) INTO actors FROM (SELECT user_id FROM public.zapia_users WHERE is_active ORDER BY user_id LIMIT 2) x;
  IF array_length(actors,1) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'Duas contas ativas necessárias'; END IF;
  EXECUTE 'SET LOCAL ROLE anon';
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='zapia-media';
  IF n<>0 THEN RAISE EXCEPTION 'Listagem anônima indevida'; END IF;
  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE authenticated';
  FOREACH actor IN ARRAY actors LOOP
    PERFORM set_config('request.jwt.claim.sub',actor::text,true);
    SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='zapia-media' AND (storage.foldername(name))[1] <> actor::text;
    IF n<>0 THEN RAISE EXCEPTION 'Listagem de outro tenant indevida'; END IF;
  END LOOP;
  EXECUTE 'RESET ROLE';
END;
$test$;
ROLLBACK;
SELECT 'OK: listagem anônima e entre contas negadas; ensaio revertido' AS resultado;
