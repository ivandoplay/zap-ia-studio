# Conexões / Motor — primeira versão de diagnóstico

## Histórico da primeira rodada

Concluir as abas do projeto primeiro. **Banco de dados remoto, GitHub e publicação ficam para depois.** Não aplicar a migração pendente da Visão geral nem interpretar aprovação de tela como autorização para publicar ou operar WhatsApp.

## Entrega inicial de diagnóstico

Nova entrada `/conexoes/`, em `public/v2/connections.html`, integrada à navegação modular. A Visão geral agora aponta para esse diagnóstico. O painel atual continua disponível.

Esta é a **primeira versão de diagnóstico**, não a migração completa dos controles de conexão:

- Estado individual de até três chips, respeitando o plano e a conta acessada.
- Transporte, heartbeat do motor, restrição e entrega apresentados como sinais distintos.
- Bloco Evolution com falha de leitura explícita; não inventa conexão, banimento ou prontidão de executor.
- Motores locais com nome, plataforma, versão, vínculo de chips e heartbeat. Até vinte dispositivos recentes da conta; lista indisponível não é apresentada como lista vazia.
- Estado desatualizado retira a confirmação dos chips e motores. Primeiro erro não fabrica status.
- Tema escuro padrão e opção clara por operador, **somente no navegador nesta etapa**, sem consultar ou escrever na nova tabela de preferências.
- Navegação, menu mobile, busca, suporte e PIN reutilizam a base existente.

**Pareamento, QR/código, desconexão, limpeza de sessão e configuração de IA por chip continuam nos controles atuais.** A nova página não expõe esses comandos. O botão “Abrir controles atuais” é uma navegação explícita para `/painel#dashboard`, não uma operação de conexão. Não declarar a aba inteira concluída até revisar/migrar esses controles e seus contratos.

## Código

- `src/connections/model.js`: DTO limitado e sem campos de pareamento, telefone, segredos ou payload de mensagens. Reaproveita a composição pura da Visão geral.
- `src/connections/router.js`: `GET /api/connections/summary`, com `no-store` e apenas diagnóstico.
- `src/server.js`: contexto autenticado leve compartilhado com a Visão geral, antes de carregar workspace; funciona também no suporte autorizado. Compartilha a leitura local sem inicializar outro motor.
- `public/v2/assets/connections-app.js`: sessão, ciclo de vida, polling visível, cancelamento e troca de contexto.
- `connections-view.js`, `connections.css`: estados e layout próprios.
- `session-client.js`: permite a rota nova, sem acrescentar rota de envio ou conexão.
- `navigation.js`, `view.js`, `shell.js`: links para a nova página e ajuda contextual. A Visão geral foi mantida e testada.
- `vercel.json`: rota/headers preparados em arquivo; nenhuma publicação feita.

## Sem depender de alteração no banco

O código do diagnóstico lê apenas metadados das tabelas já existentes: runtime, slots e dispositivos. Usa filtros por conta, campos explícitos, limites e timeouts. A leitura de status Evolution é somente GET e filtrada por proprietário no servidor.

**Não usa a RPC agregada nova da Visão geral, não cria RPC/tabela/índice, não consulta contatos, mensagens ou workspace.** Nesta rodada, esses acessos foram simulados nos testes; nenhum registro remoto foi consultado pelo agente. Nenhum conector de banco foi usado.

No modo local, usa o estado em memória do motor que atende o painel. Não consulta a Evolution paralelamente nesse modo. Um processo local respondendo não comprova sessão WhatsApp conectada nem executor na nuvem disponível.

Em suporte, operador e alvo continuam separados; pessoa comum não acessa outra conta. A interface nova é somente diagnóstico inclusive para master. Permissões dos controles antigos não foram ampliadas.

## Segurança e controles ainda a revisar nesta mesma aba

Antes de migrar as ações para a interface nova, revisar os contratos de:

1. Escolha explícita de chip e transporte, sem normalizar um chip inválido para Chip 1.
2. Desconexão temporária versus apagar sessão, com confirmação clara e booleanos estritos.
3. Plano, titular, suporte e escolha de dispositivo/executor.
4. IA por chip, sem coerção de strings como `"false"` para verdadeiro.
5. Timeout/resultado incerto de comandos, sem retry automático de ações operacionais.
6. Estados de pareamento e expiração, sem reconectar conta restrita nem abrir socket concorrente para testes.

São itens pendentes de revisão/migração dos controles; não se afirma que foram corrigidos nesta rodada de diagnóstico. Não se inferiu banimento de um 401, não se cadastrou restrição fictícia e não se escolheu um executor de campanha automaticamente.

## Validação

**60/60 testes selecionados passaram**, incluindo os testes da Visão geral, nove casos novos de Conexões, autenticação, ingresso/recibos Evolution e isolamento de treinamento.

Casos novos:

- 3 de modelo: isolamento de chip/plano, redigir dados de pareamento, heartbeat velho/futuro, limite de dispositivos e prontidão/restrição desconhecidas.
- 2 HTTP no servidor real em modo cloud, com serviços externos sintéticos: rota leve sem RPC/workspace, suporte por conta, falha do provedor e ausência de mutação.
- 4 de navegador: chips/fontes separados, mobile/tema/suporte, erro/desatualização/403, contraste básico e 320px.

Uma falha de contraste no aviso do tema claro foi identificada e corrigida antes da rodada final. Dependências de teste foram restauradas do lockfile com scripts de instalação desativados; Chromium e bibliotecas foram instalados somente no ambiente de testes. Não foi adotada nova dependência de runtime.

Log final: `/home/user/auditoria/arquitetura-v2/connections-final-tests.log`.

Não é uma nova execução da suíte completa. O resultado histórico de 312/314 e os dois problemas do ZIP/release assinado permanecem registrados em `VISAO-GERAL-IMPLEMENTADA.md`; não foram declarados resolvidos.

## Prints

Pasta `/home/user/auditoria/arquitetura-v2/previews/conexoes-integrada/`:

- `conexoes-desktop-escuro.png`.
- `conexoes-mobile-escuro.png`.
- `conexoes-mobile-claro-suporte.png`.
- `conexoes-desatualizadas.png`.

São capturas da implementação com **respostas sintéticas**, identificadas na imagem. Não representam o estado atual da conta do titular. Os demais prints dessa pasta são a regressão da Visão geral, não novas páginas entregues.

Nenhum envio, campanha, pareamento, reconexão ou desconexão real foi executado. Nenhum banco remoto foi alterado. Naquela entrega inicial ainda não houve commit, push ou deploy; a revisão visual foi publicada posteriormente em projeto separado.

---

## Rodada seguinte — controles por chip (03/11/2026)

O titular escolheu **concluir Conexões / Motor** antes de abrir outra aba. A autorização de publicação limita-se à branch `review/reforma-visual` e ao projeto estático separado. Banco e aplicativo principal continuam sem alterações remotas.

### Implementado no código funcional

- “Gerenciar este chip”, com conta/chip identificados, foco/modal nativo, fechamento acessível e tema responsivo.
- Nome e IA por chip, lendo uma projeção mínima `settings->waSlots` apenas ao abrir os controles. Valores de IA desconhecidos exigem escolha explícita.
- Transporte escolhido manualmente: motor local ou Evolution; nunca há fallback automático entre eles.
- No painel nuvem, motor escolhido explicitamente entre os dispositivos online daquela conta. Destino offline, estranho à conta ou diferente do dono de uma sessão ativa é rejeitado antes de enfileirar.
- Pareamento por QR ou código alfanumérico de 8 caracteres. QR e código não são confundidos; Evolution pode retornar QR mesmo quando um código foi solicitado.
- Separação real de semânticas: no motor local, **parar** envia `clearSession:false`, **limpar** envia `true`; na Evolution, desconectar faz logout (não é pausa) e remover exclui a instância do chip.
- Checkbox de confirmação para qualquer gravação/operação e digitação `CHIP N` para remoção. Pareamento bloqueado pela interface quando o sinal está conectado, desconhecido, em conflito ou desatualizado.
- Em suporte, os controles, a configuração privada e o pareamento ficam bloqueados também no servidor. Isso vale inclusive para master e para os endpoints legados revisados.
- Chip é obrigatório e estrito; número inválido não é normalizado para Chip 1. Booleanos `clearSession` e `aiEnabled` são estritos na API e no executor.
- POST operacional não renova sessão/reenvia automaticamente em 401, erro de transporte ou 5xx. Erro incerto bloqueia o botão naquela interação e orienta consultar sinais.
- Pareamento enfileirado tem consulta GET pequena, vinculada a usuário + comando `wa_connect` + chip (e dispositivo do comando quando disponível). Uma falha de consulta não cria novo comando. A consulta termina após 25s ou quando a página fica oculta.
- QR/código ficam apenas em memória/DOM, nunca localStorage ou relatórios reais. Exibição limitada a 45s desde a solicitação, podendo expirar antes no WhatsApp; não há renovação automática. Contexto/tela oculta remove a exibição. Removido log legado que incluía telefone e código de pareamento.

### Organização

- `src/connections/controls.js`: contrato compartilhado e projeção privada de pareamento.
- `src/connections/router.js`: configuração mínima e consulta privada de comando, além do diagnóstico.
- `public/v2/assets/connections-controls.js`: UI compartilhada, sem acesso direto a sessão, fetch ou WebSocket; adaptadores fornecidos pelo bootstrap.
- `connections-app.js`: adaptadores autenticados do aplicativo funcional; `session-client.js` impede replay de operações.
- `server.js`, `evolutionApiCloud.js`, `supabaseCloud.js`: validação antes de carregar workspace/operar, vínculo do destino e defesa no executor.
- `review-site/source/review.js`: adaptadores puramente demonstrativos. Nunca importa o bootstrap autenticado. Gerador copia somente a allowlist estática.

### Validação desta rodada

- **76/76 testes selecionados finais**, incluindo contratos, middleware HTTP, worker sintético, browser, auth/Evolution e revisão estática. Log: `/home/user/auditoria/arquitetura-v2/connections-controls-final.log`.
- **334/336 na regressão completa**; permanecem apenas as duas falhas conhecidas: `ienvia-branding.test.mjs` e `static-release-package.test.mjs`, relativas a ZIP/release assinado. Não foram contornadas nem corrigidas nesta aba.
- Testes novos cobrem manutenção versus limpeza, `false` real, cota/slot obrigatório, escolha e pertencimento do motor, suporte, não repetição, privacidade e expiração.
- Não houve operação em WhatsApp real, envio, leitura de registros remotos ou aplicação de SQL.

### Limites explícitos

- O link de revisão demonstra o fluxo: usa QR não gerado/código fictício e alterações somente em memória; não administra a conta real.
- O aplicativo autenticado ainda não foi publicado no projeto principal. Validação real de pareamento/provedor/worker é pendente e depende de autorização específica, sem usar a conta restrita para experimentar.
- Consultas de sinais/configuração são pequenas e não carregam contatos. As mutações continuam reaproveitando os caminhos legados; algumas ainda carregam/recarregam o workspace. Não se afirma que todo esse caminho já foi otimizado.
- Atualizações de settings e metadados do chip não são uma transação única; falha de persistência é apresentada como resultado sem confirmação, não como sucesso nem rollback garantido.
- O painel local não opera Evolution pela tela nova; essa opção exige abrir a conta no painel nuvem. Não são apagados contatos do aplicativo, retomadas campanhas ou escolhidos executores de campanha por esses controles.
- A consulta de pareamento na nuvem depende do contrato das tabelas existentes; testes sintéticos não confirmam o schema remoto nem o funcionamento de um motor antigo.
