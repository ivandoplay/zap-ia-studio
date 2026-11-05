# Campanhas UUID — executor e ciclo local

**Atualizado em 04/11/2026. Entrega local implementada e testada; execução operacional não ativada.**

## Resultado desta etapa

O caminho UUID agora tem execução dedicada, controles persistentes e um ciclo completo comprovado com PostgreSQL embarcado (PGlite), HTTP local, cliente nativo e transportes sintéticos. Não usa a API de slots antigos nem a função de envio manual para contornar permissões de automação.

- Instância fixa ou rodízio por pessoa, mantendo os blocos da mesma pessoa na mesma instância.
- Agenda, janela por dia/fuso, intervalo entre etapas/pessoas, tamanho e pausa de lotes persistentes.
- Iniciar, pausar, cancelar, retomar e pular pausa com revisão/CAS. Retomar não elimina uma cadência futura; pular é uma decisão separada.
- Edição de etapas futuras com a campanha pausada e sem tentativa pendente. A instância da pessoa parcialmente atendida é preservada. Destinatários continuam vindo somente de listas/arquivos.
- Remoção manual das etapas não iniciadas de um destinatário; etapas já aceitas não são desfeitas nem contabilizadas novamente.
- Progresso por sequência completa da pessoa, distinguindo aceite de entrega/leitura.
- Offline bloqueia e sinaliza. Não há troca silenciosa de número, conexão automática ou fila de envio do navegador.
- Intenção, ticket e nonce persistidos antes do transporte. Uma mesma autorização não permite dois envios físicos. O índice do ledger protege também contra outro worker ou envio manual concorrente.
- Timeout mantém a tentativa incerta e o bloqueio físico enquanto a Promise anterior estiver em andamento. Reinício não transforma uma tentativa incerta em reenvio.
- Conferência manual exige revisão, pedido e ticket exatos. Não retoma automaticamente. Aceite tardio depois de “não enviada” exige nova conferência e não permite duplicar o progresso.
- Arquivos privados com caminho/origem restritos, limite de bytes e SHA-256; não aceita URL arbitrária. Arquivo reservado/incerto não pode ser excluído. Voz reaproveita o conversor canônico existente, com verificação Ogg/Opus e PTT próprio por provedor.
- IA coordenada recebe a geração/treinamento já existentes, não cria resposta por palavra-chave nem descadastro automático. A pausa global de Campanhas não equivale a desligar a IA. Resposta comum não pausa a campanha; somente a ocupação transitória da conversa impede concorrência. Incerteza da IA também aparece na conferência.
- Reinício do worker respeita `retomada`: manual pausa execuções existentes; automática mantém o estado seguro, sem liberar tentativas pendentes. O worker só enumera a atribuição que lhe pertence.

## Componentes

| Componente | Arquivo |
|---|---|
| Migração local, gates, ledger, lanes/IA, controles e recuperação | `supabase/migrations/20261104007000_campaign_execution_uuid.sql` |
| Materialização, personalização, mídia, revalidações e execução | `src/campaigns/executor.js` |
| Portas explícitas para sessão já adquirida e Evolution vinculado | `src/campaigns/drivers.js` |
| Download privado e conversor de voz existente | `src/campaigns/media.js` |
| Ponte de proteções existentes e coordenação da IA | `src/campaigns/coordination.js` |
| Polling privado opt-in e política de reinício | `src/campaigns/scheduler.js` |
| Composição no worker autenticado e instalação explícita do handler IA | `src/campaigns/worker.js` |
| Controles HTTP por conta; sem endpoint de envio direto | `src/campaigns/executionRouter.js` |
| Projeção dos runs nos controles familiares da interface | `public/v2/assets/campaigns-execution-client.js` |

A única alteração no módulo de sessão já existente é `withCampaignOperation`: compartilha o mutex/inflight com o envio manual e verifica propriedade/conexão em `try/finally`. Não remove o bloqueio `manual-only` dos executores genéricos, não abre socket e não libera IA/campanhas por aquele caminho.

## Fronteira de ativação — deliberadamente fechada

**Implementação/teste local não significa que o painel em uso já esteja enviando por este caminho.**

1. `createCampaignRouter` mantém `allowWrites=false` e `allowExecution=false` por padrão. A montagem atual do servidor não os habilita. O legado permanece separado; o navegador não dispara o worker ao abrir a tela.
2. A migração cria `enabled`, `global_enabled` e `coordination_ready` desligados. Nenhum SQL remoto foi aplicado. As migrações anteriores e as tabelas de mídia do ambiente real precisam ser homologadas antes da aplicação desta migração.
3. O worker composto exige identidade autenticada, registro/atribuição por UUID, referências concretas já adquiridas, separação comprovada dos motores legados e instalação verificável do handler IA coordenado. Essa composição foi exercitada com callbacks e socket sintéticos; **não foi instalada nos processos operacionais existentes**.
4. Não basta marcar `coordination_ready=true`. O responsável pela ativação deve conectar as portas do worker em uso ao compositor, impedir caminho paralelo legado/IA não coordenado e comprovar a identidade real do número, lease ou binding Evolution. Credencial, nome digitado ou aparência “online” no CRM não são autorização.
5. `createUuidCampaignWorker` não inicia por importação. `start()`/`tick()` exigem opt-in e prontidão. `stop()` cessa novos trabalhos, mas não cancela ficticiamente uma operação física nem restaura automaticamente um handler IA antigo e inseguro.
6. Ativação externa, integração nos processos vivos, teste com conta/número real, publicação e homologação em dispositivo/provedor continuam exigindo autorização específica. Os testes locais não certificam comportamento do WhatsApp real nem impedem bloqueios do provedor.

## Testes e evidências

Executados por `npm test` em cópia descartável, sem `.env`, dados ou sessões reais:

- **34/34 testes novos de execução aprovados**: `npm test -- '^campaigns-execution'`.
- **Suíte geral: 588/590 aprovados**, em aproximadamente 205 segundos. As únicas falhas são as mesmas duas anteriores: `ienvia-branding.test.mjs` e `static-release-package.test.mjs`. Não foram alteradas para produzir um resultado verde.
- Build e verificador da revisão estática: **62 arquivos**, sem functions/runtime APIs.
- Ciclo nativo testado: rascunho → início HTTP explícito → execução sintética → pausa → edição futura → remoção manual → retomada → conclusão; conferência de envio incerto, inclusive aceite tardio, sem endpoint de transporte no navegador.
- Sessão adquirida real do módulo local + SQL, com socket falso: intenção antes do provider, mutex manual/campanha, nonce one-shot e bloqueio de troca de conta/socket.
- Evolution + binding protegido + SQL, com `fetcher` falso: um único POST, recibo remoto e registro CRM/ACK coerentes. Foram testadas respostas sem ID, falso sucesso, offline, ID recriado, duplicação de referência e corpo excessivo.
- IA coordenada, recuperação antes/depois da intenção, geração tardia, limites de mídia, voz, CAS, RLS/papéis, concorrência entre workers, agenda e cadência também cobertos.

Logs em `/home/user/auditoria/arquitetura-v2/`: `campaign-executor-local-final.log`, `campaign-executor-full-suite.log`, logs RED/GREEN e evidência de integridade desta etapa. As validações visuais anteriores continuam sendo da demonstração; o fluxo de execução nativa desta etapa foi testado pelo cliente JavaScript/HTTP/SQL, não homologado em celular físico.

## O que não foi feito

Nenhum commit, push, deploy, alteração do site principal, SQL remoto, geração de QR, conexão/desconexão ou envio real. A demonstração pública anterior permanece na versão já publicada. As configurações e os motores originais de Campanhas não foram substituídos.
