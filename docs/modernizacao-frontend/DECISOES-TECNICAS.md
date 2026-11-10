# Modernização do frontend Ienvia

## Objetivo

Modernizar gradualmente a interface do repositório `ivandoplay/zap-ia-studio`, mantendo-o como sistema principal. O repositório `ivandoplay/ienvia` é referência de experiência visual e componentes, não uma fonte de regras de negócio ou de autenticação.

## Decisões confirmadas

- Refinar o visual do protótipo, sem copiar limitações demonstrativas.
- Manter experiência equivalente em celular e desktop.
- Fazer migração gradual, tela por tela.
- Cobrir todos os módulos existentes.
- Preservar backend, banco, autenticação, integrações e funcionalidades.
- Desenvolver em branch separada; não alterar `main` diretamente.

## Estado técnico verificado

### Repositório principal: zap-ia-studio

- `package.json`: aplicação Node.js ESM, Express 4, Node >=20; versão 5.8.28.
- Entrada do servidor: `src/server.js`.
- Entrada serverless da Vercel: `api/index.js`, que exporta `src/server.js`.
- `vercel.json` atual usa `outputDirectory: public`, configura a função `api/index.js` e contém rewrites das rotas legadas para o backend.
- Painel legado: `public/painel.html` e `public/app.js`.
- Sessão do painel legado usa `localStorage` na chave `zapia_cloud_auth`; o objeto contém tokens de sessão. O backend expõe `/api/auth/status`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout` e `/api/auth/verify-pin`.
- O backend valida a origem do navegador antes das rotas `/api` e `/uploads`. CORS isoladamente não é a proteção usada.
- Na Vercel, o middleware de API verifica o token Bearer e instala contexto de tenant/permissões.
- O servidor Node local cria WebSocket em `/ws`; na Vercel o servidor HTTP e o WebSocket local não são criados (`IS_VERCEL`).
- Módulos novos confirmados em `src/server.js`: dashboard, connections, channels, conversations-v3, crm-v2, accounts-v2, security-settings-v2, ai-settings-v2, simulator-v2, resources-v2, training-v2, campaigns-v2 e evolution-cloud.
- Há rotas adicionais legadas; o inventário final de operações deve ser extraído dos routers e dos consumidores reais do frontend, não inferido apenas pelo nome do módulo.

### Repositório de referência: ienvia

- Aplicação em `web/`, Next.js 16.4.5, React 19.1.1 e TypeScript.
- App Router em `web/app/`.
- Layout principal em `web/components/app-shell.tsx`; estilos em `web/app/globals.css`.
- `web/components/workspace-context.tsx` depende de Supabase Auth/workspaces do protótipo e usa um modo de demonstração quando as variáveis públicas não existem. Não deve ser reaproveitado como autenticação de produção sem adaptação.
- O AppShell ainda exibe aviso de protótipo/sessão e componentes com estados demonstrativos.
- `web/proxy.ts` tem comportamento permissivo em modo sem configuração Supabase; não copiar como mecanismo de proteção.

## Implicações arquiteturais

1. O frontend Next.js deve ser introduzido sem substituir o servidor Express nem o painel legado.
2. O projeto Vercel atual tem configuração customizada para servir arquivos estáticos em `public` e a API por `api/index.js`. Colocar Next.js na raiz sem redesenhar o deploy poderia quebrar o contrato atual.
3. A estratégia de deploy deve ser definida após verificar a configuração Vercel e o domínio disponível. Uma implantação separada do frontend exige proxy de API no servidor Next.js ou outra estratégia de mesma origem cuidadosamente validada.
4. Não encaminhar tokens de usuário para serviços externos, não expor chaves privilegiadas no navegador e não desativar a validação de origem do backend para contornar a separação de domínios.
5. O transporte de eventos em tempo real precisa de solução explícita na nuvem, pois o WebSocket criado pelo servidor local não está presente no runtime Vercel.
6. Toda tela migrada deve consumir contratos reais do backend e exibir estados de carregamento, vazio e erro. Dados fictícios não podem ser apresentados como dados reais.

## Sequência de trabalho

1. Fechar inventário de páginas, eventos, endpoints e permissões do painel legado.
2. Mapear páginas/componentes do protótipo que podem ser reaproveitados e identificar mocks.
3. Definir e validar topologia de deploy, proxy autenticado, sessão e tempo real.
4. Preparar a fundação Next.js isolada.
5. Migrar primeiro o shell e a Visão Geral com dados reais.
6. Validar build, tipos, autenticação e comportamento responsivo antes de expandir módulo por módulo.

## Branch de trabalho

`feat/modernizacao-frontend-next`

Criada a partir de `main`. Nenhum arquivo de aplicação ou configuração de produção foi alterado nesta etapa.
