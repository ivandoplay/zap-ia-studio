# Revisão visual isolada do Ienvia

Branch de trabalho: `review/reforma-visual`.

Este diretório é a raiz de um **projeto Vercel separado**. Não usar o projeto principal nem copiar variáveis de ambiente de produção para ele.

- Conteúdo público: apenas `public/`, validado por hash no build.
- Sem APIs, funções serverless, dependências de runtime, autenticação, credenciais ou acesso a banco/WhatsApp.
- CSP bloqueia conexões de rede; a interface não tenta ler a sessão do aplicativo.
- Visão geral e Conexões / Motor são as duas páginas disponíveis; os demais menus indicam áreas ainda não reformadas.
- Números, chips e dispositivos são demonstrações explicitamente identificadas, não dados do titular.
- Cenários: padrão, vazio, desatualizado, falha simulada e suporte visual. Tema salvo somente no navegador da revisão.

## Atualizar depois de trabalhar numa aba

Na raiz do repositório:

```sh
node scripts/build-visual-review.mjs
npm test -- 'review-static|connections-page|dashboard-'
```

O gerador copia somente uma allowlist de assets da interface. Não lê `.env`, dados locais ou APIs. Versionar os assets gerados junto com o código-fonte; o teste confere se o snapshot ainda corresponde às fontes.

Configuração do projeto de revisão: `rootDirectory=review-site`, framework `Other/null`, build `npm run build`, output `public`. Não configurar secrets. A branch tem auto-deploy desativado no `vercel.json` da raiz para não gerar um deploy do backend no projeto principal. O `vercel.json` deste diretório é exclusivo da revisão estática.

O código funcional e a migração pendente são versionados na branch, mas **não são executados por este site**. Nenhuma migração é aplicada pelo build. A URL de revisão não substitui aceite autenticado ou teste de produção.

## Projeto separado criado

- Nome: `ienvia-reforma-visual`.
- ID: `prj_2plMn5ELqUQ3CAVqYvp6NtQSDoBH`.
- A branch de revisão é habilitada no config deste diretório; `main` fica desabilitada neste projeto. Isso não modifica as configurações do projeto principal.
- A proteção de acesso padrão da Vercel pode exigir login Vercel. Ela não é autenticação do aplicativo. Verifique a URL sem sessão antes de divulgar como pública.
