# Conversas / CRM — nova caixa de entrada

Data: 04/11/2026. **Implementação local e demonstração interativa. Não é CRM migrado nem operação real.**

## Escopo aprovado

O titular decidiu terminar as telas com seus estados/fluxos antes de ativar a migração operacional conjunta. Pediu uma caixa de entrada muito próxima da experiência visual do WhatsApp, inclusive balões, ícones, botões e adaptação móvel. Escolhas técnicas e ordem delegadas; não repetimos perguntas sobre instâncias, offline, histórico e temas já decididas.

A tela mantém identidade Ienvia, ícones SVG próprios e fundo discreto original. Não afirma ser produto oficial do WhatsApp, criptografia ponta a ponta, presença online de contatos ou operações já habilitadas.

## Entregue nesta etapa

- Nova MPA opt-in `/conversas/`, com rail, busca, filtros, instâncias, lista rolável, mensagens cronológicas, balões recebidos/próprios, resposta citada, indicadores de confirmação e painel do contato.
- Temas escuro e claro, fonte local e comportamento responsivo desktop/mobile, incluindo 320px. Listas e histórico rolam dentro da tela; compositor permanece na área visível. Aparência usa a preferência individual já existente, não novas tabelas.
- Demo: busca literal nos dados carregados, todas/não lidas/minha atenção/com IA, fixar/desafixar, arquivar/desarquivar, marcar não lida, leitura explícita simulada, atribuição, etiquetas, notas, alternância visual de IA, rascunhos por conversa, respostas, emojis, foto ampliável e cartões de anexo de exemplo.
- Demo: simulação de mensagem exige **escolha explícita de instância online do mesmo negócio verificado**, sem padrão pelo ingresso ou última conversa. Offline/não verificada indisponíveis. Trocar de conversa limpa a escolha de saída. Aceite mantém `ack=1`, `delivered=false` e identificação explícita de simulação; não há fila, retry ou envio WhatsApp.
- Escrita demonstrativa fica bloqueada durante uma simulação pendente, prevenindo clique duplo e perda de rascunho por edição concorrente. Resposta tardia nunca aparece em outro contato.
- Origens por mensagem e conversa; avisos de amostra truncada, identidade provisória, horário de captura e versões divergentes. Ocultar CRM é filtro: não apaga nem interrompe ingresso. Identidades continuam sob o contrato canônico existente, sem união por nome livre.
- Cenários completo/vazio/falha/suporte, bloqueios explicados, busca no chat apenas nas mensagens carregadas, atualização manual e falha distinta de caixa vazia.
- Suporte somente leitura. Modais nativos com Escape e foco; painel sobreposto torna o chat inferior inerte e oferece retorno ao acionador. Busca e ações têm nomes acessíveis.

## Aplicação autenticada: leitura real preparada, escrita indisponível

`conversations-app.js` usa `createSessionClient`, `createHistoryReader` e `createConversationsReadAdapter`. O app passa pelo acesso existente e consulta o catálogo da conta; **não seleciona automaticamente uma instância nem uma conversa**. As únicas APIs consumidas são GET de status, catálogo e histórico já implementadas localmente.

Catálogo, conversas e mensagens são paginados. Não se impõe teto numérico de cadastro. A primeira página não é tratada como catálogo/lista completa. Instâncias têm UUID e nome livre; telefone não é a unidade de configuração.

O leitor atual retorna identidade e histórico, **não** nome do cliente, resumo, não lidas, etiquetas, responsável, notas ou estado de IA. Por isso:

- O nome real exibido é apenas a identidade do número verificado, ou “Identidade provisória”. Não sintetizamos dados CRM ricos.
- Filtros de metadata ficam indisponíveis. Perfil explica os campos ainda não integrados.
- Não existe formulário de envio, escrita de notas/etiquetas/IA nem API de mutação nesta nova aplicação autenticada. O adaptador de leitura nem sequer expõe métodos de escrita.
- Estado da conexão não é deduzido do catálogo. Abrir/atualizar a tela não inicia, reconecta, desconecta ou supervisiona motores.
- Ausência de SQL/migração dá erro explícito; não há fallback no CRM legado nem substituição silenciosa por dados fictícios.
- O CRM anterior em `/painel#crm` permanece disponível e não foi removido. Cadastro completo de contatos, kanban, coach, CSV, backup, restauração e sincronização legados não foram migrados por esta entrega.

Isso fecha a experiência visual e os fluxos demonstrativos da caixa de conversas, não a migração integral de todos os recursos antigos do CRM.

## Fronteiras de código

- `public/v2/conversations.html`: documento sem dados privados; app autenticado isolado.
- `conversations-view.js`: montagem, interação, seleção, paginação, versões/abort e descarte do DOM.
- `conversations-model.js`: filtros/projeções puros e adaptador de histórico autenticado somente leitura.
- `conversations-demo.js`: store fictício em memória, validação estrita e capacidades de suporte.
- `conversations-icons.js`, `conversations.css`: desenho próprio e temas.
- `crm-demo-ceramica.jpg`: imagem gerada exclusivamente para o exemplo, sem arquivos de clientes.
- `review-site/source/conversations-review.js`: bootstrap demonstrativo sem sessão, API ou motor.
- `scripts/build-visual-review.mjs`: allowlist com 47 assets estáticos; nunca copia `conversations-app.js` ou `session-client.js`.
- `scripts/preview-visual-review.mjs`: preview local apenas do site estático. Permite iframe exclusivamente nesse servidor fictício; o projeto de revisão mantém `frame-ancestors 'none'`, `connect-src 'none'` e demais proteções. Nenhum servidor principal é iniciado.
- Express e rewrites principais: rota opt-in de documento, `Cache-Control: no-store, private`. Configuração local, sem deploy principal.

Não foi criada migração SQL nova nem novo endpoint de mutação. Reutilizamos o backend local de histórico já testado em vez de criar um segundo armazenamento de mensagens.

## Privacidade e ciclo de vida

Mensagens/nomes/notas entram via `textContent`/`value`; HTML de usuário não é executado. Corpo excluído/temporário é substituído antes de exibição e busca. URLs de mídia reais não são aceitas pelo renderer. Somente a foto fixa fictícia pode ser carregada na demo; anexos reais ficam como tipo/indisponibilidade, sem buscar URLs alternativas.

Rascunhos e metadata demonstrativos permanecem em memória. Não são gravados em local/sessionStorage, cache, query string ou servidor. Somente aparência é persistida pela preferência existente. Nenhuma permissão de microfone/câmera/arquivos/notificação é solicitada por esta tela. Áudios, documentos e chamadas têm bloqueios explicados, não operações fingidas.

Versões independentes e AbortController separam carregamento de lista e mensagens. Troca de instância remove as linhas antigas antes da consulta; busca enquanto carrega não as ressuscita. O compositor demonstrativo só fica disponível com o histórico pronto; atualização durante simulação pendente é bloqueada, sem descarte/reenvio silencioso. Erro de tenant/sessão, `dispose`, `pagehide` e retorno BFCache eliminam interface/contexto anteriores; respostas atrasadas não repovoam a tela nem alteram a seleção atual. A busca é explicitamente local à página carregada, não busca global fictícia.

O service worker existente não foi ampliado para cache privado, páginas autenticadas, JPG de conversa, APIs ou mutações.

## Validação e evidências

Harness isolado existente, sem `.env`, sessões reais ou rede operacional. Ciclos RED/GREEN: ausência inicial dos módulos; rota demonstrativa inexistente; contraste de badges/horários; validação de etiquetas; busca durante troca de instância e compositor bloqueado antes do histórico pronto. A auditoria básica de contraste foi corrigida para medir a região realmente pintada em listas recortadas, com teste de regressão que ainda detecta baixo contraste visível.

Testes dedicados cobrem:

- Desktop 1440×1000, mobile 390×844 e limite 320×568; claro/escuro, compositor visível, foco e perfil sobreposto.
- Busca/filtros/rascunhos/respostas/emojis, etiquetas/notas/responsável/IA em memória, anexos e origens.
- Envio explícito, offline bloqueado, aceite diferente de entrega, bloqueio em suporte e pendência.
- HTML literal, corpo temporário não exibido, nenhuma URL de mídia privada.
- Sessão sintética com todas as requisições GET/autenticadas, SQL ausente sem vazio, troca de contexto e paginação 24 instâncias / 23 conversas / 26 mensagens.
- Resposta atrasada de lista/conversa/simulação, dispose e tenant divergente.
- Demo sem ler credenciais, fetch, WebSocket ou API; manifesto/CSP separados do app.

Resultados e hashes finais constam no relatório local `/home/user/auditoria/arquitetura-v2/CONVERSAS-ENTREGA-LOCAL.md`. Capturas ficam em `conversas/conversas-*`. Chromium não comprova celular físico nem auditoria WCAG completa.

Skills consultadas: frontend-design, codebase-design, TDD, webapp-testing e sharp-edges. Referências não ampliaram autorizações externas.

## Próxima fase — sem ativar agora

Projeção segura de contatos e metadata por tenant; CRUD com permissões/suporte bloqueado; coordenação IA/campanhas; integração de saída explícita com executor/lease/journal/ACK; mídia autorizada; migração/backfill não destrutivos; recursos CRM restantes e PWA push/share. Depois, homologação operacional autorizada. Não aplicar SQL, publicar backend/main ou abrir sessão real para “completar” a aparência da tela.


## Publicação posterior autorizada — 04/11/2026

O titular pediu explicitamente atualizar o site demonstrativo com tudo que estava pronto. Publicados os 47 assets estáticos em https://ienvia-reforma-visual.vercel.app/, incluindo `/conversas/`, Visão geral, Instâncias, Histórico e Conexões. Commit `c078e43f35a8e32b9d7583e19dc790119765e29a`, somente 33 arquivos frontend/revisão/testes na branch `review/reforma-visual`; deployment visual `dpl_DMr9vySxkQVpFu22p3QUoy28gygn` READY/PROMOTED, sem funções.

Validação: 32/32 testes antes da publicação; 47/47 hashes remotos iguais ao manifesto; navegação pública Chromium 1440/390 nas cinco telas, tema e simulação de envio, zero erros/API/acesso a sessão ou overflow. Main remoto permaneceu `7630b62b40b4518d06a157c4dc5055747fcb157e`; principal reconferido depois ainda `dpl_E2HmxAaSGyKxk87bifwNJHsNmy9n`. Sem SQL remoto, migração, backend principal ou WhatsApp real. A afirmação anterior de “ainda não publicada” passa a ser histórica. Evidências `conversations-{push-evidence,published-evidence,published-browser}.json` em `/home/user/auditoria/arquitetura-v2/`.
