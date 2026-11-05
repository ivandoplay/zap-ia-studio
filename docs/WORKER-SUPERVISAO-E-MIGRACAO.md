# Worker e migração — duas partes, ativação separada

## Decisão de organização

Após a publicação **apenas da revisão demonstrativa**, a continuação operacional foi dividida em dois blocos locais:

1. **Ciclo de vida do worker**: supervisão de uma porta já adquirida, heartbeat, bloqueio por falha/contexto e parada sem reenvio/liberação insegura. Primeira subetapa implementada em `src/instances/workerSupervisor.js`.
2. **Migração não destrutiva**: ensaio/dry-run, vínculos comprovados, preservação de origens/tombstones e reconciliação antes de qualquer mudança de origem de leitura/escrita. Ainda não implementada nesta rodada.

Essa divisão separa risco de execução de risco de transformação de dados. Não mistura inicialização de sessão com importação do CRM e evita chamar demonstração visual de motor pronto. Detalhes técnicos foram delegados pelo titular; nenhuma decisão de produto nova precisou ser devolvida em questionário neste bloco. Questionários ficam reservados para mudanças de comportamento, privacidade ou fluxo ainda não decididas.

## Publicação demonstrativa realizada

- Branch `review/reforma-visual`, commit `0ffa9eaf95c5bac7e340288f2625c373516fe3c7`.
- Projeto separado `ienvia-reforma-visual`, deployment `dpl_A5up9JJBYudhR6BKJzdoNcYVuGsF`, READY/PROMOTED.
- [Histórico publicado](https://ienvia-reforma-visual.vercel.app/historico/).
- 30 arquivos frontend/revisão/testes no commit. Nenhum `src/`, migração SQL, `.env`, configuração Vercel principal ou script operacional foi incluído nesse commit.
- 39 assets publicados conferidos por SHA-256, iguais ao manifesto; HTTP200 em `/historico/`, CSP sem rede, browsers 1440/390 sem erros, sem chamada API ou leitura de sessão.
- Main permanece `7630b62b40b4518d06a157c4dc5055747fcb157e`; deployment principal permanece `dpl_E2HmxAaSGyKxk87bifwNJHsNmy9n`.

O supervisor e o restante do backend continuam **locais, não commitados/publicados/inicializados**. Não houve SQL remoto ou WhatsApp real.

## Interface do supervisor

`createAcquiredSessionSupervisor({ownerId,instanceId,executorId,session,getWorkerIdentity,scheduler,intervalMs,stepTimeoutMs,onFault,now})`

Recebe uma porta Baileys/lease **já adquirida**, não socket cru. Não cria cliente RPC, diretório de auth, socket, processo, reconexão ou login. Não registra automaticamente no executor.

- `port`: porta privada com identidade/lease para `executor.registerLocalSession(instanceId, supervisor.port)`. Não colocar capability em HTTP/UI/log.
- `start()`: ação explícita; confere identidade, faz inspeção e renova o lease antes de permitir novas operações/agendar heartbeat.
- `pulse()`: manutenção serial; chamadas concorrentes compartilham o trabalho. Não envia nem drena automaticamente mensagens pendentes.
- `recover()`: ação explícita, somente no estado blocked. Faz flush de ingresso, exige backlog zerado, inspeciona e renova a **mesma** porta/lease. Falha/expiração não autoriza nova aquisição ou troca de executor.
- `stop()`: terminal. Bloqueia novas operações e cancela o timer; informa pendências conhecidas. Não fecha socket, não desliga captura/IA antiga, não remove journal/auth, não destaca listeners nem libera lease.
- `status()`: estado da supervisão, contadores e aviso `connectedNotAsserted`; não anuncia presença real/online e não contém leaseId.

O construtor não inicia timers ou RPCs. A porta exposta só aceita novas operações em running. Porta e repositório continuam privados do worker; não são API de usuário nem atalho para automações.

## Estados e agendamento

```
idle -> starting -> running
                    | pulse válido -> running
falha/contexto -----+---------------> blocked
blocked -> recover explícito -> recovering -> running ou blocked
qualquer estado -> stop -> stopped (terminal)
```

Heartbeat padrão 10 segundos, configurável entre 5 e 15 segundos; etapa persistente limitada, padrão 4 segundos, máximo 5. Lease continua definido no SQL em 45 segundos. Atraso de processo não fabrica lease: o banco segue autoridade. Após falha, nenhum novo timer de recuperação automática é criado.

Identidade da conta/executor/instância/protocolo e capability da porta são verificadas novamente. Contexto ou lease alterados bloqueiam, inclusive entre awaits. Timer cancelado ou resposta de manutenção tardia não reativam um worker parado. Observador de falha recebe somente código/estado/contador; exceções síncronas e rejeições assíncronas do observador são contidas.

## Semântica de parada e ACK

**Parar não desfaz uma operação já iniciada.** Uma chamada que já entrou na porta pode concluir preparação/envio. `drainRequired` informa envios/manutenção conhecidos em curso; não é prova de que toda chamada remota cancelou ou de que o lease pode ser entregue a outro processo.

Uma confirmação tardia continua para o ledger da operação original, evitando fabricar resultado incerto quando o ACK é conhecido. Se a conta mudou, o executor não devolve o recibo ao novo contexto, mas finaliza o ledger original. Nenhum retry ou resend é iniciado.

Encerramento operacional completo ainda exige composição autorizada: bloquear entradas de novos comandos, acompanhar/reconciliar operações em curso, preservar/confirmar journal, remover listeners desta porta, fechar o journal quando seguro e liberar lease **somente pelas regras SQL**. Não roubar lock ou fabricar ACK para destravar a parada. O supervisor não realiza essa sequência sozinho.

## Limites de confiança e ativação pendente

- O chamador autenticado já detém a porta original e continua uma dependência confiável. A supervisão não torna um objeto JS arbitrário uma sessão autenticada e não substitui os guards SQL/SDK.
- A captura de recebidas pertence à porta original; stop não interrompe intencionalmente o ingresso. Também não garante persistência de eventos recebidos antes do append ou durante falha de disco.
- Sem bootstrap/auth UUID isolado, importação de credenciais, heartbeat de processo público, gerenciamento automático de lock/crash ou encerramento do socket. Tudo isso segue pendente de desenho/homologação.
- Não registrar a porta original diretamente no executor quando se pretende aplicar o gate do supervisor. Usar `supervisor.port`; o objeto não é público.
- IA/campanhas novas seguem bloqueadas; coexistência com automações/listeners antigos não foi homologada.
- Não há novo teto de instâncias ou promessa de conexões simultâneas ilimitadas. CPU, timers, RPC, banco e provedores impõem recursos reais.

## Validação desta rodada

- 16/16 selecionados de frontend/revisão antes de publicar.
- 15/15 no conjunto supervisor + Baileys/SQL sintético: 8 testes de supervisor e 7 da sessão concreta, incluindo a integração nova.
- **172/172 selecionados finais**; **457/459 na completa**, apenas as falhas históricas de branding (500 vs 200) e versão de pacote assinado incompatível.
- Testes de ausência de efeitos no construtor, heartbeat serial, stop durante await, contexto/capability alterados, timeout/retorno tardio, backlog, observador assíncrono, ACK tardio/ledger original e pane de banco com journal preservado/recuperação explícita.
- Fake scheduler, sockets/contas/mensagens sintéticos e PGlite. Não é concorrência PostgreSQL multissessão, prova de queda elétrica, socket real, Termux ou homologação móvel.

Skills consultadas: `codebase-design`, `tdd`, `sharp-edges`, `error-handling-patterns`, `differential-review`. Referências aplicadas com os limites Ienvia, sem plugins, novas dependências de produto, acesso a segredos para teste ou operações WhatsApp.

## Parte 2 — contrato do ensaio de migração

Próximo bloco deve produzir um plano verificável antes de qualquer escrita real:

1. Capturar a estrutura legada em fixtures/export isolado, sem importar manager/storage com efeitos ou ler dados reais para testar.
2. Exigir conta e vínculo legado→instância explícitos; telefone/nome/slot por si só não comprova identidade do negócio.
3. Manter IDs estáveis de origem e idempotência de importação. Não fabricar providerMessageId/ACK de WhatsApp para registros antigos ambíguos.
4. Preservar tombstones, histórico limpo/excluído e políticas independentes. Não ressuscitar contato/mensagem por backfill tardio.
5. Separar o que pode entrar no histórico canônico do que exige quarentena/revisão de identidade; contabilizar ambos, sem descarte silencioso.
6. Gerar contagens, conflitos e amostras redigidas, sem auth/raw/PII em relatório público. Não guardar corpo de view-once/ephemeral como se fosse conteúdo comum.
7. Ensaiar repetição, falha parcial, continuação e reconciliação no banco isolado. Manter o legado como origem operacional até cutover específico autorizado.

Aplicação remota, migração operacional e mudança do backend principal continuam exigindo autorização própria. Não usar a aprovação de demonstração como autorização para essas operações.

## Revisão diferencial delimitada

Baseline de publicação `0ffa9ea`; núcleo novo funcional é o supervisor, com testes unitários e uma integração nova à porta Baileys/SQL sintética. Nenhum bootstrap/runner/HTTP importa o supervisor; portanto não há chamador operacional novo. A alteração de código do worker permanece fora do commit visual. A revisão usou contexto de executor/runtime/porta Baileys e lease SQL como dependências de um salto.

Nenhum achado explorável novo confirmado no recorte, sem equivaler a auditoria independente. Recomendação **condicional para uso local opt-in**; risco residual de ativação permanece alto. O supervisor não controla ator que já possui a porta original, não cancela efeito já iniciado e não garante encerramento de RPC após timeout. Troca de conta/lease, retorno tardio, serialização e callbacks falhos foram ensaiados; pausa real de processo, morte de worker/FS, dois processos PostgreSQL e SDK real continuam fora da evidência.

Não usar status running como prova de online, drainRequired false como licença de takeover, ou recover como autorização de replay de saída. A autorização continua nos guards duráveis e no executor explícito; o novo módulo não enfraquece essas regras. A fronteira entre demonstração publicada e backend não publicado foi reconferida por escopo do commit, hashes remotos, main e deployment principal.
