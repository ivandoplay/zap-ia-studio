# Lapidação visual — Conversas do CRM

## Direção do usuário

Manter a identidade e o estilo atuais da Ienvia; aprimorar a tela, sem criar uma linguagem visual diferente e sem perder funções.

## Referências consultadas

- Skill `frontend-design`: respeitar o brief, revisar a composição visual e criticar com capturas.
- Skill `frontend-ui-engineering`: aderir ao design system do produto, responsividade, acessibilidade e estados reais.
- Skill `interface-review`: verificar regressões de layout, texto, acessibilidade e comportamento no escopo alterado.
- `public/styles.css`: tokens de tema escuro/claro, cores, tipografia, raios, foco e navegação móvel atuais.

## Comparação com a aplicação e documentação

| Elemento / contrato | Decisão nesta lapidação | Resultado da comparação |
|---|---|---|
| Identidade visual existente | Mantidos sidebar, topbar, paleta, fonte, botões, badges, raios e variáveis CSS da Ienvia. Os novos estilos usam os tokens atuais. | Consistente com `public/styles.css`; não introduz um novo shell ou marca. |
| Visões do CRM | Conversas, Contatos, Kanban e Coach IA permanecem, com os mesmos IDs e handlers. | Consistente com `docs/crm-rewrite/open-questions.md`, que pede manter todas as áreas. |
| Filtros da caixa | Ativas, Não Lidas, Com Você, Quentes, Retorno S19 e Arquivadas continuam sempre visíveis. Canal, Etapa, Etiqueta e Negócio ficam no painel “Filtros”, com contador ativo; IDs dos selects e lógica de filtragem foram preservados. | Mantém as capacidades já documentadas e reduz a concorrência visual; expansão acessível em um toque/clique. |
| Compositor | Corrigida a gaveta existente de Áudio Estratégico/Catálogo: agora inicia fechada e abre/fecha pelo botão já existente, com `aria-expanded` e `aria-controls`. As rotas de envio e seleção dos itens não mudaram. | Corrige o comportamento pretendido pela própria UI, liberando área para o histórico. |
| Inspector e ações | Ficha 360º, estados, mensagens, ações do chat e operações em massa seguem no mesmo lugar e com os mesmos eventos. | Nenhuma rota, DTO, persistência ou contrato do backend CRM foi alterado. |
| Layout móvel | As quatro subvisões cabem em uma linha legível; a conversa permanece em tela cheia e a gaveta de mídia continua acionável. | Compatível com o shell móvel definido no sistema. |

A recomendação de revelar controles especializados sem os remover é compatível com a orientação da NN/g sobre progressive disclosure ([NN/g](https://www.nngroup.com/articles/progressive-disclosure/)). Para o uso de inbox compartilhada, atribuição, notas e acompanhamento permanecem no contexto existente ([Missive](https://missiveapp.com/blog/shared-mailbox-best-practices)).

A regra do caderno do CRM de manter aparência e fluxo atuais foi respeitada (`docs/crm-rewrite/README.md`). O inventário de rotas de `docs/crm-rewrite/current-backend-audit.md` não exigiu alteração: nenhuma rota foi chamada contra ambiente real ou modificada.

## Validação executada

- Browser headless com viewport desktop de 1600×1000 e celular de 390×844; as respostas e os contatos foram **sintéticos**.
- Verificado: painel de filtros abre/fecha; escolher Chip 2 filtra para uma conversa; limpar o select restaura as quatro; contador ativo atualiza.
- Verificado: a gaveta de mídia começa fechada, abre e fecha, e sincroniza `aria-expanded`.
- Captura móvel confirma cabeçalho da conversa no topo (`y=0`) e sem o espaço vertical excedente; captura desktop e painel avançado também registrados.
- `node --check public/app.js`, `node --check src/server.js`, `git diff --check`: aprovados.
- `node --test tests/realtime-inbox.test.mjs tests/crm-v2-event-ingress.test.mjs`: **11/11 passaram**.
- O preview estático reportou `404` apenas para WebSocket `/ws`, esperado porque os testes usaram servidor de arquivos e mocks de API, sem backend/socket real.

## Capturas de validação

Foram geradas capturas de comparação em desktop, celular e filtros expandidos com dados sintéticos. Os PNGs ficam somente na workspace local, não no repositório: isso evita versionar mensagens e telefones de demonstração com aparência de dados reais.

## Estado e limites

A lapidação está **local, não commitada e não publicada**. `scripts/evolution-setup.sh` mantém uma mudança local de modo de arquivo anterior, fora do escopo. Nenhuma chamada foi feita à Evolution real nem a dados de clientes; nenhum dado de conta foi alterado.
