# Catálogo e execução explícita por instância — etapa local

Atualização: 03/11/2026. **Implementado e testado localmente; não publicado e sem migrações remotas.** A revisão visual anterior não muda nesta etapa.

## Decisões preservadas

- Instância é um UUID com nome livre; telefone no nome é opcional. Não se usa número como chave de escolha de motor.
- Catálogo sem teto numérico fixo. Os testes registram 48 referências no runtime e 40 vínculos no SQL. Isso não comprova 48 conexões WhatsApp simultâneas nem remove os três slots dos motores antigos.
- Conta, instância, executor e transporte têm de corresponder. Não existe fallback para Chip 1, outro executor, rodízio ou Evolution/local alternativo.
- Offline: bloquear e avisar. Nada é colocado em fila nova, reconectado ou reenviado automaticamente.
- CRM, IA e campanhas continuam políticas independentes. `crmVisible:false` não impede envio manual e não apaga histórico. Este módulo não modifica ingestão ou dedupe de contatos.

## Módulos e fronteiras

- `src/instances/contracts.js`: valida UUIDs, snapshot de autorização e pedido explícito com revisões, finalidade, destinatário individual e texto. DTO por allowlist; não devolve caminhos de sessão, credenciais ou dados extras do banco.
- `src/instances/runtime.js`: catálogo de referências, attach/detach sem abrir/fechar sockets; execução manual com inspeção recente, revisão de configuração e ledger obrigatório. Sem repositório completo, falha na construção. A fixture em memória é **exclusivamente de teste**.
- `src/instances/repository.js`: implementação RPC real para cliente Supabase privilegiado explicitamente injetado pelo backend/worker autenticado. Conta/executor fixados na construção, signal de prazo e erros sanitizados. Não lê `.env`, não descobre clientes nem implementa fallback/retry.
- `src/instances/legacyLocalDriver.js`: adaptador opt-in para uma referência de engine já existente, vínculo previamente validado e callback obrigatório de identidade atual do worker. Não chama `getSlot`, não cria sessão e não infere posse a partir de nome/telefone. Rejeita mudança de conta/executor/slot e finalidades automáticas.
- `src/whatsappManager.js`: duas opções opt-in em `sendManualOwnerMessage`: `requireConnectedNow` rejeita desconectado antes da espera legada; `returnDispatchReceipt` devolve aceite/ID do provedor. Chamadas antigas continuam com a espera e retorno booleano anteriores. Não houve conexão real para testar.
- `GET /api/channels/:id/execution`: consulta autenticada somente leitura, dono derivado da sessão/suporte autorizado, sem cache. O caminho interno `channels` é compatibilidade; o domínio visível continua Instâncias. Devolve vínculo configurado, desabilitado ou ausente, **nunca presume conexão**. `canDispatch:false`, `canPair:false` e `connection.status:not_verified` permanecem explícitos. Não há endpoint novo de envio.

**Não há bootstrap desses drivers no servidor/worker existente.** Nenhuma seleção de envio antiga foi redirecionada para o runtime novo. Injetar um callback fictício de identidade não é integração operacional: a implantação futura terá de vinculá-lo ao contexto autenticado real do worker e à sessão exata.

## Persistência e idempotência

Migração local `20261103235000_catalogo_execucao_instancias.sql`, dependente de `233000` e `234000`:

1. Executores com dono/transporte/protocolo; registro apenas por `service_role`.
2. Vínculo instância → executor por conta, FKs compostas, revisão CAS e transporte compatível. Dono ativo configura seu vínculo; suporte não ganha escrita na conta atendida.
3. Ledger durável com chave `(owner_id, request_id)`, hash SHA-256 da intenção normalizada pelo contrato e snapshot das revisões/finalidade. Não contém corpo da mensagem ou destinatário em colunas próprias. O hash **não é criptografia do histórico**.
4. Reserva com ticket exclusivo; duplicata retorna resultado sem novo ticket. Mesmo ID com intenção diferente conflita.
5. Índice único por instância em `reserved`, `started` ou `uncertain`: exclusão entre processos que compartilhem esse banco, não apenas `Map` local.
6. Início revalida dono ativo, executor, transporte, políticas e revisões dentro da transação. Aceite final exige `started_at`; ninguém converte mera reserva em aceite.
7. Reserva nunca iniciada vence em 30 segundos e pode ser marcada `not_started` na próxima tentativa de reserva/alteração de vínculo. `started` e `uncertain` **não expiram para liberar envio**.
8. RLS e grants: sem escrita direta nas tabelas por clientes usuais; ledger não é legível pelo navegador. RPCs de reserva/início/finalização restritas ao serviço. Master ativo tem somente leitura de snapshot de outra conta pela RPC autorizada.

Banco e chamada externa não são uma transação distribuída: uma alteração feita após o início não cancela um envio já em andamento. O desenho favorece não duplicar, mesmo que isso mantenha uma instância indisponível até reconciliação.

## Prazo, erro e confirmação tardia

Inspeção é somente leitura. Inspeção e cada porta do repositório têm prazo no runtime; o RPC também recebe AbortSignal. Timeout não prova rollback do banco. Se o início não foi confirmado, este processo não chama o driver, tenta marcar incerteza e não reaproveita automaticamente o pedido.

Após iniciar o driver, timeout devolve `uncertain`, mantém o bloqueio local enquanto a chamada está viva e tenta preservar quarentena no banco. Um resultado tardio válido pode reconciliar o ledger para `accepted` sem chamar o driver de novo. Se a finalização se perde, o estado durável iniciado/incerto continua bloqueando novo pedido após reinício.

`accepted` significa **aceito pelo provedor**, não entregue nem lido. Os recibos mantêm `delivered:false`, `queued:false`, `canRetryAutomatically:false`. Falhas privadas de transporte/SQL não são colocadas no recibo.

## IA e campanhas: deliberadamente bloqueadas

Flags desligadas geram os bloqueios específicos. Mesmo ligadas, runtime e SQL novo recusam automação (`AUTOMATION_INTEGRATION_PENDING` / SQLSTATE `0A000`). Falta integrar atomicamente pausas globais, opt-out, claims/reservas, limites e coordenação de conversa/campanha. Não se reutiliza envio manual para simular campanha ou IA. O adaptador local anuncia apenas `manual`.

## Validação e limites

Rodar somente com `npm test -- 'instance-|channels|dashboard-http|dashboard-session|trueclock-whatsapp'`: o runner faz cópia descartável, retira credenciais/sessões e usa dados sintéticos.

A bateria selecionada passou **63/63**: catálogo, validação de posse/transportes, RLS/grants, CAS, ticket, expiração, quarentena, aceite sem início proibido, ACK tardio, reinício, concorrência de runtimes, timeout de inspeção/portas, capabilities, flags, SQL com automação habilitada ainda bloqueada, adaptador exato e preservação do retorno legado. HTTP integrado confirma erro de migração ausente sem carregar contatos/executar motor.

Regressão completa: **391/393**, com as duas falhas históricas em `ienvia-branding.test.mjs` e `static-release-package.test.mjs`, ligadas ao pacote/release assinado e já existentes antes desta etapa. Não foram contornadas com alteração de assinatura ou versão. `git diff --check` sem erros.

SQL executado apenas em PGlite local. Concorrência de dois runtimes com ledger compartilhado é teste de integração local, **não** benchmark nem teste de múltiplas sessões PostgreSQL/PostgREST em produção. Nenhum banco remoto, conta real, destinatário real, socket, pareamento ou campanha foi usado.

### Pendências operacionais

- Revisão auditada implementada na continuação, sem liberar incertezas. Recuperação excepcional sem ACK ainda não é permitida.
- Bootstrap autenticado e isolamento real de processos/sessões para engines dinâmicos. Adaptador Evolution opt-in implementado na continuação, ainda não ativado.
- Claims/limites/pausas de IA/campanhas e conversa canônica por número **verificado**/mesma conta, com origens/dedupe e IA coordenada.
- Ingestão/CRM/realtime ainda não consomem automaticamente os vínculos novos.
- Homologação PostgreSQL real multissessão e análise de permissões/implantação antes de qualquer migração autorizada.
- PWA Web Push, notificações com app fechado e compartilhamento autenticado continuam pendentes da etapa móvel anterior.

## Referências consultadas

Skills locais pertinentes: `codebase-design`, `tdd`, `sharp-edges`, `error-handling-patterns`, `supabase-postgres-best-practices` e segurança. O fluxo test-first foi registrado nos logs do catálogo, dispatcher e prazo da inspeção; os demais testes de integração verificam a implementação e não são apresentados como ciclos RED independentes.

Complemento oficial, sem instalar código externo: [PostgreSQL 17 — Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html), para locks por linha/ordem/transações curtas; [AWS Builders’ Library — Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/), para token associado à intenção e rejeição de parâmetros diferentes. Não se aplicam recomendações genéricas de retry a envio incerto.


## Continuação validada

[Reconciliação e executores](RECONCILIACAO-E-EXECUTORES.md) registra revisão auditada, composição opt-in do worker, porta de sessão local UUID/lease e adaptador Evolution com mapa protegido. Validação atual: **78/78 selecionados; 406/408 completa**, mesmas falhas históricas. O registro anterior de 63/63 e 391/393 é a evidência da etapa inicial. Nenhuma conexão dinâmica real ou automação foi liberada.
