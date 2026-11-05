# Treinamento da IA — implementação local

Atualizado em 04/11/2026. Escopo delegado: concluir criação e testes no workspace, preservando o painel original; implantação oficial somente depois. **Não é uma ativação do cérebro em uso nem uma declaração de paridade operacional integral.**

## Entrega

- Página nativa `/treinamento/`, com a aparência de Conversas, menu existente e temas escuro/claro; revisão estática separada com dados fictícios.
- Identidade da empresa/profissional, modo individual e rótulos em primeira pessoa; nome de quem atende, nicho, tom, resumo, pagamentos/entrega, regras e instruções.
- Trava até retomada manual e escudo IA preservados, inclusive valores `false` explícitos. Nenhuma nova regra de descadastro, resposta ou automação operacional.
- FAQ e conhecimento TXT/CSV/MD/JSON, com inclusão e remoção confirmada. Documentos em UTF-8, limite de 30 mil caracteres, sem truncamento silencioso.
- Estúdio: mensagens aprovadas, skills operacionais e de humanização; filtro, criação, edição e remoção. IDs, campos futuros, objeções, personas e demais campos do pacote são preservados quando não editados.
- Modelos públicos provenientes de `src/templates.js`, copiados sem alteração em `training-templates.js`. Não são o catálogo privado de pacotes da master. Aplicação confirmada substitui textos/estúdio do rascunho, preservando documentos; não altera PIX, Catálogo ou áudios em uso.
- Importação ZIP/JSON/MD/TXT e conteúdo colado, com conferência antes de substituir o rascunho. Na integração autenticada, usa o compilador **original** em memória e isolado por conta; não há novo motor de treinamento.
- Gerador assistido: briefing, prompt/especificação para ChatGPT/Vibe Coding, download Markdown/modelo JSON e área para colar o resultado. Não chama serviços externos nem modelos pagos.
- Prévia nativa chama o `buildSystemPrompt` original com o pacote do rascunho em `tenantStorageContext` descartável. Não gera respostas, abre sockets ou envia mensagens. A demo identifica sua prévia como **estrutural**, não como prompt exato.

O inventário contém os **32 IDs de controles do trecho original**, preservados na nova página e conferidos no navegador. Presença do controle não é, sozinha, prova de paridade operacional. Referências originais: `public/painel.html`/`public/app.js`, `src/templates.js`, `src/trainingPackEngine.js` e `src/aiEngine.js`.

## Duas fronteiras distintas

| Ambiente | Dados e efeito |
|---|---|
| Revisão estática | Dados fictícios. Edição somente em memória; perde-se ao sair/recarregar. Não lê sessão, consulta API, banco, IA ou WhatsApp. No modo de demonstração, MD/TXT entra como instruções; compilação M/S/H exata fica na integração nativa. |
| Página nativa autenticada | Sessão/PIN existentes; origem local explícita e rascunho privado por UUID. O registro no servidor está com **`allowWrites:false`**. A composição sintética dos testes habilita gravação somente em diretórios descartáveis. |
| Nuvem / versão oficial | Sem adaptação de leitura proprietária homologada e sem persistência remota nova. Retorna indisponibilidade explícita; não busca dados globais nem inventa uma cópia vazia. Ativação não implementada nesta API. |

O botão é **Salvar rascunho**, não “ativar treinamento”. Não existe rota `/activate`. Não foram modificados `storage.data.business`, pacotes ativos, catálogo, PIX, biblioteca de áudio ou configurações do provedor pela nova API.

## Backup: distinção importante

**Exportar rascunho (.ZIP)** conserva o documento de edição, FAQ, conhecimento, pacote compilado com seus campos desconhecidos e anexos importados, inclusive OGG binário. O documento principal permite ida e volta sem recompilar ou perder campos futuros. Importações de backup legado também guardam os arquivos originais como anexos.

Isso **não é** uma cópia integral dos arquivos de áudio já instalados no atendimento. O backup completo original continua disponível no painel original, com um acesso explícito na página nativa. Sua transferência para o novo mecanismo privado depende da etapa Catálogo/Áudios; não se usa o diretório global de uploads como atalho multi-tenant. A demo não abre o painel real.

## Implementação

- `public/v2/training.html` e `training-{app,view,domain,archive,store,templates}.js`, `training.css`.
- `src/training/router.js`: contrato explícito de contexto; GET, PUT do rascunho e POST de prévias de prompt/importação.
- `src/training/repository.js`: arquivo privado por UUID, revisão/CAS, último pedido com intenção conferida, lock exclusivo, escrita temporária sincronizada e rename atômico; permissões `0600`, diretório criado com `0700`.
- `src/training/runtimePreview.js`: construtor original, contexto em memória `isCloudTenant:true`, papel `user` mesmo quando o operador é master; impede fallback para pacote privado/global.
- `src/training/importPreview.js`: compilador original com contexto isolado. Valida o ZIP antes e recompõe uma entrada **somente textual** para o importador antigo. OGG e outros binários permanecem anexos; nunca chegam ao trecho antigo que restaura arquivos em `UPLOADS_DIR`.
- `src/server.js`: rota opt-in, classificação explícita no middleware dashboard e composição com escrita desligada. Leitura global do pacote original só para master local na própria conta; usuário comum não recebe fallback master.
- `session-client.js`: allowlist exata e mutações sem refresh/replay automático. Suporte master pode ler somente o alvo autorizado e não grava. Mudança de conta/PIN/suporte invalida requisição/resposta; perda de sessão remove conteúdo da interface.

Rotas:

| Método | Caminho | Efeito |
|---|---|---|
| GET | `/api/training-v2` | Origem local e rascunho da conta autenticada, revisão, capacidades e alerta de origem alterada. |
| PUT | `/api/training-v2/draft` | Exige opt-in da composição, próprio titular, revisão e UUID de pedido. Só salva documento de rascunho. |
| POST | `/api/training-v2/preview` | Constrói texto de prévia; sem provedor. |
| POST | `/api/training-v2/import-preview` | Compila em memória; não salva o rascunho nem instala anexos. |

Não aceitar `ownerId`, revisão ou fingerprint dentro do documento. A conta vem do contexto autenticado. Não ativar a escrita por query, cabeçalho, botão ou variável recebida do navegador. Origem ausente falha explicitamente. A origem atual é fingerprintada; mudanças posteriores são sinalizadas e não substituem silenciosamente o rascunho.

Locks pendentes não são roubados por timeout. Reparo local de lock após falha de processo requer conferência administrativa, sem criar replay automático. O repositório é preparação **local**, não substitui transação/RLS de persistência distribuída.

## Limites e conteúdo não confiável

- Documento total: 2 MB; entradas e profundidade limitadas; chaves de protótipo recusadas.
- ZIP até 4 MB, 200 entradas, expansão total até 8 MB, até 2 MB por entrada e proporção de expansão limitada. CRC, cabeçalhos/diretório, tamanho, métodos, nomes duplicados, sobreposição, symlink e traversal são conferidos. Não extrai para o sistema de arquivos.
- Base64 e paths dos anexos validados; HTML em mensagens/docs é texto literal. Nada é executado nem buscado a partir de URLs do material importado.
- Importação simples nativa em texto até 28 mil caracteres para não depender do truncamento silencioso do compilador original. Materiais maiores precisam ser divididos ou estruturados em pacote dentro dos limites.
- Modelo, importação e remoções são confirmados. Nada é salvo em segundo plano. Sem rede, nada fica em fila; conflito/resultado incerto exige consulta manual.

## Validação local

- **41/41 testes novos de Treinamento**, em seis arquivos `tests/training-v2*.test.mjs`.
- **74/74 selecionados**, incluindo regressão de sessão/dashboard, Campanhas nativas, gates do servidor, isolamento original e revisão estática.
- **629/631 suíte completa**; permanecem somente as duas falhas históricas `ienvia-branding.test.mjs` e `static-release-package.test.mjs` (release assinado/versão), sem alteração para mascará-las.
- **69 assets estáticos**, build + verificador de manifesto, sem app autenticado/cliente de sessão/funções no pacote de revisão.
- Chromium: fluxo nativo sessão → HTTP → arquivo temporário, recarga persistente, estúdio, FAQ editada depois de skills, documento, backup, gerador/colagem com compilador original, conflito em duas abas e limpeza na troca de sessão. Demonstração com suporte/falha, HTML literal, diálogos, 1440/390/320 px e dois temas; sem API/leitura de sessão/overflow nas verificações estáticas. Não equivale a auditoria WCAG completa ou homologação em aparelho físico.

Logs/evidências: `/home/user/auditoria/arquitetura-v2/training-*.log`, `training-original-inventory.json`, `training-static-browser-evidence.json` e `training-evidence.json`. A primeira execução geral também apontou manifesto estático desatualizado; foi regenerado e a seleção/reexecução geral corrigiram essa terceira falha.

Preview seguro: `PORT=4177 REVIEW_START_PATH=/treinamento/ node scripts/preview-visual-review.mjs`. Serve somente `review-site/public`, sem importar o servidor operacional ou `.env`. Não iniciar o servidor principal para avaliar o visual.

## Continuação

Próxima aba da sequência: **Catálogo/Áudios**, conferindo recursos originais e a relação com composição, biblioteca de voz, simulação e campanhas. A migração do backup integral e a integração proprietária de origem/persistência devem continuar explicitamente acompanhadas; não chamar Treinamento de totalmente migrado para produção.

Nenhum SQL remoto, deploy, commit/push, mudança de plano, conexão WhatsApp, chamada a IA paga ou envio real nesta etapa. O bloqueio de branch Supabase anterior não foi repetido nem contornado.


### Atualização após a etapa Catálogo/Áudios

A implementação local de Catálogo/Áudios e de anexos privados novos está documentada em `CATALOGO-AUDIOS-LOCAL.md`. Ela não migrou os binários globais/externos antigos: a distinção entre backup do rascunho e backup integral do atendimento acima continua válida. A próxima aba passou a ser Simulador. Não marcar o backup integral original como concluído somente por essa nova interface.
