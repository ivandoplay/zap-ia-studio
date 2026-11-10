-- PROPOSTA DE HARDENING — NÃO APLICAR DIRETAMENTE À PRODUÇÃO.
-- Auditoria somente leitura em 2026-11-10 confirmou ACL explícita para anon
-- nas duas RPCs abaixo. service_role mantém EXECUTE após estas revogações.
-- Aplicar somente por uma migration revisada, depois de validar consumidores.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.ienvia_finalizar_exclusao_arquivo_campanha_servico(uuid, uuid)
  FROM anon;

REVOKE EXECUTE ON FUNCTION public.ienvia_registrar_arquivo_campanha_servico(uuid, uuid, uuid, text, bigint, text, text)
  FROM anon;

COMMIT;
