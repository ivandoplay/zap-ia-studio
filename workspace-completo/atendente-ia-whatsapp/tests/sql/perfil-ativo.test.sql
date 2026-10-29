-- Somente leitura de flags: nenhum nome, mensagem ou dado de conta é retornado.
DO $test$
BEGIN
  IF public.zapia_is_user_active(gen_random_uuid()) THEN
    RAISE EXCEPTION 'Identidade sem perfil não pode ser considerada ativa';
  END IF;
  IF EXISTS (SELECT 1 FROM public.zapia_users u WHERE public.zapia_is_user_active(u.user_id) IS DISTINCT FROM u.is_active) THEN
    RAISE EXCEPTION 'Função diverge da situação dos perfis existentes';
  END IF;
END;
$test$;
SELECT 'OK: perfil ausente negado; status dos perfis preservado' AS resultado;
