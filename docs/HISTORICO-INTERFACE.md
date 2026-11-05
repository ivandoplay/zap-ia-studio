# Histórico por instância — interface local

## Status

Atualização posterior: a demonstração foi publicada em https://ienvia-reforma-visual.vercel.app/historico/ no commit `0ffa9ea`, projeto separado. Foram enviados somente frontend/revisão/testes; a API, SQL, supervisor e integração operacional continuam locais. O app autenticado não integra os 39 assets publicados. Os limites abaixo referem-se ao desenvolvimento inicial e não anulam essa publicação demonstrativa autorizada.

Tela MPA opt-in em `/historico/`, integrada à sessão e aos GETs UUID preparados na etapa anterior. **Somente leitura**: o desenvolvimento inicial foi local; a autorização posterior publicou apenas a demonstração estática na branch/projeto de revisão. Sem SQL remoto, pareamento, socket WhatsApp real ou migração do storage antigo. O menu Conversas continua abrindo o CRM atual; esta tela não o substitui.

A prévia estática local usa exclusivamente dados fictícios e não inclui o app autenticado, cliente de sessão, funções ou credenciais. Build/manifesto com **39 arquivos estáticos**; nenhum acesso a sessão real ou API. A configuração e os rewrites foram preparados apenas em arquivos locais, sem publicação.

## Experiência e decisões

- Seleção **explícita** da instância. Nenhum primeiro número/slot é escolhido como alternativa, mesmo na leitura.
- Busca por nome/etiqueta, paginação de instâncias e conversas; sem novo teto de cadastro.
- Filtro padrão `visible`; `hidden` e `all` são escolhas explícitas. Alterar filtro/instância/busca limpa o conteúdo anterior antes da nova consulta.
- A lista de conversas exige origem na instância selecionada. Ao abrir uma delas, a conversa é **canônica**, podendo conter outras origens elegíveis da mesma conta/negócio/cliente. Nota visível e etiquetas por mensagem explicam isso.
- Sem nome de contato inventado: PN aparece com seus dígitos exatos; LID aparece como identidade provisória, sem inferência de número.
- Mensagens paginadas do início para o fim, conforme o contrato `(message_at,id)` existente, com botão Próximas mensagens. Não se apresenta a primeira página como se fossem necessariamente as mensagens mais recentes.
- Estados distinguem recebida, aceite sem entrega, entrega/leitura/reprodução comprovadas e resultado incerto. Não há botão de reenvio.
- Tombstone e conteúdo temporário recebem aviso, sem tentar recuperar corpo ou baixar mídia. Divergência e origem de timestamp ficam sinalizadas. IDs do provedor aparecem somente em detalhes do registro.
- A página é atualizada por ação explícita. Não há polling ou promessa de atualização a cada 30 segundos. O shell ganhou opção de texto de atualização, preservando o padrão das telas antigas.
- No celular, a leitura ocupa o painel e recolhe filtros/lista. Voltar às conversas restaura a navegação e o foco. Origem selecionada permanece descrita no cabeçalho da conversa.

## Direção visual aplicada

Continuidade da aparência aprovada, não uma marca nova: Manrope local, fundo escuro `#101815`, superfície `#17241e`, texto `#edf5ef`, apoio `#adc0b4` e verde funcional. Tema claro individual com fundo `#f4f7f5`, texto `#172e27` e apoio ajustado a `#52665c` para contraste das mensagens. Hierarquia de 30/16/13px, painéis de conversa/lista e bolhas com origens, sem métricas fictícias ou efeitos decorativos.

Layout desktop: filtros acima, lista lateral, conversa à direita. Mobile: uma área de trabalho por vez, com retorno explícito. Conteúdo remoto é inserido por `textContent`; nenhuma URL de mídia é carregada como imagem ou link automático.

## Módulos e fronteiras

| Arquivo | Papel |
|---|---|
| `public/v2/history.html` | Documento inicial sem dados de conta, com autenticação no app. |
| `history-app.js` | Sessão existente, montagem do shell, gates, troca de contexto e limpeza ao sair/restaurar página. |
| `history-reader.js` | Interface somente GET; catálogo com identidade fixa e escopo explícito; validação das respostas. |
| `history-contract.js` | DTO/query puros compartilhados entre servidor, cliente e demonstração. |
| `src/instances/history.js` | Re-exporta o mesmo contrato, evitando regras divergentes. |
| `history-view.js` | Renderização, seleção, paginação, acessibilidade e descarte de respostas antigas. |
| `history-demo.js` | Fixture em memória com 24 instâncias, 23 conversas e 26 mensagens de exemplo. Não usa fetch/auth/socket. |
| `history.css` | Layout responsivo e estados visuais nos dois temas. |
| `navigation.js`, `src/server.js`, configs Vercel | Menu/rota/rewrite preparados localmente. |

A API existente continua derivando owner do contexto autenticado; não houve nova RPC, SQL ou autorização de escrita. O cliente de sessão também bloqueia verbos diferentes de GET nas rotas de histórico, antes da rede. Suporte master recebe leitura, não configuração/envio/exclusão.

## Privacidade, concorrência e falhas

- Leitor fixa viewer/tenant a partir do catálogo validado e exige instância previamente consultada. DTOs descartam extras/wire/capability e validam identidade/ACK/cursor.
- Gerações separadas de catálogo, conversas e mensagens impedem resposta antiga de repovoar a seleção atual. Paginação deduplica por UUID.
- Troca de sessão na mesma aba é verificada pelo cliente de sessão; evento de storage também invalida a página. Não se transfere resposta anterior ao contexto novo.
- 401/403 ou mudança de escopo removem dados e opções. O app remove também o shell/perfil e mostra gate quando perde o acesso. `dispose` aborta requisições e impede atualizações tardias.
- `pagehide` limpa a visualização e mostra gate; restauração por BFCache exige nova leitura/autenticação. Não é promessa de apagar screenshots/backup do sistema ou da memória física do navegador.
- HTML da rota usa `no-store, private`; dados de histórico não são salvos em localStorage/sessionStorage, URL ou cache. Mantidos apenas os mecanismos de sessão/tema já existentes.
- Service worker não foi modificado: API não é armazenada e navegação offline usa página genérica, sem contatos/mensagens. A revisão estática não registra worker.
- Falta de migração/503 não vira vazio ou fallback para contatos antigos. Falha de paginação é sinalizada; conteúdo da área afetada é removido em vez de fingir uma lista completa.

## Validação final

- **163/163 selecionados**, regex `history-|instance-|channels-|dashboard-|review-static|pwa-core|instances-pwa`.
- **448/450 completa**, somente `ienvia-branding.test.mjs` (500 vs 200) e `static-release-package.test.mjs` (versão assinada incompatível), falhas históricas preservadas.
- Navegador real Chromium, sem sessões reais: desktop 1440px, mobile 390px e limite 320px; tema claro/escuro, contraste básico de texto, foco/retorno, seleção, paginação, ocultos, suporte, erro/vazio, literal HTML, resposta tardia, dispose, perda de acesso e mudança de sessão durante consulta.
- App autenticado exercitado com API/sessão sintéticas; revisão estática exercitada bloqueando fetch e leitura de credenciais. Não se declara teste móvel físico ou auditoria WCAG completa.
- Sintaxe, manifesto estático e `git diff --check` verificados. Dependências existentes foram restauradas sem scripts de instalação do projeto; Chromium e bibliotecas de execução foram preparados no sandbox. Nenhuma nova dependência do produto ou alteração de lockfile.

Logs/evidências em `/home/user/auditoria/arquitetura-v2/`: `history-ui-final-selected.log`, `history-ui-final-full.log`, `history-ui-evidence.json`. Capturas `previews/historico/historico-{desktop-escuro,mobile-escuro,mobile-claro}-demo.png`.

## Skills e revisão

Consultadas `frontend-design`, `codebase-design`, `tdd`, `sharp-edges` e `webapp-testing`, mantendo o harness Playwright/Node já adotado pelo projeto. Referências não ampliaram permissões nem autorizaram plugins ou serviços reais. Houve ciclos RED/GREEN do leitor, transparência de atualização/ciclo de vida e bloqueio POST. Revisão de fluxo/privacidade adicional à revisão anterior, sem alegar auditoria independente.

## Ainda pendente

Bootstrap/auth UUID/heartbeat/recovery de worker em isolamento, migração não destrutiva do CRM antigo, concorrência PostgreSQL real, projeção completa de contatos/edições/grupos, coordenação de IA/campanhas e recursos PWA push/share. Nada disso foi ativado ou pode ser inferido da nova tela. A interface preparada só mostrará dados reais da nova base após migrações e integração autorizadas/homologadas.
