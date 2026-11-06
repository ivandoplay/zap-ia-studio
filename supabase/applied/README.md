# Migrações aplicadas no projeto Supabase `iuysmojhaxplnhfrxqkv`

Este diretório registra o que realmente está no banco. É a fonte de verdade em caso de
divergência com os comentários `-- RASCUNHO LOCAL` / `-- PROPOSTA LOCAL` que aparecem no topo
de alguns arquivos em `supabase/migrations/`.

## Estado em 05/11/2026

Aplicadas (verificadas por `information_schema` e `pg_proc`, não por comentário de arquivo):

| Versão no histórico | Objetos principais |
|---|---|
| `20261106011248 ponte_canais_legados` | `ienvia_legacy_channel_links`, `ienvia_import_legacy_channel`, `ienvia_get_channel_legacy_link` |
| `20261106011331 catalogo_execucao_instancias` | `ienvia_instance_executors`, `_assignments`, `_dispatches`, 8 funções |
| `20261106011344 leases_sessoes_uuid` | `ienvia_instance_session_leases`, 5 funções de lease |
| `20261106011357 reconciliacao_instancias` | `ienvia_instance_dispatch_reviews`, `ienvia_get_instance_dispatch`, `ienvia_review_instance_dispatch` |
| `20261106011407 vinculos_evolution_instancias` | `ienvia_instance_evolution_bindings`, `ienvia_bind_evolution_instance`, `ienvia_executor_evolution_binding` |
| `20261106011454 crm_instancias_uuid` | `ienvia_instance_threads`, `_ingress`, `_messages`, `_message_origins`, `ienvia_read_instance_thread`, `ienvia_list_instance_threads`, `ienvia_read_instance_channel_thread`, `ienvia_ingest_instance_event`, `ienvia_prepare_instance_message` |
| `crm_contacts_profiles_prep_remove_stale_helpers` | remove 4 funções órfãs herdadas (`ienvia_crm_assert_writer`, `ienvia_crm_assert_reader`, `ienvia_crm_can_write`, `ienvia_crm_apply_profile`) que colidiam por assinatura |
| `crm_contacts_profiles` (`20261104005000`) | `ienvia_crm_contacts`, `ienvia_crm_changes`, `ienvia_crm_write_accounts` + 10 RPCs |
| `crm_documento_busca` (`20261104008000`) | `docNumber` no perfil, busca documental, `documentFieldSupported` |
| `crm_quick_reply_library` (`20261104010000`) | `ienvia_crm_quick_libraries`, `ienvia_crm_quick_changes`, `ienvia_crm_get_quick_replies`, `ienvia_crm_mutate_quick_replies` |
| `crm_tag_library` (`20261104011000`) | `ienvia_crm_get_tags`, `ienvia_crm_mutate_tags` (cascata agora em `ienvia_crm_contacts`, não em `zapia_contacts`) |
| `crm_thread_profiles_projection` (`20261104009000`) | `ienvia_list_instance_threads_crm` (threads + ficha salva na mesma página) |

`ienvia_crm_tag_libraries` e `ienvia_crm_tag_changes` já existiam antes desta rodada.

Todas foram executadas em pedaços pelo endpoint de SQL do projeto. A reexecução idempotente
completa precisa de uma credencial de Postgres direto (`psql`), que não está no cofre.

## Ainda não aplicado

- `20261104006000_campaign_drafts_uuid.sql` (≈21 KB)
- `20261104007000_campaign_execution_uuid.sql` (≈70 KB, depende de 06000)

## Aviso de design preservado

`ienvia_reserve_instance_dispatch` e `ienvia_start_instance_dispatch` lançam
`0A000 'Coordenador de automação ainda não integrado'` para `purpose <> 'manual'`.
IA e campanhas por instância UUID ainda não podem disparar até o coordenador existir.

## Escrita CRM

`ienvia_crm_write_accounts` é criada **vazia**. Nenhuma conta está homologada para escrever:
`ienvia_crm_can_write()` devolve `false` e qualquer RPC de escrita responde
`55000 CRM_WRITES_DISABLED`. Leitura de fichas, etiquetas e atalhos funciona normalmente.
