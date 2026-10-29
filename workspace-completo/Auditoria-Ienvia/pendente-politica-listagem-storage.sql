-- Mantém o bucket público e a compatibilidade das URLs existentes; restringe
-- apenas a listagem/consulta de metadados aos objetos do usuário autenticado.
-- URLs públicas conhecidas continuam acessíveis sem autenticação; a transição
-- para bucket privado requer migração separada de todos os leitores.
ALTER POLICY "Public read zapia media" ON storage.objects TO authenticated
USING (
  bucket_id = 'zapia-media'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  AND (SELECT public.zapia_is_user_active((SELECT auth.uid())))
);
ALTER POLICY "Public read zapia media" ON storage.objects RENAME TO "Tenant list own zapia media";
