-- Impede que um cliente altere sua própria cota de chips diretamente pela API.
-- Contas e cotas continuam sendo administradas pelo serviço Master (service_role).
-- Preserva o fluxo de login que atualiza last_seen_at e a criação com cota padrão 1.
CREATE OR REPLACE FUNCTION public.prevent_zapia_users_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      IF COALESCE(NEW.role, 'user') <> 'user'
         OR COALESCE(NEW.is_active, true) <> true
         OR COALESCE(NEW.admin_notes, '') <> ''
         OR COALESCE(NEW.max_wa_slots, 1) <> 1 THEN
        RAISE EXCEPTION 'Operacao negada: criacao privilegiada permitida apenas pelo servidor Master.';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.role IS DISTINCT FROM OLD.role
         OR NEW.is_active IS DISTINCT FROM OLD.is_active
         OR NEW.username IS DISTINCT FROM OLD.username
         OR NEW.user_id IS DISTINCT FROM OLD.user_id
         OR NEW.admin_notes IS DISTINCT FROM OLD.admin_notes
         OR NEW.customer_phone IS DISTINCT FROM OLD.customer_phone
         OR NEW.max_wa_slots IS DISTINCT FROM OLD.max_wa_slots THEN
        RAISE EXCEPTION 'Operacao negada: campos administrativos so podem ser alterados pelo servidor Master.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
