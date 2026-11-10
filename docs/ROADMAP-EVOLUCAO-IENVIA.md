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
- Revisar tabelas, formulários, modais, dropdowns, toasts, skeletons e estados vazios.
- Melhorar responsividade das telas de maior densidade (Inbox, CRM, campanhas e configurações).
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

## 6. Status inicial

- [x] Inventário estático dos 14 destinos de navegação.
- [x] Confirmação de correspondência entre destinos e painéis.
- [x] Identificação da alternância de tema existente.
- [x] Inventário estático das declarações de rotas Express.
- [x] Direção visual premium verde/grafite e menu lateral responsivo iniciados na branch de homologação.
- [ ] Homologação visual manual em desktop e mobile.
- [ ] Regressão funcional autenticada.
- [ ] Testes de integrações reais.
- [ ] Aprovação para merge e publicação em produção.
