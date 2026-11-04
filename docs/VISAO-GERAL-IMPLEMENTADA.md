# Visão geral — implementação e validação

**03/11/2026 · Ienvia · etapa limitada à Visão geral**

## Situação da entrega

A nova página foi implementada no projeto, com backend de resumo, integração com os contratos de sessão existentes e testes. **Não é mais somente o protótipo estático.** Entretanto, **não houve commit, push, deploy ou aplicação desta nova migração no Supabase**. Não está sendo apresentada como uma atualização já disponível em produção.

A entrada é opt-in: `/visao-geral/`. O painel `/painel` permanece disponível. Há um link “Nova visão geral” na navegação do painel atual. Os demais menus da nova tela abrem as abas existentes do legado; suas páginas não foram apresentadas como reformadas. Conexões/Motor continua sendo a próxima área separada conceitualmente, com acesso à área atual de conexão enquanto não for reformada.

**Nenhuma mensagem real foi enviada; nenhum chip foi reconectado; nenhuma campanha foi iniciada, retomada ou alterada.** A conta com restrição não foi usada para testes de envio. Nenhum socket WhatsApp real foi aberto para esta validação.

## Implementação

### 1. Página modular

- `public/v2/index.html`: entrada pequena, com estado inicial de carregamento.
- `public/v2/assets/app.js`: coordenação da página e ciclo de vida.
- `session-client.js`: sessão existente, PIN, suporte e refresh.
- `poller.js`: atualização visível, sem sobreposição de consultas e com descarte de respostas antigas.
- `view.js`: renderização dos contadores, gráfico e estados.
- `shell.js`, `navigation.js`, `icons.js`: navegação, busca, menu mobile e estrutura visual.
- `appearance.js`, `appearance-preferences.js`: preferência individual, cache e sincronização.
- CSS, fonte e marca locais; licença da fonte preservada. A nova página não importa o `public/app.js` monolítico.

Tema escuro por padrão; opção clara por operador. Menu mobile com foco, Escape e isolamento do conteúdo atrás da gaveta. Busca de páginas com Ctrl/Cmd K. Nomes da conta são inseridos como texto, não HTML.

### 2. Resumo leve e somente leitura operacional

`GET /api/dashboard/summary` evita `loadTenantContextFromCloud` e o carregamento completo do tenant. O desvio acontece depois da verificação da sessão e também cobre suporte autorizado. Não usa `/api/bootstrap`, `/api/cloud/poll`, histórico de mensagens ou listagem de contatos para montar os indicadores.

Na nuvem:

- Uma RPC agregada para contagens e série de sete dias.
- Leituras pequenas e explícitas de runtime, até três slots e até vinte dispositivos recentes.
- Consulta de estado à Evolution, sem criar instância, parear ou conectar. A listagem de instâncias é filtrada no servidor por proprietário; não é enviada ao navegador.
- Contagens, runtime e leitura do provedor são paralelizados. Leituras do runtime têm limite de 3s; RPC, 6s no cliente de banco; chamadas de status Evolution desta página, 2,5s cada, com estados dos slots em paralelo. Esses limites não constituem um SLA nem um benchmark de produção.
- JSON sem contatos, mensagens, QR, códigos de pareamento, credenciais, notas administrativas ou números de telefone.
- Respostas com `Cache-Control: no-store`.

No motor local, os indicadores são calculados sobre os contatos já em memória e o estado público do motor. Campanhas que não são carregadas por esse resumo são exibidas como **indisponíveis**, não como zero. Sem identidade de conta, a preferência é identificada como sendo do navegador; não se inventa usuário ou sessão.

### 3. Semântica dos números

| Elemento | Significado |
|---|---|
| Conversas | Quantidade de registros de contatos/conversas da conta |
| Aguardando humano | Registros com `stage = aguardando_humano` |
| Chips conectados | Conexões confirmadas no snapshot de leitura, respeitando o limite da conta |
| Campanhas | Total da tabela de controle, sem usar uma listagem limitada a 100 |
| Gráfico | Conversas cuja **última atividade registrada** caiu em cada dia |

O gráfico usa `last_message_at`, com dias em `America/Fortaleza`. Cada conversa aparece em no máximo um dia. **Não é volume histórico de mensagens, atendimentos diários, conversões ou vendas.** Inclui tabela acessível de dados e estado vazio explícito. Zero válido é diferente de indisponibilidade.

### 4. Status de conexão e motor

`src/dashboard/connections.js` faz composição pura e não modifica o snapshot original:

- Evolution desconectada não mantém uma conexão antiga como confirmada.
- Falha, resposta inválida ou estado antigo não viram `connected`.
- Evolution conectada não inventa `workerOnline`.
- Motor usa heartbeat recente, não a conexão da Evolution como substituto.
- Dois transportes reportando conexão simultânea ficam em conflito explícito; o resumo não escolhe um transporte para enviar.
- Campos pessoais e de pareamento são removidos da resposta pública de resumo.

A composição também é reaproveitada no poll legado. As chamadas autenticadas de diagnóstico Evolution receberam `redirect: error`; a chamada principal já tinha essa proteção. Respostas inválidas na listagem de instâncias não são convertidas em uma lista vazia. Leituras de chats/contatos também deixam de usar uma conexão positiva antiga como fallback quando falha a leitura atual de estado.

Estar conectado **não** comprova entrega, recebimento, saúde da IA ou prontidão de uma campanha.

### 5. Contrato do toggle

`POST /api/wa/toggle-bot` aceita somente booleano nativo em `enabled`. Ausência, `null`, números e strings como `"false"` são rejeitados com 400. A validação foi colocada antes de carregar o workspace, após a autenticação/PIN aplicável, e repetida no handler como defesa. O dashboard novo não oferece ação de ligar/desligar a operação.

### 6. Sessão, PIN, suporte e aparência

Foram preservados os formatos reais do legado:

- `localStorage.zapia_cloud_auth`: objeto de sessão existente.
- `sessionStorage.zapia_pin`: PIN, enviado pelo header **`x-panel-pin`**.
- `sessionStorage.zapia_act_as`: **JSON com `userId`**, não uma string simples de UUID; o header `x-zapia-act-as` recebe apenas esse ID.
- Refresh usa `/api/auth/refresh`; 503 não é tratado como autorização nem causa descarte indiscriminado da sessão. Se o servidor devolver `retrySession` depois da rotação, ela é preservada para a próxima tentativa, sem liberar a consulta que falhou.

O servidor mantém separados **operador autenticado** e **conta acessada**. Usuário comum não entra em suporte. Master precisa de alvo válido e ativo. O resumo SQL repete a verificação de acesso, incluindo operador e alvo ativos.

A aparência é carregada e salva com o cliente autenticado do operador real, inclusive no suporte. A RPC de escrita não aceita ID de usuário. O alvo não recebe o tema do master. Falha de sincronização mantém feedback e um retry exclusivo da preferência; não aciona nenhuma operação WhatsApp.

### 7. Atualização e erro

- Consulta a cada 30 segundos enquanto a aba está visível.
- Sem requests sobrepostos; abort e epoch para respostas tardias.
- Troca de token, PIN, conta de suporte ou identidade/permissões verificadas invalida a tela anterior.
- Falha temporária preserva o último resumo válido com aviso explícito de desatualização. WhatsApp e motor deixam de ser mostrados como confirmação atual.
- 401/403 removem os dados antigos e mostram o caminho do login/PIN existente.
- Primeiro erro não fabrica contadores zero.
- Depois de uma pausa longa da aba, a página sinaliza a necessidade de confirmar os dados.

## Banco: migração preparada, ainda não aplicada

`supabase/migrations/20261103230000_dashboard_resumo_e_aparencia.sql`

Mudança aditiva:

1. `ienvia_user_appearance`: preferência por usuário, tema validado e RLS.
2. `ienvia_set_appearance(text)`: salva exclusivamente a preferência do `auth.uid()` ativo.
3. `ienvia_dashboard_summary_v1(uuid)`: resumo agregado e somente leitura; verificação de dono/master ativo e timeout SQL de 5s.

Não altera dados de contatos, mensagens, campanhas, cron, funções de envio ou configurações existentes. Leitura de preferência é restrita ao próprio usuário; escrita direta da tabela não foi concedida ao cliente. Execução das RPCs não é concedida a anônimo/PUBLIC.

Foi consultado **somente metadado** do banco remoto: schemas, função de usuário ativo e índices pertinentes. Confirmados os índices existentes em `(user_id, chat_id)`, `(user_id, last_message_at DESC)` e `(owner_id, campanha_id)`. Não se criou índice redundante nem se consultaram registros de clientes/campanhas nesta etapa. A migração foi executada em PostgreSQL embarcado/PGlite para os testes, não no banco de produção.

## Aplicação das referências selecionadas

As referências permanecem fixadas e licenciadas conforme `SKILLS-REVISAO-VISAO-GERAL.md`; não foram executadas como plugins. Aplicação concreta: separação de página/estado/transporte, contratos pequenos de API, campos de resposta permitidos explicitamente, erros sem fallback positivo, funções puras testáveis, regressões RED/GREEN de conexão e polling, 300 combinações de invariantes, revisão diferencial do legado, agregação SQL com isolamento e reaproveitamento de índices existentes, além de teste visual/teclado/contraste. Não houve adoção de nova stack, dependência de runtime, event store ou mecanismo de retry de mensagens.

## Evidências de validação

### Testes novos — resultado final

**32/32 aprovados.** Log: `/home/user/auditoria/arquitetura-v2/dashboard-final-tests.log`.

- 8 testes de navegador: desktop/mobile, 320px, dark/light, suporte, busca/menu, erro, vazio, texto não executável, contraste básico e links para abas existentes.
- 4 testes de composição de conexão, incluindo 300 combinações de invariantes.
- 4 testes HTTP com servidor real em modo cloud e serviços externos sintéticos: resumo leve, suporte, preferência do operador, falhas e toggle inválido antes do workspace.
- 3 testes locais: middleware real executado em VM + router real HTTP, preservando PIN/login/suporte; handler real do toggle em VM. **Não inicializam o servidor/motor local completo.**
- 2 testes de modelo local e fronteira do dia em Fortaleza.
- 2 testes de polling/cancelamento/troca de conta.
- 5 testes de sessão, refresh, PIN e respostas tardias.
- 4 testes SQL com roles/RLS: 1.002 contatos, 137 campanhas, isolamento, suporte, preferência e rejeição de escrita indevida.

O teste de navegador de contraste é uma checagem de texto sólido, não uma certificação WCAG completa. O teste SQL não substitui um smoke autenticado do Supabase após aplicação da migração.

### Regressão completa

**314 testes: 312 aprovados, 2 falharam.** Log: `/home/user/auditoria/arquitetura-v2/dashboard-full-regression.log`.

Os dois problemas observados continuam na área de release/ZIP assinado já apontada anteriormente:

- `ienvia-branding.test.mjs`: endpoint público de ZIP retorna 500 onde o teste exige 200.
- `static-release-package.test.mjs`: versão do pacote assinado diverge da versão anunciada.

Esses testes **não foram marcados como aprovados**, e nenhuma chave, assinatura ou pacote foi adulterado para esconder a falha. Permanecem impedimentos para considerar a distribuição do motor inteiramente validada, fora da reforma desta aba.

A regressão completa foi executada com 31 testes novos; a checagem adicional de contraste/links foi acrescentada depois. A rodada final específica da Visão geral inclui os 32 e passou. Os números das duas rodadas não devem ser somados como se fossem testes distintos.

### Peso observado em fixture

No navegador de teste, o primeiro carregamento fez três requests de API: status de autenticação, resumo e aparência. **Nenhum bootstrap/poll legado nem request externo do navegador.** O JSON sintético do resumo dessa fixture tinha **1.332 bytes**. É uma medição de fixture, não tamanho garantido de produção, benchmark de latência ou medição do tráfego interno Evolution/Supabase.

### Prints

Pasta: `/home/user/auditoria/arquitetura-v2/previews/visao-geral-integrada/`.

- `desktop-escuro.png` — principal.
- `mobile-escuro.png`.
- `mobile-claro-suporte.png`.
- `mobile-menu.png`.
- `desktop-dados-desatualizados.png`.
- `desktop-vazio.png`.
- `erro-inicial.png`.

**Todos são capturas da implementação com respostas sintéticas isoladas**, identificadas como teste na imagem. Não são dados da conta do titular nem comprovação de funcionamento autenticado em produção. A prévia estática antiga da porta 4173 foi encerrada; não é necessário reabrir aquele ambiente.

## Publicação e aceite em ambiente real — pendentes

Para disponibilizar esta versão, sem misturar código pronto com produção publicada:

1. Revisar/aplicar a migração aditiva no projeto correto, preservando o histórico de migrações.
2. Publicar o código e os assets juntos, incluindo os rewrites e headers novos; manter `/painel` como fallback.
3. Com uma sessão legítima do titular, fazer smoke **somente de leitura** do resumo na nuvem e no motor local: totais, permissões, suporte e aparência do operador. Não usar envio, pareamento ou reconexão como prova de funcionamento.
4. Conferir a nova opção no menu desktop e mobile; a rota direta `/visao-geral/` também deve funcionar.
5. Tratar separadamente o pacote do motor/assinatura antes de declarar a distribuição do motor liberada.

Não foi feita publicação nesta etapa. O rollout deve aplicar o SQL antes de expor o código novo; se a RPC estiver ausente, a página mostra indisponibilidade em vez de zeros. Para recuar da interface, basta manter o acesso ao painel antigo e retirar a entrada opt-in; não há motivo para apagar dados de preferência ou mexer em campanhas.
