-- Um usuário Supabase sem cadastro Ienvia ativo não é autorizado por padrão.
-- Preserva a assinatura e os privilégios da função usada pelas políticas RLS.
CREATE OR REPLACE FUNCTION public.zapia_is_user_active(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT COALESCE((SELECT is_active FROM public.zapia_users WHERE user_id = uid), false);
$function$;
