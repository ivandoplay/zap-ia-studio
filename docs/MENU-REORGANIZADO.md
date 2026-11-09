# Menu reorganizado — 09/11/2026

## Pedido do titular

Reorganizar o menu lateral do sistema para:

```
Workspace
  Visão geral (/visao-geral/)
  Inbox (/inbox/)
  Campanhas (/campanhas/)
Atendimento inteligente
  IA e automação (submenu: Treinamento, Catálogo & PIX, Áudios, Simulador, Motor de IA)
  Canais e instâncias (submenu: Instâncias, Conexões / Motor, Histórico)
Gestão
  Configurações (submenu: Geral, Segurança, Clientes SaaS — só master)
Acesso (fora do menu)
  /login, /auth/callback, /setup-password
```

Sem Contatos/Relatórios. Somente workspace local; nada publicado; painel antigo (`public/painel.html`) preservado como mestre das páginas geradas.

## O que foi feito

1. **Mestre `public/painel.html`**: bloco `<nav class="nav-menu">` reescrito. Três grupos (Workspace / Atendimento inteligente / Gestão); seções recolhíveis via `<details class="nav-section">` + `<summary class="nav-section-toggle">` com chevron (CSS em `public/styles.css`, variáveis existentes, sem JS). Itens mantêm `data-tab`, IDs e handlers (`navUnreadBadge`, `navCrmBadge`, `navVoiceBadge`, `navMasterUsersBtn`). Rótulo "Conversas" → "Inbox". `navMasterGroupLabel` removido (app.js tolera ausência via `if (masterGroupLbl)`).
2. **Barra inferior mobile**: hub `crm` agora se chama **Inbox** (aria "Inbox do CRM").
3. **Gerador `scripts/gerar-paginas-painel.mjs`**: rota `crm` de `conversas` → `inbox` (título "Inbox"). Duas correções de bugs pré-existentes:
   - injeção de `window.IENVIA_PAGINA` silenciosamente não ocorria (o mestre passou a carregar `/app.js` com `defer` no perf d1111fc e o regex esperava a tag sem `defer`) — corrigido regex para `( defer)?`;
   - cada página gerada marca **estaticamente** o item `.nav-btn.active` (desktop) e o `.mob-nav-btn.active` (hub mobile, via HUB_POR_TAB espelhando `HUB_BY_TAB` de app.js), coerência com o `switchTab()`.
4. **Páginas regeneradas** com `node scripts/gerar-paginas-painel.mjs` (14 arquivos). `public/conversas/` excluído. `--check` passa.
5. **Rotas**:
   - `src/server.js` `PAGINAS_PAINEL`: `/inbox` → `inbox` (novo), `/conversas` → `inbox` (redirect 302 legado), `/historico` → `historico` (a entrada antiga apontava para `conversas`; agora aponta direto).
   - `vercel.json`: rewrites `/inbox`, `/login`, `/auth/callback`, `/setup-password` (com e sem barra) → `/api/index.js`; headers `no-cache` para as novas rotas. `/conversas*` mantidos (→ `/api/index.js` → redirect express para `/inbox/`).
6. **Páginas standalone novas** (sem sidebar, sem app.js, CSS inline, pt-BR):
   - `/login/`: formulário real → `POST /api/auth/login`; em sucesso grava `zapia_cloud_auth` no `localStorage` (mesmo contrato do painel) e redireciona para `/visao-geral/`.
   - `/auth/callback/`: processa `#access_token`/`error` da URL (convite/recuperação); grava `zapia_cloud_auth` com os tokens recebidos; sem chamadas de rede; estados processando/sucesso/erro.
   - `/setup-password/`: validação local real (mínimo 8, confirmação); a ativação por link de convite assinado fica para a implantação oficial — avisado na própria página; nenhum sucesso falso.
7. **Referências atualizadas**: `tests/painel-paginas-browser.test.mjs` (`/inbox/`), `scripts/preview-visual-review.mjs` e `scripts/capture-crm-parity-review.mjs` mantiveram `/conversas/` (servem o site de revisão, que permanece inalterado). Testes que servem `review-site/public` (conversations-*, workspace-style, history) intocados.
8. **AGENTS.md**: nota de 09/11/2026 no topo.

## Validação

- `node scripts/test-isolated.mjs "painel-paginas"` → **4/4 estáticos OK** (`painel-paginas-browser` não executa neste ambiente: Chromium arm64 não inicia — símbolo `atk_*`/`g_*` ausente, sem apt/libatk; ambiente Android/PRoot).
- `node scripts/gerar-paginas-painel.mjs --check` → páginas iguais ao mestre.
- Scripts inline das 3 páginas novas passam em `node --check`.
- `vercel.json` parseia como JSON válido.
- Suíte não-navegador (exclusão `^(?!.*browser)(?!.*playwright)`): **589 pass / 17 fail**, todos sem relação com o menu — `static-release-package` (falha histórica de release assinado), `ai-settings-connection` (import absoluto pré-existente `/home/user/repo/...`), `accounts-v2` (subteste pede `src/shared/contracts/accounts-store.js`, inexistente no repo), e os demais eram artefatos do teto de 850s do runner serial — reexecutados individualmente (`storage-phone-identity`, `update-signature`, `training-v2-runtime`, `trueclock-whatsapp`): **12/12 pass**.
- Smoke estático via express local: `/inbox/`, `/visao-geral/`, `/login/`, `/auth/callback/`, `/setup-password/`, `/painel.html`, `/styles.css` → todos **200** com conteúdo esperado.
- Não houve captura visual (sem navegador disponível) nem publicação. Dados sintéticos inexistentes — páginas estáticas apenas no mestre/geradas.

## Limites e pendências

- **Homologação visual/mobile pendente**: abrir `/inbox/`, `/visao-geral/` etc. num navegador real (ou PWA instalado) e revisar o novo menu. Nada aéreo de CSS foi medido além da revisão manual das regras.
- Teste de navegador `painel-paginas-browser` deve rodar num ambiente com Chromium funcional (ou CI).
- `/setup-password` e `/auth/callback` são shells honestos: **não** emitem/validam convite real; a ativação fica para a implantação oficial com o fluxo de auth definitivo (Supabase/Auth).
- O site estático de revisão (`review-site/`) mantém `/conversas/` e não foi regenerado — decisão deliberada: só o operacional mudou.
- Nenhum deploy foi feito. Publicação só mediante pedido explícito, como hoje.
