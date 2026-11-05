# Reconciliação auditada e composição de executores por instância

03/11/2026 — **código local opt-in, sem migração remota e sem operação WhatsApp real**.

Continuação de [Catálogo/execução](CATALOGO-EXECUCAO-INSTANCIAS.md). Não há ativação no bootstrap legado ou publicação nesta etapa.

## 1. Reconciliação: distinguir sem inventar confirmação

Novas rotas autenticadas, sem cache:

- `GET /api/channels/:instanceId/dispatches/:requestId`: diagnóstico de um pedido conhecido, escopado pelo dono derivado do contexto autenticado. Suporte/master autorizado pode ler a conta atendida, sem poder revisá-la.
- `POST /api/channels/:instanceId/dispatches/:requestId/review`: aceita somente `{expectedState, reviewId}`. Dono ativo, CAS do estado e identificação idempotente da revisão. Não aceita destinatário, texto, `resend`, ação de liberação ou confirmação digitada pelo operador.

A consulta não altera a reserva. A revisão trava a mesma instância/ledger na mesma ordem usada pelo início e decide dentro da transação:

| Condição real no banco | Ação da revisão |
|---|---|
| Reserva vencida, `state=reserved`, `started_at IS NULL` | Muda para `not_started` e registra `expired_unstarted` |
| `started` ou `uncertain`, independentemente do tempo | Registra `retained_unknown`, mantendo bloqueio |
| Reserva ainda válida | Registra `retained_reservation`, sem liberação |
| Já aceito pelo provedor | Registra `observed_accepted`, sem chamar isso de entrega |
| Não iniciado | Registra `observed_not_started` |

Uma revisão repetida com o mesmo identificador e intenção retorna seu registro anterior; não executa outra ação. Esse registro é uma fotografia da revisão, **não necessariamente o estado atual**: a API pede um novo diagnóstico. Mesmo ID com intenção diferente ou estado esperado obsoleto conflita. ACK tardio segue o caminho privilegiado/ticket de finalização já existente e pode mudar incerteza para aceite; o operador não ganha poder de fabricar ACK.

Migração local `20261104001000_reconciliacao_instancias.sql` cria a trilha de revisões, com ator autenticado, pedido, estado anterior/posterior, ação e data. Não há notas livres, textos de conversa, telefone, ticket ou digest nos DTOs públicos. Tabela sem escrita/leitura direta por navegador ou serviço; RPCs delimitam leitura e revisão. A consulta devolve contagem e última revisão, não uma busca irrestrita de mensagens.

O cliente de sessão reconhece as novas rotas, mas **não renova sessão nem faz replay automático do POST** em 401/falha de rede. Não foi criada tela/botão novo para reenvio ou revisão.

### Limite deliberado

Não existe liberação manual de `started`/`uncertain`. Ausência de mensagem na interface ou passagem do tempo não comprova ausência de envio. Sem ACK ou prova inequívoca de não início, continua a quarentena. A revisão auditável está implementada; uma recuperação excepcional de incertezas sem confirmação continua pendente de desenho/homologação — nunca deve ser transformada em “forçar liberar”.

## 2. Executor opt-in por conta e UUID

`src/instances/executor.js` compõe o runtime e os adaptadores:

- Dono/executor são fixados na construção. Callback obrigatório confirma a identidade **atual** do worker antes/depois de consultas e da execução.
- Registro consulta o catálogo durável: instância habilitada, executor autorizado e transporte exato. Não aceita snapshot fornecido pelo navegador.
- `registerLocalSession(instanceId, session)` recebe uma sessão já adquirida pelo processo autenticado. Não chama conectar, desconectar, fábrica de engines ou seletor de slot.
- `registerEvolutionInstance(instanceId, profile)` resolve o vínculo protegido no repositório, confere revisões e fixa o adaptador. Não descobre conta pelo nome da instância remota.
- `unregister` remove somente referência; operação pendente impede remoção. Não troca sessão silenciosamente. `list` não devolve lease, caminho ou segredo.
- Mudança de conta durante envio impede devolver o recibo à nova conta, mas permite finalizar o ledger da conta original sem repetir o envio.

O teste registra **40 portas de sessão local UUID** sem teto de três. São portas sintéticas, não 40 sockets Baileys abertos.

### Sessão local

`src/instances/localSessionDriver.js` exige `identity` com conta/instância/executor/transporte/protocolo e `leaseId` UUID, `inspect()` somente leitura e `sendManualText()`. O lease é capturado na aquisição: se mudar, a referência antiga não envia. Inspeção atual, identidade e conexão são conferidas novamente antes do envio. As funções da sessão são capturadas; não há substituição silenciosa por mutação de método.

A porta recebe `requireConnectedNow:true` e `returnDispatchReceipt:true`. Sua implementação concreta terá de respeitar esse contrato, incluindo persistência/proveniência no CRM. **Ela não foi implementada pela criação de um novo socket nesta etapa.** O adaptador dos slots existentes continua separado em `legacyLocalDriver.js`.

## 3. Adaptador Evolution explícito

`src/instances/evolutionDriver.js` usa um perfil do serviço fornecido explicitamente: origem HTTPS, chave, namespace do provedor e função `fetcher`. Não lê `.env`, não usa URL/conta padrão nem importa o router Evolution legado.

O perfil é configuração privada do backend, **não corpo de requisição do usuário**. Cada implantação/origem do provedor deve ter um namespace canônico estável compartilhado por suas contas; aliases/perfis não podem ser inventados por tenant para contornar unicidade. Provisionamento desses perfis no worker real ainda não está conectado.

Migração local `20261104002000_vinculos_evolution_instancias.sql`:

- Mapa protegido por conta + UUID da instância, executor/revisão de assignment, revisão CAS própria e namespace/nome/ID do provedor.
- Nome e ID remoto únicos dentro do namespace; o mesmo remoto não pode ser mapeado para outro UUID nesse namespace.
- Somente `service_role` configura/consulta o mapa por RPC; sem acesso direto às tabelas ou configuração pelo navegador.
- Transporte, conta ativa e executor habilitado são revalidados. Operação reservada/iniciada/incerta impede trocar o vínculo.
- Alterar o vínculo invalida o driver já fixado. É preciso remover/registrar explicitamente a referência quando seguro; não existe atualização silenciosa de destino.

Inspeção faz apenas GET de `fetchInstances` filtrado pelo nome protegido e `connectionState` da referência exata. Exige correspondência de nome e ID, sem ambiguidade, conexão aberta e mapa ainda atual. O envio manual revalida e faz um único POST `message/sendText` com número extraído do JID individual já validado. Nenhum `create`, `connect`, `restart`, logout ou delete.

Redirecionamentos são recusados, consultas/POST têm AbortSignal, a leitura do corpo é limitada a 1 MiB e erros de aplicação em HTTP 200 também bloqueiam. Respostas privadas não são devolvidas; apenas ID válido permite aceite, nunca entrega. Sem ID, erro ou timeout: incerteza, sem retry. O ledger permanece a autoridade contra repetição.

### Limites do provedor

A API externa envia pelo nome. A checagem de ID antes do POST reduz risco de nome reciclado, mas **não é uma transação atômica com o provedor**: uma recriação externa entre leitura e envio não pode ser impedida por esses GETs. Antes de ativar, o provisionamento terá de controlar exclusividade dos nomes, perfis e ciclo de vida. Não apresentar a inspeção como garantia absoluta de identidade remota ou disponibilidade contínua.

O nome livre exibido ao usuário é independente do identificador técnico do provedor, que nesta camada usa caracteres seguros de rota. Um telefone digitado continua sem comprovar a identidade WhatsApp.

## 4. Evidências locais

- `npm test -- 'instance-|channels|dashboard-http|dashboard-session|trueclock-whatsapp'`: **78/78**.
- Regressão completa: **406/408**, mesmas duas falhas históricas de pacote/release em `ienvia-branding.test.mjs` e `static-release-package.test.mjs`.
- PGlite aplica as migrações novas junto das anteriores: posse/grants, CAS, quarentena, expiração, auditoria idempotente, revisão obsoleta após ACK, configuração Evolution e unicidade de nome/ID por namespace.
- Integração repositório RPC + SQL + executor + HTTP Evolution sintético: um POST; repetição não envia; rebind invalida driver.
- Isolamento de conta antes/durante inspeção e durante envio, lease alterado, offline, ID remoto divergente, mapa alterado, erro de aplicação em HTTP 200 e corpo excessivo bloqueados.
- Test-first registrado para reconciliação ausente, composição de executor, Evolution ausente, rejeição de ação herdada do protótipo e erro de leitura do provedor em HTTP 200.

Isso não equivale a PostgreSQL multissessão, PostgREST remoto ou teste com WhatsApp. As respostas HTTP são injetadas, todas sintéticas. Não houve envio real nem conexão ao endpoint Evolution configurado no projeto.

## 5. Próximos blocos — ainda não concluídos

1. Implementar a porta concreta Baileys/armazenamento por UUID, migrando sessão e proveniência no CRM sem copiar/reconectar sessões para testar. O legado permanece com três slots.
2. Provisionamento autenticado e exclusivo de workers, leases/perfis/namespaces e bootstrap operacional; homologação PostgreSQL multissessão.
3. Migrar ingestão/CRM/realtime e dedupe para histórico canônico por número verificado dentro da conta, preservando instâncias/origens.
4. Integrar transacionalmente coordenação de IA/campanhas, pausas globais/conversa, claims, opt-out e limites. **Runtime e SQL continuam bloqueando automações**, mesmo com flags ligadas.
5. PWA: Web Push e compartilhamento autenticado seguem pendentes. Não transforma o navegador em executor WhatsApp 24h.

Sem SQL remoto, commit/push ou deploy nesta etapa; arquivos permanecem locais.

## Referências

Skills locais consultadas: `codebase-design`, `tdd`, `sharp-edges`, `error-handling-patterns`, `supabase-postgres-best-practices` e referência de RLS. Sem executar scripts ou instalar skills de terceiros.

Contrato Evolution conferido no código oficial da versão 2.3.7: [rotas de instância](https://raw.githubusercontent.com/EvolutionAPI/evolution-api/2.3.7/src/api/routes/instance.router.ts) e [controller, incluindo connectionState/fetchInstances](https://raw.githubusercontent.com/EvolutionAPI/evolution-api/2.3.7/src/api/controllers/instance.controller.ts). O caminho antigo do site de documentação retornou `not found`; não se inferiu o contrato dessa página. Complemento PostgreSQL/AWS de locks/idempotência permanece registrado no documento do catálogo.
