# Padronização visual — 4 de novembro de 2026

## Escopo aprovado

Aplicar às telas já reformadas a paleta e o acabamento de `/conversas/`, sem trocar menus, rotas, permissões ou funções. A interface de Conversas aprovada permanece como referência e não foi redesenhada nesta etapa.

## Implementação

- Folha compartilhada `public/v2/assets/workspace-theme.css`, carregada por último nas telas de Visão geral, Instâncias, Histórico e Conexões.
- Escuro: superfícies `#121b27`, lateral `#0e151f`, texto `#e9edef` e apoio `#a5b4c6`; verdes reservados aos destaques e ações.
- Claro: superfícies brancas, fundo `#efeae2`, texto `#17242b` e apoio `#586871`.
- Mesmas faixas de largura da lateral de Conversas: 195, 216 ou 230 px no desktop; 240 px no menu móvel. Cabeçalho de 56 px no desktop e 49 px no móvel.
- Marca, tipografia, navegação, conta, cartões, formulários, modais e avisos harmonizados. A conta aparece ao pé da lateral, sem mudar os links ou os controles existentes.
- Cor da barra do navegador alinhada ao tema. Preferência de aparência e persistência mantidas.
- A moldura demonstrativa de abas em preparação recebe o mesmo estilo; isso não significa que essas abas tenham sido implementadas.
- Build da revisão mantém allowlist explícita e 51 arquivos estáticos. Sem servidor operacional, credenciais, banco, sessão real ou API.

## Verificação

Novo teste `tests/workspace-style-browser.test.mjs` começou falhando pela diferença real entre as paletas e larguras. Após a padronização, compara tokens e moldura com Conversas nos dois temas, verifica contraste textual nas telas demonstrativas, menu móvel, Escape, busca, ausência de overflow e larguras de 390, 1024, 1280, 1440 e 1600 px.

Seleção de testes de aparência, navegação, páginas, CRM e revisão estática: **57/57 aprovados**. Não representa certificação WCAG ou teste em celular físico. Capturas locais limitadas a uma de desktop escuro e uma de móvel claro para preservar a cota do workspace.

O backend local anterior, migrações SQL e demais alterações de trabalho ficam fora deste commit visual. Publicação permitida somente no projeto demonstrativo separado, na branch `review/reforma-visual`; nenhuma alteração no projeto principal, `main`, banco remoto ou operação WhatsApp.
