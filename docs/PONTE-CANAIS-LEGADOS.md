# Migração dos canais — etapa 2A: ponte de identidade

## Escopo e estado

Implementação **local** da ponte entre cada chip antigo e um UUID de canal da mesma conta. Não é a migração completa dos motores, não libera um quarto número operacional, não comprova conexão e não foi aplicada ao banco remoto. O site público continua sendo demonstração.

A limitação a `slot_1`, `slot_2`, `slot_3` nesta ponte descreve exclusivamente as três identidades **antigas** a preservar. Não cria uma cota para os novos cadastros UUID.

## Identidade sem alternativa silenciosa

`src/channels/legacyIdentity.js` é um módulo puro, sem I/O. `storage.normalizeSlotId` e `parseContactChannelKey` agora o utilizam:

- Formatos antigos válidos e as chaves de contato permanecem estáveis.
- Ausência legada de chip mantém o comportamento padrão; **identificador explícito desconhecido não vira Chip 1**.
- UUIDs, `slot_4` e prefixos desconhecidos/ambíguos em conversas são rejeitados.
- Modos explícitos desconhecidos não viram rodízio automático.
- O orquestrador não devolve o motor do Chip 1 quando o motor solicitado não existe.
- O middleware autenticado bloqueia referências do modelo novo em rotas ainda legadas antes de carregar workspace, contatos ou despachar comandos. A rota nova `/api/channels/...` tem contrato próprio.

Mudança intencional de compatibilidade: dados antigos inválidos que eram corrigidos silenciosamente agora podem produzir erro. Não alterar automaticamente os registros nem reclassificar suas conversas. A mudança exige validação de dados antes de uma futura publicação operacional.

## Importação administrativa explícita e repetível

Rascunho SQL: `supabase/migrations/20261103234000_ponte_canais_legados.sql`, dependente do cadastro da etapa 1. Nenhum arquivo foi aplicado remotamente.

`ienvia_legacy_channel_links` associa `(owner_id, legacy_slot_id)` a um único canal. A FK composta impede associação a canal de outra conta. RLS permite ler somente o vínculo próprio, sem expor o snapshot administrativo de origem. Operador e suporte não escrevem diretamente.

`ienvia_import_legacy_channel(owner, slot, config)`:

1. Só pode ser executada pelo papel administrativo `service_role` (ou dono da função em migração controlada), nunca pelo cliente autenticado do painel.
2. Exige conta ativa e os três booleanos de CRM/IA/campanhas explicitamente revisados. Não inventa permissões antigas por default.
3. Cria canal e vínculo na mesma transação. Falhar ao criar o vínculo também reverte a criação do canal.
4. Serializa importações da mesma conta com bloqueio de linha e impõe unicidade de vínculo.
5. Repetir a mesma origem retorna o mesmo UUID sem sobrescrever nome/permissões editados posteriormente.
6. Uma origem divergente recebe conflito em vez de alterar o vínculo.
7. Não altera contatos, mensagens, ACKs, campanhas, nomes de instâncias, sessões ou arquivos de autenticação. Não conecta/desconecta e não envia mensagens.

Não associar canais existentes apenas por nome ou telefone. A revisão de origem e a escolha de conta/transporte precisam ser verificadas antes de executar uma migração autorizada. Este SQL não consulta configurações remotas legadas e não demonstra sozinho que um motor pertence à conta informada.

## Planejamento offline

Exemplo exclusivamente sintético:

```sh
node scripts/plan-legacy-channel-import.mjs docs/examples/legacy-channel-review.synthetic.json
```

O comando somente lê o JSON e escreve um plano. Não carrega `.env`, não se conecta a serviços, não gera sessões e **não possui `--apply`**. Configurações/nomes de clientes reais devem permanecer em arquivo privado, fora do Git. O exemplo versionado usa apenas dados fictícios.

O plano não é uma autorização de execução. Em uma futura aplicação de múltiplos passos, revisar antes e usar transação administrativa; a função é idempotente por vínculo para permitir recuperação controlada de importação parcial.

## Consulta e decisões verificadas

`GET /api/channels/:id/legacy-link` usa o cliente do operador autenticado e o tenant derivado do contexto, nunca um dono aceito do corpo/query. RPC de leitura própria ou de alvo por master ativo. Não carrega workspace/CRM, não expõe snapshot de origem, chave, QR, nome de instância ou caminho de sessão.

- Canal sem vínculo: `unbound`, não Chip 1.
- Vínculo confirmado no cadastro: `legacy_linked`, **não conectado**.
- SQL/RPC ausente: 503 de preparação pendente; não inventa vínculo vazio.
- DTO incompatível com conta/canal/transporte: falha fechada.
- `canPair:false` e `operationalMigrationPending:true` permanecem obrigatórios.

`src/channels/legacyBridge.js` valida e congela snapshots. `resolveLegacyTarget` devolve a identidade completa da conta/canal/chip/transporte, sem chamar motor. A finalidade IA verifica apenas a opção IA; campanhas verifica apenas sua própria opção; ocultar no CRM não impede ingresso ou atendimento manual.

`projectLegacyCrmContacts` aplica a visibilidade por UUID/vínculo legado como uma projeção não destrutiva. Preserva referências/históricos, mantém contatos legados ainda sem mapa visíveis e rejeita identidades conflitantes. **Ainda não está ligado a todos os endpoints/realtime do CRM existente.**

Snapshots não autorizam envios permanentes: uma futura operação deve recarregar a política atual e verificar conta, transporte, posse do executor/dispositivo, revisão e confirmação de capacidade no ponto de despacho. Nunca selecionar o singleton de motor apenas por `legacySlotId`, ignorando o proprietário.

## Validação e limites da evidência

Testes locais em runner isolado: contratos puros, integração com storage e orquestrador sem socket, API HTTP autenticada, suporte, SQL/PGlite, RLS e rollback provocado. O teste SQL mantém marcadores sintéticos de sessão/mensagem/ACK intactos; o teste de motor confirma os mesmos diretórios de autenticação e objetos dos chips existentes.

O bloqueio de linha foi revisado no SQL; PGlite não representa uma prova de concorrência entre múltiplas conexões de PostgreSQL remoto. Não houve teste de sessão real, conexão adicional ou envio real. Assinatura/ZIP do motor continuam com pendências históricas; não foram contornados.

Resultados finais desta rodada serão registrados no relatório de validação após a regressão completa.

## Próximas etapas operacionais

1. Migrar o catálogo/dispatcher de motores para identidades UUID dinâmicas, sem renomear as sessões legadas e com executor explícito por conta.
2. Propagar a identidade para persistência de contatos/mensagens, dedupe, ACK e webhooks.
3. Aplicar visibilidade a listas, detalhes, buscas, contagens e realtime do CRM real, sem interromper a ingestão.
4. Fazer IA, campanhas e mensagens agendadas consumirem a política atual no ponto de execução; preservar proteção contra duplicidade e rate limits.
5. Resolver o pacote legítimo assinado e somente depois planejar publicação/migração/aceite reais autorizados.

### Resultado final

- **82/82** testes selecionados: canais, dashboard/sessão, Conexões e revisão estática (`channels-bridge-final-selected.log`).
- **363/365** na regressão completa final (`channels-bridge-full-final.log`). Permanecem somente `ienvia-branding.test.mjs` e `static-release-package.test.mjs`, falhas históricas de distribuição assinada.
- A primeira regressão identificou que o harness VM do middleware local precisava receber o novo validador importado. O harness passou a usar o validador real e ganhou um teste de rejeição de UUID com PIN/login válidos. A regressão final acima já inclui a correção e os bloqueios de rodízio desconhecido.
- Build/verificação estática: 30 arquivos; sem mudanças no manifesto da revisão visual.
- Sem banco remoto, WhatsApp real, alterações de campanhas, assinatura falsa ou deploy de backend.
