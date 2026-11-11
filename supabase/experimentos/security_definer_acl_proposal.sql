-- Hardening aplicado em 2026-11-10 (migration 20261110211514_hardening_pag_painel_e_rpcs_servico.sql).
-- Em PostgreSQL, funções criadas sem REVOKE recebem EXECUTE via PUBLIC (herdada por anon/authenticated).
-- Revogar de PUBLIC, anon e authenticated garante que apenas service_role mantenha EXECUTE.

BEGIN;

REVOKE ALL ON FUNCTION public.ienvia_finalizar_exclusao_arquivo_campanha_servico(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_finalizar_exclusao_arquivo_campanha_servico(uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.ienvia_registrar_arquivo_campanha_servico(uuid, uuid, uuid, text, bigint, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_registrar_arquivo_campanha_servico(uuid, uuid, uuid, text, bigint, text, text)
  TO service_role;

COMMIT;
