# Campanhas — interface e executor local

04/11/2026. **Executor UUID, controles persistentes e ciclo local implementados e testados. Execução operacional permanece desativada.** Esta entrega não ativa banco remoto, IA paga, armazenamento remoto ou WhatsApp. A referência mais recente é [CAMPANHAS-EXECUTOR-LOCAL.md](CAMPANHAS-EXECUTOR-LOCAL.md): 34 testes novos aprovados e suíte geral 588/590 (duas falhas históricas). A composição foi exercitada com sessão/socket, callbacks IA e Evolution sintéticos; não foi instalada nos processos operacionais existentes. As seções históricas não representam pendências atuais de código local.

## Preparação persistente já entregue

| Recurso | Estado verificado |
|---|---|
| Excel/XLSX na demonstração | Importação verdadeira no navegador, sem rede; primeira aba, amostra, duplicados/inválidos e salvamento do rascunho em memória. CSV/TXT preservados. |
| Rascunhos UUID | API `/api/campaigns-v2`, adaptador e entrada autenticada explícita `/campanhas/?fonte=uuid`; não converte slots nem altera registros legados. |
| Persistência | Migração local `20261104006000_campaign_drafts_uuid.sql`, criação idempotente por UUID do pedido, edição com revisão/CAS e resultados vinculados à conta. |
| Remoção manual | Remove uma pessoa do rascunho com confirmação e CAS; mantém identidade das restantes. Não cria bloqueio de contato, descadastro ou regra automática. O último destinatário não é removido, para preservar um rascunho válido. |
| Catálogo | Consulta UUID paginada, teste com seis instâncias e escolha explícita de quatro. Conexão não verificada é identificada assim, não tratada como conectada. Nenhuma saída escolhida por padrão. |
| Consulta | Rascunhos paginados por cursor, destinatários por páginas de 50 e suporte master somente leitura. Erro, conta errada ou migração ausente não viram lista vazia. |
| IA | Rota explícita, controle independente, configuração da própria conta, preservação literal dos campos e alternativa de usar o original. Integração testada com provedor substituto, não com IA paga. Não muda a IA de Conversas. |
| Mídia privada | Rotas de pastas, reserva/transferência/finalização, exclusão e ticket; SDK seguro original e proxy portátil reaproveitados. Cliente restringe origem/caminho da assinatura, não transmite bearer ao Storage e não repete upload incerto. Rotas e contrato testados com serviços substitutos; nenhum arquivo real enviado remotamente. |
| Paridade | Os 49 controles originais permanecem. Painel original, serviços legados e suas proteções foram preservados. |

## Modos separados, sem fallback silencioso

- **Prévia estática**, porta 4176: dados fictícios e estado em memória; agora importa XLSX localmente. Continua sem autenticação, API, banco, modelo de IA ou transmissão de mídia.
- **Consulta legada**, `/campanhas/`: até 100 registros no recorte, somente leitura. Oferece link explícito para os rascunhos UUID; não migra nada ao abrir a página.
- **Preparação UUID**, `/campanhas/?fonte=uuid`: cliente e serviço preparados para a migração e contas homologadas. No servidor entregue, `allowWrites`, `allowExecution`, `allowAI` e `allowMedia` permanecem **false**. A tabela privada de opt-in também não libera contas por padrão. Não existe ativação por parâmetro de URL.

O teste ponta a ponta ativa esses gates apenas no aplicativo de teste isolado: navegador → sessão → HTTP → PostgreSQL/PGlite sintético. Criar, editar, remover destinatário e recarregar a página conserva os dados desse banco de teste. Isso não prova migração remota, persistência após reinício de um Supabase real ou homologação em celular físico.

## Proteções verificadas

- Tabelas novas privadas, RLS habilitada e sem acesso direto de `anon`, `authenticated` ou `service_role`; RPCs limitadas ao papel autenticado, conta ativa, titular e opt-in quando há escrita.
- Revisão/CAS impede uma edição ou remoção repetida de alterar a versão errada. Criação repetida com mesmo pedido/intenção devolve o rascunho; intenção diferente dá conflito. Escritas não são repetidas automaticamente após erro de rede/401.
- Revalidação de dono, identidade e contexto após operações assíncronas. Nada de retornar conteúdo da conta anterior ou trocar de instância silenciosamente.
- XLSX: 4 MB compactados, 15 MB expandidos, 250 entradas, CRC e cabeçalhos/caminhos verificados, ZIP reconstruído, limites de linhas/colunas/células/nós/profundidade, rejeição de DTD, entidades, relações externas/disfarçadas e coordenadas esparsas excessivas. Biblioteca MIT local com licença; sem CDN.
- Salvar não inicia nem agenda execução. No ambiente entregue, início permanece desabilitado. O cliente agora pode habilitar os controles somente com o opt-in HTTP de execução e gates persistentes correspondentes; habilitar apenas rascunhos não libera início. Respostas comuns e pedidos de descadastro não geram nova automação.

## Validação histórica da preparação (anterior ao executor)

- **45 testes de Campanhas aprovados**, sendo 23 acrescentados nesta continuação aos 22 da etapa anterior.
- **148/148** na seleção de regressão, incluindo as campanhas antigas e as telas anteriormente aprovadas.
- Suíte completa: **554/556**. Restam as duas falhas históricas `ienvia-branding.test.mjs` e `static-release-package.test.mjs`, sem mudança desses testes para obter aprovação artificial.
- **62 assets estáticos** verificados; nenhum runtime/API ou sessão incluído na revisão estática.
- Os 57 arquivos de trabalho anteriores foram preservados: 55 por igualdade direta e os dois arquivos de roteamento por reconstrução removendo apenas as adições intencionais de Campanhas.

Evidências: `campaigns-integrations-selected.log`, `campaigns-integrations-full-suite-final.log`, `campaigns-integrations-evidence.json` e testes `campaigns-drafts-*`, `campaigns-native-browser`, `campaigns-server-gates`, `campaigns-writer` e `campaigns-xlsx-browser`, em cópia isolada sem credenciais operacionais.

## Executor local e fronteira de ativação

A migração `07000`, executor dedicado, portas de transporte, mídia privada/voz, coordenação IA, polling opt-in e compositor de worker foram acrescentados. O cliente nativo e a API têm início, pausa, retomada, pular, cancelamento, edição futura, remoção manual e conferência exata. O ciclo completo foi comprovado por cliente JavaScript/HTTP/PGlite e providers falsos. O módulo de sessão compartilha a exclusividade de envio manual/campanha; as guardas genéricas `AUTOMATION_INTEGRATION_PENDING` continuam intactas, sem usar envio manual para disfarçar campanha.

**Falta a ativação operacional autorizada, não outra tela fictícia:** aplicar/homologar migrações no ambiente aprovado, conectar a composição aos processos e handlers reais, comprovar separação dos caminhos legados e coordenação da IA, validar conta/lease/binding e só então testar com número/provedor real. `coordination_ready` não pode ser ligado como substituto dessa prova. Detalhes, cobertura e limites em `CAMPANHAS-EXECUTOR-LOCAL.md`.

Nesta continuação: **34/34 testes novos**, suíte geral **588/590**, build/verificador **62 assets**. Nenhum commit, push, deploy, SQL remoto, QR, conexão ou envio real.

## Decisões respeitadas

- Listas coladas e arquivos, sem adicionar seleção pelo CRM nesta etapa.
- Destinatários existentes ou novos; manter aviso de consentimento e proteções já existentes.
- Resposta comum não gera pausa automática da campanha; IA já habilitada atende segundo o treinamento. Nenhuma nova automação de resposta, descadastro ou bloqueio foi acrescentada.
- Instâncias identificadas por UUID e nome livre, sem copiar o teto de três chips do legado.
- Permissões CRM/IA/campanhas independentes. Salvar rascunho não habilita IA nem inicia campanha.
- Offline bloqueia comandos, sem fila, troca silenciosa de instância ou reenvio de tentativa incerta.
- Referência visual: Conversas aprovado, com a folha `workspace-theme.css`. Layout e controles do original foram reaproveitados e lapidados, não substituídos por um aplicativo de organização diferente.

## Entrega desta rodada

Nova MPA local `/campanhas/`, HTML em `public/v2/campaigns.html`. A navegação geral e o link Campanhas do CRM passam a apontar para essa rota na árvore local. A demonstrativa estática também inclui a rota. O painel original e seus arquivos de campanha permanecem intactos.

| Recurso | Demonstração local | Aplicação autenticada |
|---|---|---|
| Lista, busca por nome e filtro de status | Em memória; exemplos de rascunho, ativa, pausada e concluída | GET do legado, até 100 registros no recorte atual; limite explicitado |
| Detalhes, resumo e destinatários | Em memória, com paginação | GET autenticado, vínculo de conta validado; resumo ausente/inconsistente não vira zero |
| Criar e editar rascunho | Funcional em memória, preservando destinatários na edição | Escrita deliberadamente desabilitada até integração UUID |
| TXT colado, arquivo TXT e CSV | Leitura local após escolha explícita; amostra, personalização, inválidos/duplicados, separador e invalidação de prévia | Sem importação operacional nova |
| Excel/XLSX | Lugar no fluxo preservado, com impedimento explicado; não finge importar | Integração segura pendente; original continua disponível |
| Texto fixo, spintax, rodízio e campos | Editor, contrato estrito e validação da sintaxe/campos | Leitura dos registros legados, sem alterar plano |
| Variações com IA | Controles originais preservados; geração explica pendência e permite escolher texto original | Não chama provedor de IA |
| Blocos de texto, imagem e áudio, ordenação e exclusão | Funcional em memória; escolha sequencial/aleatória e nota de voz/anexo mantidas | Sem edição real |
| Pastas e arquivos de mídia | Criar pastas, listar/excluir metadata e simular inclusão após escolha explícita | Lista GET do legado; nenhuma URL assinada ou mídia privada é buscada |
| Transferência de mídia | Apenas nome, tipo e tamanho em memória; não lê/transmite bytes da mídia, não cria URL | Upload/finalização reais pendentes |
| Saída fixa ou rodízio | UUIDs explícitos; teste com quatro instâncias, sem seleção padrão | Não converte UUID em `slot_1` nem executa campanha nova pelo contrato antigo |
| Agenda, dias, fuso, intervalos e lotes | Campos e validações funcionais; configurações preservadas | Sem timer de execução ou scheduler ativado |
| Iniciar, pausar, retomar e pular pausa | Somente alteração simulada em memória, com elegibilidade e confirmações | Botões desabilitados; transporte recusa qualquer mutação |
| Tentativa incerta | Conferência explícita vinculada ao destinatário, bloco, tentativa e revisão; não retoma automaticamente | Consulta somente leitura; sem resolução real |
| Remoção de próximas etapas | Simulada, manual e confirmada; não desfaz etapas concluídas/em conferência | Sem remoção real |
| Suporte | Cenário somente leitura, sem alterações | O backend legado não suporta impersonação; a aplicação bloqueia a consulta em suporte, em vez de consultar a conta errada |

A demo de Campanhas usa exemplos independentes das outras abas, identificados como tal. Não há catálogo compartilhado, sincronização entre as demos ou persistência em localStorage/sessionStorage. Somente a preferência de aparência mantém seu mecanismo existente. Não interpretar seis instâncias fictícias desta tela como a totalidade da conta ou da base nova.

## Fronteiras de código e segurança

- `campaigns-contract.js`: plano UUID, opções, destinatários e validação; não despacha ou grava dados.
- `campaigns-import.js` e `campaigns-variations.js`: cópias byte-idênticas das funções puras originais, com teste contra divergência. Os módulos originais não foram alterados.
- `campaigns-demo.js`: adaptador em memória; capacidades `demo:true`, `canSend:false`, bloqueios de suporte/offline, revisão otimista e regras de estado. Nenhum fetch, RPC ou timer operacional.
- `campaigns-markup.js` e `campaigns-view.js`: controles originais preservados, dados via `textContent`/`value`, busca/filtro, montagem e descarte. O único timer atualiza o texto de estimativa; não envia, retoma ou consulta automaticamente.
- `campaigns-read-policy.js`: allowlist estrita de consultas GET, sem comandos, filtros de proprietário ou sufixos operacionais.
- `campaigns-reader.js`: valida conta/identidade, DTOs e contexto; recusa escrita mesmo se invocada diretamente.
- `campaigns-app.js`: acesso existente, leitura autenticada somente do legado, proteção de suporte e descarte em mudança de sessão/conta, pagehide e BFCache. Não substitui dados reais por exemplos em caso de erro.
- Cliente de sessão compartilhado: libera somente as consultas de Campanhas previstas. POST/PUT, comandos de início, resolução e upload continuam fora da allowlist. Não foi criado um cliente de autenticação paralelo.
- `src/server.js` e `vercel.json`: somente acréscimo local da rota de documento e rewrites, preservando alterações de trabalho anteriores. Nenhum novo endpoint operacional de campanhas ou SQL foi criado nesta etapa.
- Build demonstrativo: **59 arquivos estáticos**, com verificador atualizado para proibir também `campaigns-app.js`. Cliente de sessão e leitor autenticado não entram no pacote. CSP `connect-src 'none'` permanece ativa.

O plano UUID novo não é enviado à API antiga que só conhece `slot_1..3`. A ponte de identidade, despacho, reservas e permissões ainda precisam ser integrados antes de liberar escrita real. Não basta renomear o campo do legado.

## Regressões prevenidas nesta rodada

- Lista/detalhe e pasta trocados durante consulta: resposta antiga não substitui a seleção atual.
- Lista alterada enquanto a importação é conferida: prévia antiga descartada e salvamento bloqueado até nova conferência.
- Encerramento ou troca de contexto: DOM e estado anteriores removidos; respostas tardias não os repovoam.
- Falha de consulta: não apresenta lista vazia/zeros nem ressuscita resultados anteriores pela busca.
- Controles de escrita desabilitados também nas listagens dinâmicas de arquivos para suporte/leitura.
- Confirmação de um bloco não conclui falsamente toda a sequência da pessoa.
- Decisão de tentativa incerta exige a tentativa exata e não inicia reenvio ou retomada.
- Sem saída padrão silenciosa, conversão de slot desconhecido, escrita fora da conta ou alteração parcial após validação recusada.

## Validação executada

Skills consultadas: frontend-design, codebase-design, differential-review, TDD e webapp-testing. O inventário prévio é `PARIDADE-ORIGINAL-E-REFORMA.md`.

- RED inicial de contrato por módulo inexistente; primeiro GREEN salvou rascunho com quatro UUIDs sem iniciar.
- RED de leitor autenticado; GREEN com leitura permitida e comandos sem acesso ao transporte.
- RED de navegador por rota demonstrativa inexistente; GREEN após integração do build.
- **22 testes novos aprovados**: contrato/adaptador, leitura/sessão, fluxos demonstrativos, aplicação autenticada e respostas atrasadas.
- **125/125 testes selecionados aprovados**, incluindo os 36 de referência de campanhas antigas e regressões de Conversas, Instâncias, Histórico, Conexões, aparência e revisão estática.
- Suíte geral: **531/533**; somente as duas falhas históricas em `ienvia-branding.test.mjs` e `static-release-package.test.mjs` permanecem. Não foram contornadas nem atribuídas à nova tela.
- Chromium em 320, 390, 768 e 1440 px, temas claro/escuro, contraste textual automatizado, overflow, menu móvel/Escape, filtros, editor, mídia simulada e conferência. Duas capturas conferidas, sem multiplicar arquivos.
- Build/verificador estático, checagem de sintaxe e `git diff --check` aprovados. Teste de paridade assegura a permanência dos IDs de controles originais e a igualdade dos dois módulos puros reutilizados.

Evidências em `/home/user/auditoria/arquitetura-v2/`: `campaigns-final-selected.log`, `campaigns-full-suite.log`, logs RED/GREEN, manifesto de integridade e pasta `campanhas-v2/` com duas capturas. Testes executados em cópia isolada, sem `.env`, sessões reais ou rede operacional. Chromium não substitui celular físico nem certificação WCAG.

## Prévia e próximos passos

Prévia local estática: processo **Campanhas · demonstração local**, porta 4176, com abertura inicial em `/campanhas/`. Sem servidor principal, autenticação, banco ou WhatsApp. A demonstração pública anterior não foi atualizada nesta rodada.

Antes de declarar esta aba operacionalmente completa:

1. Backend/adaptador UUID de escrita com CAS/idempotência, dono/suporte, catálogo e permissões no despacho; preservar reservas e tentativas legadas sem fallback silencioso.
2. Integrar e testar XLSX seguro, geração com IA e biblioteca/mídia privada, com validação de arquivo, contexto e privacidade.
3. Coordenação com treinamento/IA existente e execuções por instância; nenhum switch deve habilitar os demais.
4. Finalizar testes locais de integração e manter a lista de paridade atualizada.
5. Somente depois, homologação/ativação externa especificamente autorizada.

Nenhum commit, push, deploy, migração SQL remota, geração de QR, conexão/desconexão ou envio real foi executado nesta rodada.
