# Auditoria de segurança Supabase — 10/11/2026

## Escopo e limites

Auditoria de leitura no projeto Supabase `iuysmojhaxplnhfrxqkv`. Nenhum DDL, grant, policy, dado ou configuração foi alterado no banco remoto. As verificações abaixo usam catálogos PostgreSQL e definições efetivas, não apenas o conteúdo do repositório.

## Achados confirmados

### 1. RPCs internas de arquivos de campanha executáveis por `anon`

As funções abaixo são `SECURITY DEFINER` e têm ACL efetiva com `anon=X`, apesar de o código experimental versionado revogar `PUBLIC` e `authenticated`:

- `public.ienvia_finalizar_exclusao_arquivo_campanha_servico(uuid, uuid)`
- `public.ienvia_registrar_arquivo_campanha_servico(uuid, uuid, uuid, text, bigint, text, text)`

A definição da primeira apaga o arquivo marcado para exclusão com base nos parâmetros `p_owner` e `p_arquivo`, sem validar `auth.uid()`. A segunda também recebe `p_owner` como parâmetro, valida que a conta está ativa e valida a intenção de upload, mas não vincula o chamador autenticado ao proprietário.

**Correção proposta:** revogar explicitamente `EXECUTE` de `anon` nas duas assinaturas e preservar `service_role`. A proposta está em `supabase/experimentos/security_definer_acl_proposal.sql`; ainda não é migration e não foi aplicada. O teste `tests/security-definer-acl-proposal.test.mjs` reproduz a ACL observada e valida a revogação sem remover o acesso de `service_role`.

### 2. View `public.pag_painel` exposta sem invocador seguro

A view permite `SELECT` para `anon` e `authenticated`, não tem a opção `security_invoker` e consulta `pag_sessoes`, `pag_comandos` e `pag_observacoes`. As três tabelas têm RLS habilitado, sem policies, e `anon` não tem SELECT direto nelas.

Views PostgreSQL usam por padrão os privilégios do owner; portanto, neste desenho, a view pode contornar as proteções RLS das tabelas-base. A definição não contém filtro por sessão, proprietário ou segredo.

**Próximo passo seguro:** mapear consumidores externos da view antes de retirar grants ou mudar para `security_invoker = true`. Não foi encontrado consumidor no código indexado do repositório, mas isso não prova que não exista consumidor externo. Por isso, nenhuma alteração à view foi incluída na proposta executável.

### 3. Classificação das 12 funções `SECURITY DEFINER` executáveis por `anon`

A leitura dos catálogos identificou:

- `handle_new_zapia_user()`: função de trigger de criação de usuário; não deve ser removida em lote.
- `ienvia_legacy_import_guard(uuid)`: verifica `auth.uid()`, igualdade com o owner e conta ativa.
- As duas RPCs internas de campanha descritas no item 1: exposição não intencional a corrigir.
- Oito funções `pag_*`: recebem segredo como parâmetro e fazem parte do fluxo de integração de página. Devem ser revisadas individualmente como endpoints autenticados por segredo, não revogadas indiscriminadamente.

O total de funções `SECURITY DEFINER` em `public` foi 139; 12 eram executáveis por `anon` e 72 por `authenticated`. A contagem não significa que todas sejam vulneráveis.

## Por que ainda não foi criado um ambiente Supabase completo

- O repositório não contém `supabase/config.toml`.
- O histórico remoto tem 33 migrações; a branch contém 29 arquivos em `supabase/migrations`.
- `supabase/applied/README.md` registra que alguns arquivos locais são propostas/rascunhos e que parte do estado remoto foi aplicada em pedaços. Há, portanto, divergência entre histórico remoto, arquivos locais e estado aplicado.
- Executar `supabase db reset` com todas as migrações locais não reproduziria o banco atual com fidelidade e poderia falhar por dependências de objetos-base ausentes.

A branch já usa `@electric-sql/pglite` nos testes. Para este primeiro passo, foi escolhido um laboratório PostgreSQL embarcado, sem credenciais ou conexão com produção. Isso valida a semântica da ACL proposta, mas **não substitui** uma réplica integral do projeto Supabase.

## Próximos passos

1. Confirmar consumidores da view `pag_painel` (incluindo extensões/serviços externos).
2. Conferir a função `pag_sessao_id` e os contratos dos oito endpoints `pag_*`.
3. Mapear os 72 privilégios de `authenticated` por assinatura, chamador e verificação de autorização.
4. Reconciliar as 33 migrações remotas com os 29 arquivos locais antes de inicializar uma stack Supabase local.
5. Após revisão, converter a proposta de ACL em migration gerada pela Supabase CLI e testá-la em ambiente descartável.

## Referência técnica

A documentação Supabase explica que views ignoram RLS por padrão e recomenda `security_invoker = true` no PostgreSQL 15+, ou revogar o acesso a `anon`/`authenticated` quando a view não deve ser pública.
