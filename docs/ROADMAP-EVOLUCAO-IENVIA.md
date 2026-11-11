# Ienvia — Roadmap de evolução do produto

> Documento de planejamento baseado na leitura do painel, CSS, JavaScript do cliente e rotas Express existentes na branch `feat/modernizacao-painel-oficial`.
>
> **Regra de entrega:** preservar o projeto Vercel oficial, o runtime Express, Supabase, autenticação, integrações e contratos existentes. Toda mudança deve passar por branch/Preview e validação antes de qualquer merge ou promoção para produção.

## 1. Diagnóstico confirmado do estado atual

### Interface e navegação
- O painel principal está em `public/painel.html`, servido pelo projeto oficial.
- Os estilos atuais estão distribuídos entre `public/styles.css`, `public/campanhas.css`, `public/utilities.css`, `public/skeleton.css` e a camada incremental `public/modernizacao-visual.css`.
- A navegação possui 14 painéis identificados: dashboard, CRM, campanhas, treinamento, catálogo, áudios, simulador, IA, instâncias, conexões, histórico, configurações, segurança e contas.
- Os 14 destinos encontrados possuem correspondência entre navegação e painel. O destino Contas é sujeito às permissões de administrador.
- O JavaScript de interface está concentrado em `public/app.js` (arquivo extenso, aproximadamente 466 KB no momento da auditoria).
- A alternância manual de tema já existe e usa `data-theme="light"` no elemento raiz; a ausência do atributo representa o tema escuro.
- O dashboard já possui saudação/relógio, faixa de prontidão, KPIs e controles rápidos alimentados pelo estado do painel e pela API de campanhas.
- Os atalhos dos KPIs de conexões e mensagens foram alinhados às áreas de Instâncias e Histórico, evitando encaminhar usuários comuns para Clientes SaaS (área administrativa).
- A busca rápida global (Ctrl+K) já existe e pesquisa destinos, contatos, mensagens aprovadas e áudios; nesta etapa sua lista de destinos foi ampliada para cobrir todas as abas acessíveis e seu visual foi refinado.
- A navegação móvel antiga contém elementos e listeners que devem ser mantidos compatíveis até que cada dependência seja migrada e testada.

### Backend e integrações
- O projeto continua usando Express em `src/server.js`, com adaptador Vercel em `api/index.js`.
- Foram identificadas 132 declarações de rotas Express no arquivo principal do servidor durante a auditoria estática.
- Existem contratos para autenticação, campanhas, contatos/CRM, conversas, mensagens, tarefas, notas internas, respostas sugeridas, configurações, IA, treinamento, catálogo/PIX, conexões WhatsApp, sincronização de histórico, filas e administração.
- O repositório declara Node.js 24.x e scripts de teste em `package.json`.
- O projeto Supabase e os serviços Evolution/WhatsApp devem continuar sendo tratados como dependências existentes, sem migração estrutural nesta modernização.

### Limites da auditoria
- A contagem de rotas é uma leitura estática das declarações Express encontradas, não uma prova de que cada rota está funcional em produção.
- Não foram executados testes end-to-end autenticados, testes com instância WhatsApp real, teste de carga, auditoria de segurança dinâmica ou validação manual em todos os dispositivos.
- Recursos que já existem parcialmente devem ser verificados antes de qualquer implementação paralela.

## 2. Princípios de produto e engenharia

1. **Uma única fonte da verdade:** o painel oficial continua no projeto Vercel atual.
2. **Preservar comportamento:** não renomear IDs, contratos, eventos, atributos `data-*` ou endpoints sem uma migração comprovadamente compatível.
3. **Melhorar antes de duplicar:** procurar recursos existentes antes de criar módulos ou tabelas novas.
4. **Controle explícito:** estados de conexão, filas, campanhas, agentes e permissões precisam ser claros e auditáveis.
5. **Transparência operacional:** não simular métricas, status, automações ou eventos; exibir dados reais e indicar indisponibilidade.
6. **Desktop e mobile equivalentes:** nenhuma função essencial deve depender exclusivamente de hover ou de uma tela larga.
7. **Acessibilidade:** foco visível, navegação por teclado, nomes acessíveis, contraste e respeito a `prefers-reduced-motion`.
8. **Entrega reversível:** commits pequenos, Preview por etapa e plano de rollback.
9. **Segurança por padrão:** operações de envio, exclusão, ativação, pareamento e administração continuam sujeitas às permissões e confirmações atuais.

## 3. Roadmap priorizado

### Fase 0 — Fundação visual e homologação
**Objetivo:** concluir a modernização do shell e tornar a navegação consistente.

- Finalizar sidebar agrupada e drawer móvel.
- Revisar estados ativo, hover, foco, carregamento, vazio, erro e desabilitado.
- Harmonizar tema claro/escuro com a paleta verde/grafite existente.
- Refinar hierarquia do dashboard, cabeçalho operacional, cartões KPI e ações em telas pequenas.
- Revisar tabelas, formulários, modais, dropdowns, toasts, skeletons e estados vazios.
- Melhorar responsividade das telas de maior densidade (Inbox, CRM, campanhas e configurações).
- Refinar a paleta de comandos existente e disponibilizar todos os destinos autorizados.
- Verificar que os controles de navegação antiga continuam compatíveis enquanto a migração não estiver concluída.

**Critérios de aceite:** todos os 14 destinos abrem; sidebar funciona por toque e teclado; tema claro/escuro não perde legibilidade; nenhum controle essencial fica coberto pela navegação móvel; sem regressão funcional conhecida.

### Fase 1 — Dashboard como centro de comando
**Objetivo:** mostrar a situação operacional real sem inventar indicadores.

- Organizar métricas existentes por atendimento, vendas, campanhas e conexões.
- Dar destaque a itens que exigem ação: conexão desconectada, fila parada, falha recente ou atendimento pendente, quando esses dados estiverem disponíveis.
- Criar uma área de atividade recente apenas a partir de eventos reais já registrados.
- Oferecer atalhos para ações frequentes respeitando as permissões.
- Identificar claramente período, origem e horário de atualização dos indicadores.

**Critério de aceite:** cada KPI possui fonte identificável, estado de carregamento/erro/vazio e não apresenta números fictícios.

### Fase 2 — Inbox e CRM
**Objetivo:** reduzir o tempo entre receber uma mensagem e resolver a oportunidade.

- Refinar lista de conversas, filtros, busca, prioridade e não lidas.
- Tornar o contexto do contato mais útil sem esconder a conversa.
- Melhorar histórico, notas internas, tarefas, etiquetas e responsáveis onde o backend já oferecer suporte.
- Melhorar estados de envio, falha, envio pendente, agendamento e sincronização.
- Tornar o layout de três colunas adaptável ao celular, com navegação clara entre lista, conversa e detalhes.
- Avaliar pesquisa global de contatos/conversas sem duplicar o diretório existente.

**Critério de aceite:** histórico não se perde ao navegar; paginação e atualização em tempo real não duplicam mensagens; ações respeitam permissões e estados do backend.

### Fase 3 — Campanhas e operação de mensagens
**Objetivo:** dar previsibilidade e controle às campanhas.

- Melhorar criação/edição, revisão de destinatários e pré-visualização.
- Mostrar claramente rascunho, agendada, em execução, pausada, concluída e falha, conforme estados reais.
- Exibir progresso, fila e erros com possibilidade de investigação.
- Destacar confirmação antes de operações de envio e ações em lote.
- Melhorar biblioteca de arquivos, pastas e importação sem alterar o contrato atual.

**Critério de aceite:** nenhuma ação de disparo é iniciada por simples navegação; contagens e estados vêm do backend; falhas ficam visíveis e explicáveis.

### Fase 4 — Central de IA
**Objetivo:** tornar configuração, treinamento e avaliação da IA compreensíveis.

- Organizar agentes, instruções, conhecimento, treinamento, áudio e catálogo em uma experiência coerente.
- Melhorar o simulador para testar cenários sem afetar clientes reais.
- Exibir versão/configuração ativa, estado de publicação e última atualização quando houver fonte confiável.
- Criar comparação de respostas e avaliação de qualidade somente quando houver dados e critérios reais.
- Planejar um construtor visual de fluxos após inventariar gatilhos, ações e capacidades já disponíveis no backend.

**Critério de aceite:** testes são isolados de conversas reais; alterações em produção exigem ação explícita; cada informação de estado possui fonte verificável.

### Fase 5 — Observabilidade e segurança
**Objetivo:** dar visibilidade operacional sem expor segredos.

- Consolidar saúde de serviços, conexões e filas com base em verificações reais.
- Melhorar pesquisa e filtros de logs/eventos, removendo tokens e dados sensíveis das visualizações.
- Criar alertas de falha com deduplicação e histórico.
- Melhorar a clareza de permissões, sessões e ações administrativas.
- Registrar operações críticas quando o backend oferecer auditoria confiável.

**Critério de aceite:** nenhum segredo aparece em logs/UI; estados desconhecidos são mostrados como desconhecidos, não como saudáveis; alertas apontam origem e horário.

### Fase 6 — Produtividade e personalização
**Objetivo:** acelerar o uso diário.

- Busca global com atalho de teclado, se a busca atual não cobrir os mesmos domínios.
- Comandos rápidos para navegar e abrir ações permitidas.
- Favoritos e atalhos.
- Preferências de densidade e organização do dashboard.
- Exportações e relatórios apenas para dados e formatos já suportados.
- Central de ajuda contextual e onboarding progressivo.

**Critério de aceite:** atalhos funcionam também com leitor de tela e não interceptam digitação em campos; preferências são persistidas de modo compatível com a arquitetura atual.

## 4. Itens a investigar antes de desenvolver

- Quais métricas de dashboard já existem e de quais endpoints vêm.
- Se há eventos persistidos suficientes para uma timeline operacional.
- Quais estados de fila e conexão são confiáveis em tempo real.
- Quais papéis e permissões existem de fato no backend.
- Quais filtros e buscas do CRM podem ser reaproveitados.
- Se há dados suficientes para relatórios de conversão sem criar métricas enganosas.
- Quais operações de campanha e IA já têm confirmação e trilha de auditoria.
- Quais eventos/logs podem ser exibidos com segurança.

## 5. Plano de validação por entrega

Para cada etapa:
1. Revisar o diff e confirmar que arquivos sensíveis não foram alterados sem necessidade.
2. Executar os scripts de teste disponíveis no projeto e registrar o resultado real.
3. Verificar build/deploy Preview e logs da Vercel.
4. Testar desktop e mobile, incluindo tema claro/escuro.
5. Validar navegação, teclado, estados vazios/erro/carregamento e permissões.
6. Fazer testes autenticados e de integração apenas com ambiente e credenciais autorizados.
7. Atualizar este documento com entregue, pendente, risco e evidência.
8. Não fazer merge ou promover para produção sem autorização explícita.

### Correção operacional — conversas por instância
- A Inbox/CRM mantém visíveis os históricos das conversas vinculadas a instâncias desconectadas.
- A desconexão continua isolada por slot e não troca silenciosamente a conversa para outro chip.
- A conversa selecionada permanece aberta; o compositor e a busca de mensagens antigas no WhatsApp ficam bloqueados até a reconexão.
- Desconexões manuais pelo motor local e pela Evolution redesenham a Inbox imediatamente; desconexões detectadas pelo polling também são refletidas na renderização.
- O histórico permanece armazenado e visível. Esta mudança não executa exclusão de contatos ou mensagens.
- **Validação:** fluxo sintético no navegador local confirmou histórico visível e envio bloqueado; a suíte Playwright e a validação autenticada/real seguem pendentes.

## 6. Status inicial

- [x] Inventário estático dos 14 destinos de navegação.
- [x] Confirmação de correspondência entre destinos e painéis.
- [x] Identificação da alternância de tema existente.
- [x] Inventário estático das declarações de rotas Express.
- [x] Direção visual premium verde/grafite e menu lateral responsivo iniciados na branch de homologação.
- [x] Busca rápida global atualizada para listar as 14 áreas do painel (Clientes SaaS permanece restrito ao perfil master).
- [x] Estilo premium aplicado à paleta de comandos existente.
- [ ] Homologação visual manual em desktop e mobile.
- [ ] Regressão funcional autenticada.
- [ ] Testes de integrações reais.
- [ ] Aprovação para merge e publicação em produção.

## 7. Correções funcionais do CRM — homologação

- [x] Corrigida a alternância entre as subvisões Conversas, Contatos, Kanban e Coach IA: a troca agora sincroniza as classes `active`, `u-none` e o atributo `hidden`. Antes, apenas `style.display` era alterado, sem remover a classe utilitária que mantinha as três subvisões ocultas.
- [x] Na desconexão manual pelo motor local ou pela Evolution, a conversa selecionada permanece aberta e o histórico continua consultável; o compositor fica inerte e a busca remota de mensagens antigas é bloqueada.
- [x] A leitura do status prioriza o motor efetivamente ativo (`local_worker` ou `vercel_cloud`), evitando que um estado em cache de outro motor libere envios indevidamente.
- [x] A desconexão não oculta o histórico nem troca silenciosamente para outro slot; os filtros explícitos por instância continuam disponíveis.
- [ ] Validar em Preview com sessão autenticada: abrir as quatro subvisões, testar agenda/paginação, mover cartões no Kanban e executar o Coach IA.
- [ ] Testar desconexão real e reconexão dos motores local e Evolution; confirmar histórico visível durante a queda e liberação do envio após reconectar.
- [ ] Executar a suíte Playwright automatizada e revisar logs de Preview.

**Nota de integridade dos dados:** o histórico e os contatos continuam armazenados e visíveis; a desconexão não exclui dados, e impede o envio/consulta remota de mensagens antigas até a reconexão.


## 8. Controles rápidos do dashboard — homologação

- [x] Os cinco controles rápidos agora validam a confirmação da API, ficam temporariamente desabilitados durante o salvamento e restauram o valor anterior em caso de falha.
- [x] A alternância global da IA atualiza o estado local e sincroniza os interruptores equivalentes das abas antigas.
- [x] As preferências de digitação, divisão de mensagens, pausa por resposta humana e horário são preservadas sem sobrescrever configurações vizinhas.
- [x] O webhook da Evolution agora aplica o mesmo comportamento operacional: presença de digitação (best-effort), divisão de respostas longas, janela de atendimento e pausa após resposta manual do dono.
- [x] Eventos de envio originados pela própria API e respostas recentes da IA não são tratados como resposta manual do dono para evitar pausar o atendimento indevidamente.
- [x] Adicionados testes unitários para divisão de mensagens e cálculo da janela de atendimento no fuso configurado.
- [ ] Executar a suíte `npm test` na cópia isolada e validar manualmente os cinco interruptores nos motores local e Evolution.
- [ ] Validar envio real de presença e mensagens pela instância Evolution conectada; o indicador de digitação é auxiliar e sua falha não bloqueia o envio do texto.

**Limite de validação:** as alterações foram verificadas por leitura do código e análise sintática; ainda não foram executadas contra uma sessão real de WhatsApp nem homologadas em Preview.


## 9. Auditoria e correções da aba Treinamento — homologação

### Correções implementadas na branch

- [x] Editor de Skills de Humanização agora apresenta os campos próprios: objetivo, o que evitar, exemplo inadequado e exemplo adequado.
- [x] O formulário envia esses campos separadamente; o campo de orientação operacional deixa de ser confundido com os campos de humanização.
- [x] O backend preserva os campos antigos de uma Skill de Humanização quando uma atualização parcial não os envia. Campos explicitamente enviados vazios continuam podendo ser limpos pelo usuário.
- [x] Busca do Estúdio Visual considera todos os campos textuais da Skill, incluindo objetivo, restrições, exemplos e corpo Markdown.
- [x] Geração de IDs para mensagens e Skills procura o próximo código livre, evitando colisões causadas por lacunas na numeração.
- [x] Remoção de FAQ sincroniza os campos sem compactar a lista antes de aplicar o índice selecionado; linhas vazias são removidas ao excluir e não são persistidas no salvamento do perfil.
- [x] Estúdio Visual diferencia carregamento de falha e oferece tentativa manual de recarga.
- [x] Upload da base de conhecimento deixou de cortar silenciosamente documentos acima de 30 mil caracteres: a API rejeita o documento com erro explícito e orienta dividir o conteúdo.
- [x] Texto e rótulo de upload alinhados aos formatos aceitos pela interface (.txt, .csv, .md e .json).

### Pendências que exigem integração e homologação

- [x] Prévia do prompt agora recebe um snapshot validado dos campos atuais do formulário e monta a resposta sem persistir alterações. A rota mantém allow-list de campos, valida tipos/limites e usa os dados de catálogo, PIX, áudios e pacote já carregados no contexto.
### Importação segura — etapa intermediária implementada
- [x] Criada rota legada de prévia isolada: compila o arquivo em armazenamento temporário e devolve apenas resumo, contagens e campos de perfil alterados; não grava nem ativa o pacote.
- [x] Arquivos ZIP/JSON/MD/TXT e conteúdo colado agora passam primeiro pela prévia. A interface só chama o importador legado depois da confirmação explícita.
- [x] A confirmação envia fingerprint do estado completo do negócio e pacote ativo; se o treinamento mudar entre prévia e confirmação, a API recusa a aplicação e exige nova prévia.
- [x] Mantido o importador legado como executor final, preservando compatibilidade com o motor atual e com o fluxo de persistência existente.
- [x] Adicionados testes isolados para compilação da prévia sem mutar o documento de origem e rejeição de Base64 inválido.

- [ ] Homologar integração remota de training-v2 e persistência antes de considerar qualquer ativação/migração para esse novo motor.
- [x] Documentos da base de conhecimento são serializados separadamente e rotulados no prompt como dados de referência não confiáveis; instruções encontradas neles não devem substituir as regras do sistema.
- [ ] Validar visualmente os campos do editor e os estados de erro/retry em desktop e mobile.
- [ ] Executar a suíte isolada completa e corrigir eventuais regressões encontradas.
- [ ] Validar importação de arquivo e conteúdo colado em sessão autenticada, incluindo bloqueio de prévia desatualizada.
- [ ] Validar visualmente o fluxo de prévia/confirmação em desktop e mobile.
- [ ] Confirmar em sessão autenticada que os pacotes existentes continuam intactos.

**Limite de validação desta etapa:** as alterações foram gravadas na branch de homologação por commits GitHub. Ainda não houve execução local da suíte, validação no navegador, teste autenticado de persistência, Preview Vercel ou deploy. A produção permanece intocada.


### Homologação técnica — correções do relatório de 10/11/2026

- [x] Corrigido o contexto de tenant da rota de prévia de treinamento: rotas legadas `/training-packs` passam pelo middleware de workspace; o contexto cloud inclui tenant autenticado e o modo local usa identificador estável do workspace.
- [x] Corrigida a detecção de rascunhos training-v2: a rejeição HTTP 409 ocorre somente quando o schema de rascunho está no conteúdo bruto recebido, não no documento canônico produzido pela prévia.
- [x] A confirmação de importação ZIP/texto exige fingerprint SHA-256 válido e rejeita ausência ou divergência antes de gravar.
- [x] Estúdio Visual deixa de carregar uma classe CSS que o mantinha permanentemente oculto.
- [x] As 14 páginas estáticas do painel foram regeneradas a partir de `public/painel.html`.
- [x] Exportações de ZIP, backup JSON e CSV passaram a enviar autenticação por headers e baixar via Blob; JWT e PIN deixaram de ser aceitos em query string.
- [x] Upload da base de conhecimento valida extensão permitida, bytes binários e UTF-8 estrito; PDF/binários não processados são rejeitados com HTTP 415.
- [x] Prévia do prompt informa explicitamente quando contém alterações ainda não salvas.
- [x] Navegação inferior mobile restaurada; breakpoints do shell alinhados a 900px e espaço inferior reservado para a barra.
- [x] Testes ajustados para contabilizar presença `composing` separadamente de envio de texto, corrigir delimitador de parágrafos e simular slot conectado no teste de histórico.
- [x] Adicionado teste de regressão para rejeição explícita de rascunho training-v2.
- [x] Adicionado workflow de homologação em Node 24 para testes de regressão, páginas estáticas e SQL.

**Validação pendente:** os commits foram gravados na branch de homologação. A execução da suíte Node 24 e dos testes de navegador ainda precisa ser confirmada pelos checks do GitHub Actions. Os checks Vercel continuam sujeitos ao limite externo de build. Não houve merge nem deploy de produção.


## Homologação retomada — 11/11/2026

### Vercel e Preview
- Projeto oficial: `zap-ia-studio`, equipe `ivandoplays-projects`, plano Hobby.
- O Vercel Bot havia registrado bloqueios HTTP 402 com `api-deployments-free-per-day` e a mensagem `more than 100` para novos deployments, inclusive para o projeto oficial ([registro](https://github.com/ivandoplay/zap-ia-studio/pull/6#issuecomment-6768697157)).
- Depois desses erros, a integração Git criou automaticamente um Preview oficial `READY` para o commit documental `61ac491151ae7f41fc4797e3a3a248de18a64161`, deployment `dpl_7qmwspr5xiBoNQn7dJxExD1ZDhMh`. URL direta: https://zap-ia-studio-4sbqnsi9p-ivandoplays-projects.vercel.app; alias da branch: https://zap-ia-studio-git-feat-modernizacao-58ed16-ivandoplays-projects.vercel.app.
- Esse sucesso comprova que ao menos um deployment foi aceito após os erros anteriores. A Vercel não expôs um contador de cota confiável; não se presume headroom permanente. Não houve chamada manual de criação nem contorno de limite.
- Logs de build: conclusão em 9s, função `/api` publicada e deployment finalizado. Avisos observados: configuração npm `cache-dir` desconhecida e quatro pacotes com scripts de instalação ainda não cobertos por `allowScripts`. A função ficou em 100,93 MB; `ffmpeg-static` representa 76,13 MB.
- Runtime logs: nenhuma linha retornada nos 30 minutos consultados para este Preview. Ausência de linhas não comprova ausência de erros.
- A proteção SSO do projeto está habilitada para deployments que não sejam domínios customizados. Não foi feita sessão manual autenticada no Preview nesta rodada.

### Suíte automatizada executada
Workflow GitHub Actions `Ienvia homologation`, run [43000676684](https://github.com/ivandoplay/zap-ia-studio/actions/runs/43000676684), job `Node 24 · regressions and static routes`, concluído com sucesso em 11/11/2026. Checkout do merge ref da PR #6, incluindo o commit `b677420f`. Ambiente Node 24.22.2 e Chromium.

- Verificação das 14 páginas estáticas geradas: passou.
- Regressão focada: 38 testes passaram, 0 falharam.
- Evolution API: 78 testes passaram, 0 falharam.
- Segurança SQL: 8 testes passaram, 0 falharam.
- Suíte completa `npm test`: 641 testes passaram, 0 falharam.
- O log da suíte completa contém uma resposta HTTP 503 de `/api/dashboard/summary` no ambiente isolado sem credenciais; o processo terminou com 641/0. Esse evento fica registrado para revisão, sem ser tratado como falha de produção.

### Matriz de validação solicitada

| Área | Resultado real | Limite da evidência |
| --- | --- | --- |
| Subabas Conversas, Contatos, Kanban e Coach IA | Passou na verificação automatizada de abertura/visibilidade das quatro subvisões em Playwright. | A asserção verifica que cada painel fica visível; não comprova todas as ações internas. |
| Paginação de Contatos | Passou com mais de 200 contatos sintéticos; a primeira página exibiu 50 e o teste carregou o restante sem perda. | Teste isolado, sem dados de clientes. |
| Agenda | Passaram testes de serviço/SQL para paginação, busca literal e isolamento por escopo; também há teste de normalização de telefone para não duplicar contato. | Não houve validação manual autenticada da tela de agenda no Preview. |
| Movimentação de cartões no Kanban | Não comprovada nesta rodada. | Os testes encontrados cobrem busca/filtros, estado do painel e preservação de etapas; não foi localizada uma asserção de arrastar/soltar ou mover cartão entre colunas. |
| Execução do Coach IA | Não comprovada nesta rodada. | A subaba abre e o estado do Coach é preservado em testes de restauração, mas não foi executada uma análise/resposta do Coach. |
| Desconexão pelo motor local | Verificado no navegador com contato fictício: a conversa e o histórico permanecem visíveis, aparece o aviso de consulta e o compositor fica inerte. | Sem sessão autenticada, dados reais ou envio ao WhatsApp; a suíte Playwright não foi executada nesta rodada. |
| Desconexão pela Evolution Cloud | Verificada em estado sintético no navegador: histórico visível, compositor e busca remota bloqueados. | Não houve chamada a uma instância Evolution real nem webhook real de desconexão nesta rodada. |
| Reconexão e reativação do envio | Verificação sintética local confirmou que o compositor e a busca de histórico voltam após reconectar; a suíte automatizada permanece pendente. | Não comprova reconexão de dispositivo real. |

### Limitações e próximos passos seguros
1. A homologação funcional completa permanece parcial: não foram comprovados movimento de cartões no Kanban nem execução real do Coach IA.
2. Repetir a inspeção visual/interativa autenticada no Preview quando houver acesso SSO.
3. Acrescentar testes Playwright explícitos para mover cartão entre etapas e executar o Coach IA com fixture isolada.
4. Validar desconexão/reconexão real em uma instância Evolution de homologação, sem usar números ou conversas de produção.
5. Se a Vercel voltar a retornar `402 api-deployments-free-per-day`, aguardar a liberação natural da cota, sem retries manuais, mudança de plano ou contorno.
6. Permanecem as pendências de segurança Supabase e reconciliação de migrações descritas acima; nenhuma alteração foi aplicada ao banco remoto.

**Integridade:** nenhum merge, promoção para produção, alteração irreversível de banco, mutação de conversas reais ou acionamento de WhatsApp/Evolution real foi realizado nesta rodada.
