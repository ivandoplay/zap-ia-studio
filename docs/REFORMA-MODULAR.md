# Reforma modular do Ienvia — 03/11/2026

## Decisões confirmadas

- Arquitetura e dependências antes da migração de páginas.
- Conexões/Motor em uma página própria.
- **Decisão mais recente:** tema escuro por padrão, opção de claro por pessoa, preservando a identidade verde. Substitui a proposta inicial fixa de páginas claras.
- Debate e validação por página, com testes e capturas reais.

## Primeira entrega: prévia isolada

Código e instruções: [`prototypes/reforma-base/README.md`](../prototypes/reforma-base/README.md).

Há base de navegação, Visão geral fictícia e prévia de Conexões. Não há login real, banco, Evolution, Baileys, QR ou envio de mensagens. O perfil de demonstração não é autorização de backend. As páginas restantes mostram que ainda não foram migradas.

Nenhum arquivo de interface ou serviço de produção foi substituído por esta prévia. Publicação não faz parte desta entrega.

## Skills consultadas

Cópias locais em `.agents/skills/`, ignoradas no Git e não descobertas automaticamente. No workspace, o manifesto com revisões/hashes e o registro da aplicação estão em `/home/user/auditoria/arquitetura-v2/`.

| Skill | Origem fixada |
|---|---|
| frontend-design | https://github.com/anthropics/skills/tree/ca45fc496a3436251f191354091d557da31c15b5/skills/frontend-design |
| webapp-testing | https://github.com/anthropics/skills/tree/ca45fc496a3436251f191354091d557da31c15b5/skills/webapp-testing |
| web-design-guidelines | https://github.com/vercel-labs/agent-skills/tree/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/web-design-guidelines |
| supabase-postgres-best-practices | https://github.com/supabase/agent-skills/tree/c9be0e931b7930f7d02126d04774d904c381e7d7/skills/supabase-postgres-best-practices |
| codebase-design | https://github.com/mattpocock/skills/tree/59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/engineering/codebase-design |
| tdd | https://github.com/mattpocock/skills/tree/59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/engineering/tdd |
| diagnosing-bugs | https://github.com/mattpocock/skills/tree/59db609eb1e18aaf59b63284d0e52255aff0c63c/skills/engineering/diagnosing-bugs |

Conteúdo externo é referência não confiável: não autoriza executar scripts, instalar integrações, ler segredos, mudar produção ou publicar. Os testes desta prévia usam Playwright/Node do projeto, não wrappers externos não revisados. As referências de PostgreSQL serão aplicadas nas etapas de dados; esta entrega não modificou o banco.

## Validação da prévia

Rodada histórica da prévia: **49 testes da prévia aprovados, zero falhas**. Mais **19 resultados aprovados** na regressão isolada de contratos existentes (autenticação, ingresso/recibos Evolution e isolamento de treinamento). Inclui navegação, busca, teclado, menu mobile, seleção de modo na URL, páginas em revisão, defesa contra parâmetros HTML e uma verificação básica de contraste.

Larguras: 320, 375, 390, 768, 1024 e 1440 px. Nos fluxos verificados não houve requisição externa, operação de escrita ou erro JavaScript. Isso não é auditoria completa de acessibilidade, teste dos transportes reais ou benchmark comparável ao produto antigo.

## Continuação

Primeiro revisar a prévia com o usuário. Depois integrar sessão/PIN e permissões reais à base sem reimplementar autenticação de forma paralela, preservar o legado durante a migração e tratar a lógica completa de Conexões como nova etapa. Não iniciar todas as telas ou efetuar envios reais só porque o desenho foi aprovado.

## Atualização: aparência e auditoria da Visão geral

A prévia agora tem botão de tema no cabeçalho, persistência local da escolha e aplicação antes dos estilos. Suporta navegação, recarregamento, múltiplas abas e armazenamento bloqueado. `appearance-preferences.js` separa preferências por identificador e preserva o operador no modo suporte; a prévia usa o identificador explícito `preview-demo`, não uma sessão real. Não há sincronização entre dispositivos nem preferência de conta gravada no servidor.

Relatório no workspace: `/home/user/auditoria/arquitetura-v2/AUDITORIA_VISAO_GERAL.md`. Inclui mapa das entradas/saídas, reprodução isolada de status antigo prevalecendo sobre Evolution desconectada, confusão entre conexão/worker e problemas do bootstrap/poll completos. Esses achados de backend foram identificados, mas **não corrigidos nem publicados** nesta rodada visual.

O antigo estudo `theme-preview-dark.css` foi arquivado fora dos arquivos públicos. A implementação atual usa `appearance.css`, `appearance-init.js`, `appearance.js` e o módulo de preferências; não há dois sistemas de tema concorrendo na prévia.

## Referências adicionais de backend, segurança e testes

Pesquisa complementar registrada em [SKILLS-REVISAO-VISAO-GERAL.md](SKILLS-REVISAO-VISAO-GERAL.md): seis referências novas, revisões/licenças preservadas, plano de aplicação e diagnóstico sintético de coerção booleana no endpoint antigo. Não houve alteração do aplicativo ou instalação de ferramentas naquela rodada de pesquisa.

## Implementação da Visão geral — estado mais recente

Após autorização para concluir a aba, a implementação saiu da prévia e entrou no projeto: `public/v2/`, `src/dashboard/`, rota opt-in `/visao-geral/`, resumo autenticado leve e migração SQL aditiva preparada. Veja [VISAO-GERAL-IMPLEMENTADA.md](VISAO-GERAL-IMPLEMENTADA.md) para contratos, arquivos, limitações e roteiro de publicação.

- Status puro, sem manter conexão antiga como confirmação e sem inventar worker online; conflito de transportes explícito.
- Toggle `/api/wa/toggle-bot` exige booleano nativo antes do workspace e antes de gravar.
- Resumo nuvem via RPC agregada; local usa os contatos em memória e não inventa totais de campanhas indisponíveis.
- Reaproveita `zapia_cloud_auth`, o JSON `zapia_act_as.userId` e PIN no header `x-panel-pin`; preserva refresh e controle de suporte.
- Tema individual do operador autenticado; sem identidade, preferência explicitamente do navegador.
- Poll somente visível, sem sobreposição, com descarte de respostas antigas, estados vazios/erro/desatualizado e navegação para abas existentes.

**Validação final específica: 32/32 novos testes aprovados**, incluindo navegador/contraste, HTTP, VM local, sessão, invariantes e SQL/RLS. **Regressão completa: 312/314 aprovados**; os dois problemas do ZIP/release assinado continuam registrados, não mascarados. A rodada completa antecedeu a inclusão do teste adicional de contraste/links; não somar as duas contagens.

Prints da implementação em `/home/user/auditoria/arquitetura-v2/previews/visao-geral-integrada/`, explicitamente identificados como dados sintéticos. A prévia antiga da porta 4173 foi encerrada.

**Não houve aplicação desta nova migração no banco remoto, commit, push ou deploy.** Código pronto/testado não é produção publicada. O próximo aceite externo exige SQL + publicação coordenados e smoke com sessão legítima, apenas de leitura, sem envio, reconexão ou retomada de campanhas.

## Decisão posterior: todas as abas antes de banco/GitHub

O titular adiou a etapa remota: primeiro concluir as abas no workspace; só depois tratar banco de dados, GitHub e publicação. O roteiro anterior de rollout permanece como referência futura, não como próxima ação autorizada agora.

A próxima aba iniciada é **Conexões / Motor**, rota `/conexoes/`. A primeira versão de diagnóstico separa chips, Evolution e motores, sem depender da RPC nova da Visão geral. Reutiliza sessão/PIN/suporte e tema individual no navegador; não altera sessões. A Visão geral já aponta para ela.

**60/60 testes selecionados aprovados** nesta rodada, com nove casos novos de Conexões e regressão da Visão geral/contratos de segurança. Prints sintéticos em `/home/user/auditoria/arquitetura-v2/previews/conexoes-integrada/`. Consulte [CONEXOES-MOTOR.md](CONEXOES-MOTOR.md).

Ações de pareamento/desconexão e configuração de IA por chip ainda estão no legado e serão revisadas/migradas nesta mesma aba. Não apresentar o diagnóstico como migração completa dos controles. Nenhum banco remoto foi consultado/alterado nesta rodada; nenhuma migração, envio, reconexão, commit, push ou deploy foi executado.
