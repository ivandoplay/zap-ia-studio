-- Hardening de privilégios no Supabase (aplicado via migration 20261110211514):
-- 1) View public.pag_painel passa a rodar com security_invoker = true e restrita a service_role.
-- 2) RPCs internas *_servico e ienvia_campanha_agenda_vencidas ficam restritas a service_role.

ALTER VIEW public.pag_painel SET (security_invoker = true);
REVOKE ALL ON public.pag_painel FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pag_painel TO service_role;

REVOKE ALL ON FUNCTION public.ienvia_finalizar_exclusao_arquivo_campanha_servico(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_finalizar_exclusao_arquivo_campanha_servico(uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.ienvia_registrar_arquivo_campanha_servico(uuid, uuid, uuid, text, bigint, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_registrar_arquivo_campanha_servico(uuid, uuid, uuid, text, bigint, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.ienvia_campanha_agenda_vencidas(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_campanha_agenda_vencidas(uuid, integer)
  TO service_role;
