# Ienvia — auditoria, etapa 1: inventário e mapa inicial

**Referência:** 28/10/2026 · versão 5.8.14 · commit `0e23bd4`.  
**Escopo:** 91 arquivos rastreados e 1 arquivo não rastreado não ignorado; 92 arquivos no inventário. O Git também registra uma alteração local prévia em `docs/BIBLIOTECA-NORTH.md`, preservada nesta tarefa. O não rastreado é `docs/INVENTARIO-SKILLS.md`, também prévio.

**Estado real:** inventário de arquivos e reconhecimento inicial concluídos. A análise detalhada linha por linha, a revisão de segurança, as correções e os testes do produto **não foram realizados nesta etapa**. “Mapeado” não significa “auditado”.

## Como o inventário foi montado

- Fonte: `git ls-files` para arquivos rastreados e `git ls-files --others --exclude-standard` para não rastreados não ignorados. Foram conferidos nomes, tamanho, classificação, linhas de arquivos textuais e SHA-256. Os arquivos rastreados foram lidos para calcular seus hashes; dados locais ignorados não foram abertos.
- O arquivo `inventario-arquivos.csv` traz uma linha por arquivo, o estado, sua categoria, identificação e hash para identificar alterações futuras. A descrição é inicial, não comprova todos os comportamentos.
- 44,507 linhas textuais no conjunto completo, incluindo testes, documentos e bibliotecas de terceiros; **não é uma contagem apenas de código próprio**. Não usar este número como medida de qualidade ou de trabalho já auditado.
- Privacidade: dados locais ignorados, sessões, credenciais Git e arquivos `.env` reais estão fora da leitura e do inventário. Há uma exceção importante: `data/training_packs/lizandro-v-turbo.json` é rastreado pelo Git e foi catalogado; suas chaves incluem `appliedConversations`. Ainda não foi verificado se o conteúdo inclui dados pessoais. Tratar como potencialmente sensível e verificar com cuidado antes de qualquer publicação adicional. Skills em `.agents/` são material de apoio, não código do produto. Bibliotecas e fontes em `public/vendor/` e `public/fonts/` são catalogadas separadamente, assim como o lockfile; não se confunde a auditoria de uso/versões com revisão linha a linha do código de terceiros.
- O inventário reflete esta cópia e esta data: se houver novos arquivos, atualizar e comparar os hashes antes de marcar a revisão como concluída. Não listar nem copiar segredos ou dados de produção.

## Distribuição por área

| Área | Arquivos |
|---|---:|
| Banco de dados | 1 |
| Configuração e dependências | 7 |
| Código servidor e motor | 17 |
| Documentação | 6 |
| Entrada Vercel | 1 |
| Identidade e mídia | 7 |
| Instalação e distribuição | 19 |
| Pacote de treinamento rastreado | 1 |
| Painel e PWA | 5 |
| Scripts públicos | 1 |
| Terceiros: bibliotecas e fontes | 6 |
| Testes | 18 |
| Vitrine | 3 |

## Mapa preliminar — ligações observadas

- `api/index.js:1` importa `src/server.js`, entrada da aplicação na Vercel. `package.json` aponta para `src/server.js` como entrada local; `vercel.json` contém configuração de entrega. A diferença de comportamento entre ambientes ainda requer análise.
- `public/index.html:11,329` referencia os arquivos da vitrine `spatial.css` e `spatial.js`. `public/painel.html:10,12,2929` referencia o manifesto, o CSS e `app.js` do painel.
- `src/server.js` referencia módulos de IA, PIX, áudio, nuvem e outros (linhas 62–70); `src/whatsappManager.js:14–38` referencia autenticação, diário, IA, áudio e nuvem. Essas importações mostram acoplamentos, **não comprovam um fluxo de ponta a ponta**.
- `src/storage.js:12–17,28,34–60` define diretórios, contexto de armazenamento e chaves de slots. `src/supabaseCloud.js` contém integração Supabase. Segurança e isolamento efetivos continuam por verificar nas próximas etapas.
- `supabase/migrations/20261028_proteger_cota_chips.sql` é a migração presente nesta cópia do repositório. Ela não prova que todas as tabelas, funções e políticas em produção estão versionadas aqui; o estado remoto exigirá verificação própria, sem alterações destrutivas.

## Pontos para atenção, não conclusões de defeito

O pacote de treinamento rastreado merece revisão de privacidade: sua presença no Git e a chave `appliedConversations` não provam, por si, exposição de dados reais. Arquivos extensos precisam ser divididos em blocos de leitura e cruzados com testes: `public/app.js` (8.480 linhas), `src/whatsappManager.js` (3.929), `src/server.js` (3.553), `public/painel.html` (2.931), `src/supabaseCloud.js` (2.803) e `src/storage.js` (1.889). Tamanho, sozinho, não prova erro. Os totais são da referência acima e devem ser recalculados se os arquivos mudarem.

## Lotes para a sequência

1. **Estrutura e fluxos:** entradas, configuração, imports e testes; rastrear uma operação bem-sucedida e uma falha com evidências. Sem classificar o sistema inteiro como seguro antes da revisão.
2. **Segurança e tenants:** login, permissões, RLS e acesso em `src/server.js`, `src/supabaseCloud.js`, `src/storage.js`, migrações e testes. Validar cenários sintéticos de duas contas, sem acessar dados privados desnecessariamente.
3. **WhatsApp e chips:** motor, autenticação, pareamento, comandos e testes, observando a regra de não criar socket concorrente e de não reenviar sem confirmar resultados incertos.
4. **Histórico e dados:** diário, storage, sincronização, exclusões, backups e respectivos testes; não confundir processamento simulado com recuperação real do WhatsApp.
5. **Funcionalidades:** IA, mídia, CRM, PIX, catálogo, cobrança e treino, incluindo interações com UI e banco.
6. **Site e painel:** HTML, CSS, JavaScript, acessibilidade, responsividade, cache e testes visuais.
7. **Distribuição e operações:** scripts portáteis, ZIP, atualizações, dependências e Vercel. Verificar versões/licenças de terceiros separadamente.
8. **Verificação final:** regressões, problemas remanescentes, evidências e diferenças entre testes isolados e reais.

Para cada lote: registrar arquivos e intervalos de linhas efetivamente lidos, hipóteses, evidências, testes e resultados; corrigir problemas confirmados de forma pequena e compatível e testar a regressão. Não alterar dados, desconectar contas, abrir outro socket ou publicar mudanças como parte deste inventário.

## Skills consultadas e aplicadas

- `architecture-review`: identificar entradas, limites e dependências; distinguir hipótese de comportamento comprovado.
- `writing-plans`: separar o trabalho em lotes verificáveis e indicar arquivos envolvidos.
- `code-review-and-quality`: organizar revisões por correção, segurança, arquitetura, legibilidade e desempenho.
- `verification-before-completion`: confrontar o inventário com a lista do Git e não anunciar testes ou auditorias não executados.

O conteúdo de skills de terceiros não autoriza acesso a segredos, operações financeiras, instalações ou mudanças externas.

## Arquivos inventariados

A relação detalhada, com classificação individual, está em `inventario-arquivos.csv`. Resumo completo abaixo; todos com **revisão detalhada pendente**.

| Arquivo | Área | Linhas | Função inicial |
|---|---|---:|---|
| `.env.example` | Configuração e dependências | 20 | Configuração do projeto e ambiente |
| `.gitattributes` | Configuração e dependências | 4 | Configuração do projeto e ambiente |
| `.gitignore` | Configuração e dependências | 28 | Configuração do projeto e ambiente |
| `.npmrc` | Configuração e dependências | 9 | Configuração do projeto e ambiente |
| `1_Instalar_No_Windows.bat` | Instalação e distribuição | 35 | Instalação, atualização ou material de distribuição |
| `2_Iniciar_Atendente_IA.bat` | Instalação e distribuição | 24 | Instalação, atualização ou material de distribuição |
| `3_Criar_Atalho_Area_de_Trabalho.bat` | Instalação e distribuição | 16 | Instalação, atualização ou material de distribuição |
| `4_Instalar_No_Termux.sh` | Instalação e distribuição | 49 | Instalação, atualização ou material de distribuição |
| `5_Iniciar_No_Termux.sh` | Instalação e distribuição | 87 | Instalação, atualização ou material de distribuição |
| `AGENTS.md` | Documentação | 8 | Documentação e instruções |
| `LEIA-ME_COMO_USAR.md` | Documentação | 78 | Documentação e instruções |
| `api/index.js` | Entrada Vercel | 3 | Entrada Vercel |
| `data/training_packs/lizandro-v-turbo.json` | Pacote de treinamento rastreado | 4914 | Pacote JSON de treinamento versionado; verificar conteúdo e privacidade com cautela |
| `dist_kit/Ferramentas_Extras/Linux_Criar_Atalho_Desktop.sh` | Instalação e distribuição | 4 | Instalação, atualização ou material de distribuição |
| `dist_kit/Ferramentas_Extras/Linux_Reparar_Sistema.sh` | Instalação e distribuição | 4 | Instalação, atualização ou material de distribuição |
| `dist_kit/Ferramentas_Extras/Termux_Instalar_ou_Reparar.sh` | Instalação e distribuição | 15 | Instalação, atualização ou material de distribuição |
| `dist_kit/Ferramentas_Extras/Windows_Criar_Atalho_Desktop.bat` | Instalação e distribuição | 14 | Instalação, atualização ou material de distribuição |
| `dist_kit/Ferramentas_Extras/Windows_Reparar_Sistema.bat` | Instalação e distribuição | 18 | Instalação, atualização ou material de distribuição |
| `dist_kit/GUIA_VIBE_CODER_TREINAMENTO.md` | Instalação e distribuição | 267 | Instalação, atualização ou material de distribuição |
| `dist_kit/INICIAR_NO_LINUX.sh` | Instalação e distribuição | 13 | Instalação, atualização ou material de distribuição |
| `dist_kit/INICIAR_NO_TERMUX.sh` | Instalação e distribuição | 172 | Instalação, atualização ou material de distribuição |
| `dist_kit/INICIAR_NO_WINDOWS.bat` | Instalação e distribuição | 26 | Instalação, atualização ou material de distribuição |
| `dist_kit/LEIA-ME.txt` | Instalação e distribuição | 62 | Instalação, atualização ou material de distribuição |
| `dist_kit/MANUAL_OFICIAL.html` | Instalação e distribuição | 409 | Instalação, atualização ou material de distribuição |
| `docs/BIBLIOTECA-NORTH.md` | Documentação | 219 | Inventário de biblioteca North (modificado antes desta tarefa) |
| `docs/INVENTARIO-SKILLS.md` | Documentação | 34 | Inventário de skills (não rastreado antes desta tarefa) |
| `docs/LAPIDACAO-NORTH.md` | Documentação | 42 | Documentação e instruções |
| `package-lock.json` | Configuração e dependências | 2619 | Versões fixadas das dependências |
| `package.json` | Configuração e dependências | 29 | Dependências diretas e execução |
| `public/GUIA_VIBE_CODER_TREINAMENTO.md` | Documentação | 267 | Documentação e instruções |
| `public/app.js` | Painel e PWA | 8480 | Lógica do painel |
| `public/atualizar.sh` | Scripts públicos | 174 | Arquivo de scripts públicos |
| `public/fonts/OFL-Manrope.txt` | Terceiros: bibliotecas e fontes | 93 | Código/fonte ou licença de terceiros; avaliar uso e procedência |
| `public/fonts/manrope-latin-ext.woff2` | Terceiros: bibliotecas e fontes | binário | Código/fonte ou licença de terceiros; avaliar uso e procedência |
| `public/fonts/manrope-latin.woff2` | Terceiros: bibliotecas e fontes | binário | Código/fonte ou licença de terceiros; avaliar uso e procedência |
| `public/hero-conversa.webp` | Identidade e mídia | binário | Imagem/ícone distribuído ao usuário |
| `public/icon-v2.svg` | Identidade e mídia | 1 | Imagem/ícone distribuído ao usuário |
| `public/icon.svg` | Identidade e mídia | 1 | Imagem/ícone distribuído ao usuário |
| `public/ienvia-icon-v2.png` | Identidade e mídia | binário | Imagem/ícone distribuído ao usuário |
| `public/ienvia-icon.png` | Identidade e mídia | binário | Imagem/ícone distribuído ao usuário |
| `public/ienvia-logo-v2.png` | Identidade e mídia | binário | Imagem/ícone distribuído ao usuário |
| `public/ienvia-logo.png` | Identidade e mídia | binário | Imagem/ícone distribuído ao usuário |
| `public/index.html` | Vitrine | 331 | Estrutura da vitrine |
| `public/manifest.json` | Painel e PWA | 19 | Manifesto PWA |
| `public/painel.html` | Painel e PWA | 2931 | Estrutura do painel |
| `public/spatial.css` | Vitrine | 21 | Estilos da vitrine |
| `public/spatial.js` | Vitrine | 73 | Interatividade da vitrine |
| `public/styles.css` | Painel e PWA | 4070 | Estilos do painel |
| `public/sw.js` | Painel e PWA | 45 | Service worker / cache |
| `public/vendor/three/LICENSE` | Terceiros: bibliotecas e fontes | 21 | Código/fonte ou licença de terceiros; avaliar uso e procedência |
| `public/vendor/three/three.core.js` | Terceiros: bibliotecas e fontes | 13 | Código/fonte ou licença de terceiros; avaliar uso e procedência |
| `public/vendor/three/three.module.js` | Terceiros: bibliotecas e fontes | 13 | Código/fonte ou licença de terceiros; avaliar uso e procedência |
| `scripts/auto_update_boot.mjs` | Instalação e distribuição | 217 | Instalação, atualização ou material de distribuição |
| `scripts/setup_linux_portable.sh` | Instalação e distribuição | 360 | Instalação, atualização ou material de distribuição |
| `scripts/setup_windows_portable.ps1` | Instalação e distribuição | 405 | Instalação, atualização ou material de distribuição |
| `src/aiEngine.js` | Código servidor e motor | 1412 | Integração e regras de IA |
| `src/audioProcessor.js` | Código servidor e motor | 381 | Conversão de áudio |
| `src/cloudConfig.js` | Código servidor e motor | 43 | Configuração de nuvem |
| `src/cloudSendScope.js` | Código servidor e motor | 18 | Escopo de envio na nuvem |
| `src/commandStatus.js` | Código servidor e motor | 16 | Estado de comandos |
| `src/historyJournal.js` | Código servidor e motor | 40 | Diário local de histórico |
| `src/pairingSafety.js` | Código servidor e motor | 41 | Proteções de pareamento e backup de autenticação |
| `src/pix.js` | Código servidor e motor | 184 | Mensagens PIX |
| `src/server.js` | Código servidor e motor | 3553 | Servidor, rotas HTTP e orquestração |
| `src/storage.js` | Código servidor e motor | 1889 | Armazenamento, contatos e chaves por chip |
| `src/supabaseCloud.js` | Código servidor e motor | 2803 | Acesso à nuvem e comandos do motor |
| `src/templates.js` | Código servidor e motor | 312 | Modelos de configuração |
| `src/trainingPackEngine.js` | Código servidor e motor | 1787 | Pacotes de treinamento |
| `src/trueClock.js` | Código servidor e motor | 99 | Relógio calibrado |
| `src/waCompactAuth.js` | Código servidor e motor | 216 | Estado de autenticação WhatsApp |
| `src/whatsappManager.js` | Código servidor e motor | 3929 | Motor e slots WhatsApp |
| `src/zipReader.js` | Código servidor e motor | 274 | Leitura e criação de ZIP |
| `supabase/migrations/20261028_proteger_cota_chips.sql` | Banco de dados | 32 | Migração de proteção de cota de chips |
| `tests/cloud-send-scope.test.mjs` | Testes | 12 | Teste automatizado: cloud-send-scope.test |
| `tests/command-status-http.test.mjs` | Testes | 35 | Teste automatizado: command-status-http.test |
| `tests/command-status.test.mjs` | Testes | 15 | Teste automatizado: command-status.test |
| `tests/history-bootstrap.test.mjs` | Testes | 70 | Teste automatizado: history-bootstrap.test |
| `tests/history-diagnostics.test.mjs` | Testes | 20 | Teste automatizado: history-diagnostics.test |
| `tests/history-journal-ingest-isolated.test.mjs` | Testes | 24 | Teste automatizado: history-journal-ingest-isolated.test |
| `tests/history-journal.test.mjs` | Testes | 20 | Teste automatizado: history-journal.test |
| `tests/history-protocol-status.test.mjs` | Testes | 28 | Teste automatizado: history-protocol-status.test |
| `tests/history-request-correlation.test.mjs` | Testes | 41 | Teste automatizado: history-request-correlation.test |
| `tests/ienvia-branding.test.mjs` | Testes | 19 | Teste automatizado: ienvia-branding.test |
| `tests/landing-browser.test.mjs` | Testes | 55 | Teste automatizado: landing-browser.test |
| `tests/local-multichip-send.test.mjs` | Testes | 71 | Teste automatizado: local-multichip-send.test |
| `tests/multichip-sync.test.mjs` | Testes | 47 | Teste automatizado: multichip-sync.test |
| `tests/pairing-command-guard.test.mjs` | Testes | 8 | Teste automatizado: pairing-command-guard.test |
| `tests/pairing-safety.test.mjs` | Testes | 19 | Teste automatizado: pairing-safety.test |
| `tests/queued-send-notifications.test.mjs` | Testes | 20 | Teste automatizado: queued-send-notifications.test |
| `tests/sql/guard-cota-chips.sql` | Testes | 41 | Teste automatizado: guard-cota-chips |
| `tests/storage-dedup-performance.test.mjs` | Testes | 32 | Teste automatizado: storage-dedup-performance.test |
| `vercel.json` | Configuração e dependências | 144 | Configuração do deploy |
