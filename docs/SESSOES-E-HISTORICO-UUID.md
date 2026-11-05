# Sessões adquiridas, ingresso durável e histórico UUID

## Status e limites da entrega

Implementação **local, opt-in, não inicializada nos processos existentes**. Não houve commit, push, deploy, migração remota, pareamento, reconexão ou envio WhatsApp real. Os testes usam UUIDs, identidades, sockets e mensagens sintéticos; SQL é exercitado em PGlite isolado. Isso não homologa PostgreSQL multissessão, Android/Termux, credenciais reais ou disponibilidade contínua.

Esta etapa acrescenta uma porta concreta Baileys sobre **socket já adquirido**, lease persistente, journal privado de entrada, projeção CRM e consultas autenticadas. Não substitui o storage/CRM dos três slots existentes nem importa seu histórico automaticamente. Não fornece rota pública nova de envio.

## Arquivos e fronteiras

| Componente | Responsabilidade |
|---|---|
| `src/instances/baileysSession.js` | Vincular um socket já autenticado a owner/instância/executor/lease; capturar eventos e enviar manualmente uma única vez depois da preparação SQL. |
| `src/instances/baileysEvents.js` | Normalizar JIDs/status com o SDK instalado; preservar eventos privados e distinguir origem de timestamp. |
| `src/instances/ingressJournal.js` | Arquivos privados, lock exclusivo, escrita/fsync/publicação atômica, leitura e confirmação após persistência remota. |
| `src/instances/repository.js` | RPCs explícitas com escopo fixo; não cria cliente nem lê ambiente. |
| `src/instances/history.js` / `public/v2/assets/history-contract.js` | Query e DTOs restritos compartilhados de histórico; nenhuma passagem de wire/capability/campos extras. |
| `src/channels/router.js` | GETs autenticados, sem cache, sem seleção de executor ou conexão. |
| `20261104003000_leases_sessoes_uuid.sql` | Exclusividade, renovação e liberação de lease pelo serviço. |
| `20261104004000_crm_instancias_uuid.sql` | Ingresso, intenção de saída, conversas, mensagens, origens, projeção atômica e leituras autenticadas. |

As migrações dependem das anteriores do catálogo, reconciliação e vínculos. São arquivos locais, não autorização para aplicação em produção. Nenhuma nova dependência foi instalada para esta etapa.

## Lease e contexto

- Identidade: UUID da conta, da instância e do executor; nome livre não comprova telefone.
- A porta recebe o WASocket e callbacks de identidade/conexão do worker. Não cria socket, não lê/copia auth, não conecta/reconecta, não dá logout e não instala heartbeat automático.
- `selfJid` deve ser PN exato do socket adquirido. Referências `ws`/`ev`, self e identidade atual do worker são verificadas nos limites assíncronos; troca de contexto bloqueia o trabalho.
- Assignment e protocolo devem corresponder ao catálogo autorizado. A capability só aparece na primeira aquisição, nunca no claim repetido ou nas respostas HTTP.
- Lease de 45 segundos, renovação explícita pelo serviço. Revisão de assignment invalida a capability anterior; política de envio é revalidada na preparação.
- Reserva iniciada/incerta impede takeover/liberação insegura, mesmo após expiração do lease. Não se usa tempo decorrido como prova de que nada foi enviado.
- `detach` remove os listeners desta porta, mas não fecha o socket, apaga auth ou libera automaticamente o lease. Ciclo de vida e liberação segura pertencem ao futuro worker.

## Saída manual: intenção antes do efeito

1. Runtime durável autoriza propósito manual, configurações, executor, revisões e conexão imediata.
2. Reserva e início no ledger precedem a porta concreta.
3. A porta confere o lease e pré-aloca um ID com o helper do Baileys instalado.
4. `ienvia_prepare_instance_message` confere o digest do pedido, o ledger iniciado e o lease; grava a intenção CRM antes do envio físico. Uma repetição não concede o direito de enviar novamente.
5. Apenas uma chamada `socket.sendMessage`, com `messageId` explícito e prévia de link desabilitada. Não há fila de reconexão nem retry desta operação.
6. O resultado precisa confirmar o ID preparado. ID incompatível, falha ou timeout mantém incerteza, não libera reenvio/takeover.
7. Finalização do ledger e projeção CRM são atômicas no SQL. Falha por provider ID divergente reverte ambas.

**Aceite não significa entrega.** SERVER_ACK instalado é convertido em ack 1; entrega exige DELIVERY_ACK/receipt correspondente. ACK é monotônico. A confirmação de um envio não é prova de leitura.

IA e campanhas novas continuam bloqueadas, mesmo com flags habilitadas, até integração dos coordenadores, claims, pausa humana, opt-out e limites. Não conectar a porta a um socket legado ativo antes de resolver coexistência dos listeners e automações antigas.

## Entrada e recuperação

- Eventos suportados são capturados em journal privado **antes** da RPC de ingestão. O processamento inclui notify/append/history, receipts, deletes, contatos, chats e mapping.
- Apenas depois de recibo persistente verificado se remove a entrada local. DB indisponível preserva o arquivo; autoFlush suspende no erro e exige `flush` explícito para recuperação.
- Commit no banco seguido de perda da confirmação local permite replay idempotente de **ingestão**, sem duplicar mensagem e sem enviar nada.
- Payload e observedAt de um eventId já visto não podem mudar silenciosamente. Eventos são aceitos apenas na janela histórica de seu lease; journal de outro executor não é reassociado automaticamente.
- Diretórios 0700 e arquivos 0600, UID e symlinks verificados, lock exclusivo, fsync de arquivo e diretórios. Lock de crash não é roubado por PID/idade; intervenção manual segura ainda necessária.
- Limites de recursos: 64 MiB de pendências, 1 MiB por arquivo, wire até 900 KiB e lotes limitados. **Não são teto de instâncias**. Cheio/corrupção/falha de journal bloqueiam novos envios e geram diagnóstico sem PII; não se promete armazenamento infinito.
- Durabilidade começa quando o append conclui. Não há transação distribuída com o ACK interno do SDK/provedor: queda antes da captura, falha de disco e lacunas da conexão ainda exigem recuperação/homologação operacional. Não anunciar garantia end-to-end de entrada sem perdas.

## Identidade, dedupe e privacidade

- Conversa PN canônica por conta + self PN exato + peer PN exato. Mesmo cliente observado por instâncias do mesmo negócio pode compartilhar a conversa; todas as origens continuam registradas.
- Conta ou self diferentes não são unidos. LID permanece opaco/provisório, isolado por instância; não inferir número por nome, `remoteJidAlt`, sufixos brasileiros ou semelhança. Mapping fica preservado, não vira prova automática de união.
- Dedupe por conversa + providerMessageId + direção, com origem separada por instância. Conflito não sobrescreve o primeiro corpo silenciosamente; exclusão cria tombstone e histórico tardio não ressuscita o conteúdo na projeção.
- Ocultar CRM não interrompe o ingresso nem apaga dados. CRM, IA e campanhas permanecem políticas independentes.
- View-once/ephemeral retêm somente metadados de chave/timestamp/omissão, sem corpo ou mediaKey. Outras mídias têm metadados/wire privado, sem download automático.
- Contatos/chats/mapping, grupos, tipos desconhecidos e certas edições podem permanecer somente como eventos privados: não há projeção completa de contatos, grupos, edições ou aliases.
- Tombstone suprime conteúdo na leitura, não promete exclusão física de eventos privados anteriores. Retenção, quota global, criptografia operacional e descarte físico precisam de política própria antes da ativação.

## Contratos de leitura

- `GET /api/channels/:instanceId/threads?visibility=visible|hidden|all&limit=1..50&after=<uuid>`
- `GET /api/channels/:instanceId/threads/:threadId/messages` com os mesmos filtros.

Owner vem do contexto autenticado do servidor, nunca de query/body. Suporte master ativo pode ler a conta-alvo; não recebe capacidade de enviar/excluir. UUIDs de instância/conversa/cursor são obrigatórios: slot legado e filtros malformados são rejeitados antes da RPC. Ausência de migração retorna **503**, não um histórico vazio fictício ou fallback para o CRM antigo.

Lista: `historyView: instance_threads`, apenas conversas com origem real na instância selecionada e visibilidade correspondente. Cursor por UUID da conversa. Mensagens: `historyView: canonical_thread`, exige que a conversa esteja ligada à instância selecionada, mas retorna a **conversa canônica unificada**, não só as mensagens daquela instância. Paginação cronológica por `(message_at,id)`; cursor é o UUID de uma mensagem da própria conversa. Visibilidade filtra as mensagens e as origens apresentadas.

O DTO devolve apenas os campos esperados. Raw/wire, ticket, digest e capability nunca são publicados. Por mensagem, a amostra é de até 20 origens, com `originCount` e `originsTruncated` referentes ao filtro de visibilidade; vínculos adicionais continuam armazenados. Até 50 itens por página, sem fixar limite de instâncias. `Cache-Control: no-store, private`; allowlist do cliente de sessão ampliada somente para esses GETs. O bloco inicial de backend não incluía tela. A continuação local de interface está documentada em [Histórico — interface](HISTORICO-INTERFACE.md), sem ativação operacional.

## Verificação do bloco de backend (histórica)

- **88/88 selecionados**, `instance-final-selected.log`: regex `instance-|channels-http|dashboard-http|dashboard-session`.
- **436/438 na suíte completa**, `instance-final-full.log`: somente as duas falhas históricas, `ienvia-branding.test.mjs` (500 vs 200) e `static-release-package.test.mjs` (versão do pacote assinado diferente da anunciada). Não se alterou assinatura para mascarar o problema.
- Casos novos incluem intenção antes do efeito, provider ID divergente/rollback, socket/contexto/offline, erro de envio sem retry/takeover, journal pendente/commit antes do ack local, autoFlush, status do SDK, buffers, omissão de mídia privada, contas/self/LID distintos, múltiplas origens com amostra limitada, canonicalidade e visibilidade, suporte readonly, cursor/payload inválidos e ausência de migração.
- Sintaxe e `git diff --check` verificados. Nenhuma medição de cobertura percentual ou prova multissessão real é declarada.

## Skills e referências aplicadas

`codebase-design`, `tdd`, `sharp-edges`, `error-handling-patterns`, `projection-patterns` e Supabase/PostgreSQL/RLS orientaram as fronteiras, idempotência, projeções e permissões. Revisão final com `differential-review` (incluindo adversarial/reporting e adaptação Ienvia) e `property-based-testing`: invariantes e matrizes de entradas inválidas, **sem suíte gerativa/dependência nova**. Skills não autorizaram plugins, acesso a credenciais, subagentes ou operações externas.

Referências oficiais consultadas: [eventos Baileys](https://baileys.wiki/concepts/events), [JIDs](https://baileys.wiki/concepts/jids), [migração v7](https://baileys.wiki/migration/v7). Helpers, opções de send e enum de ACK foram conferidos no SDK instalado; a tabela da wiki não substitui o enum real.

## Próximo trabalho seguro

1. Interface de leitura preparada localmente na continuação: [HISTORICO-INTERFACE.md](HISTORICO-INTERFACE.md). Ainda precisa das migrações e integração operacional autorizadas para apresentar dados reais da nova base.
2. Planejar/ensaiar bootstrap de worker e auth UUID isolado, heartbeat, recuperação de lock e quotas sem reutilizar diretórios por nome/número.
3. Homologar concorrência em PostgreSQL real isolado e falhas de processo/FS; obter autorização específica antes de qualquer SQL remoto ou WhatsApp real.
4. Ensaiar migração não destrutiva de CRM legado, respeitando vínculos explícitos, tombstones e provas de identidade; coordenar IA/campanhas antes da ativação.
5. Continuar recursos PWA (push/share/validação móvel), sem prometer execução Baileys contínua em background ou proteção antispam.

## Continuação de interface

Tela MPA readonly em `/historico/`, leitor/contrato compartilhado, demonstração estática separada, tratamento de respostas tardias e limpeza de dados ao trocar/perder contexto. **163/163 selecionados e 448/450 completa**, mesmas duas falhas históricas. Os resultados anteriores continuam sendo evidências do bloco de backend; não são os totais finais desta continuação. Sem SQL remoto, publicação ou conexão real.
