# Estratégia de integração do novo frontend

## Decisão recomendada para a primeira fase

Manter o Express e o deploy atual do `zap-ia-studio` como backend operacional. Construir o Next.js em `web/` como frontend isolado, sem alterar ainda o `vercel.json` da aplicação principal.

A publicação do novo frontend deverá ocorrer em um deployment de homologação separado, com acesso restrito durante o desenvolvimento. A migração de domínio/produção só acontece depois da validação funcional.

## Por que não chamar o backend diretamente do browser em outro domínio

O código `src/browserOrigin.js` foi inspecionado. A validação compara o host da requisição com a origem do navegador. Em ambiente cloud, a origem precisa corresponder ao host que recebeu a requisição.

Logo, um browser aberto em um domínio diferente não deve chamar diretamente o domínio antigo do backend com a própria Origin. CORS não resolve esse contrato e não deve ser enfraquecido.

## BFF / proxy same-origin

A alternativa a validar é um Backend-for-Frontend no Next.js:

1. O browser chama somente rotas same-origin do Next.js.
2. O handler Next valida a origem do browser e aplica proteção CSRF para operações mutáveis.
3. O handler encaminha a requisição ao backend Express configurado em variável server-side.
4. O encaminhamento preserva método, caminho, query, payload e o Bearer token do usuário, mas não repassa a Origin do browser para o backend.
5. O Express recebe uma chamada server-to-server sem Origin de navegador e continua validando o Bearer, tenant, permissões e regras de negócio normalmente.
6. Respostas e cabeçalhos sensíveis são filtrados; segredos de servidor nunca são enviados ao browser.

A implementação deve ser revisada para não criar um proxy aberto: restringir host de destino a uma variável de ambiente validada, restringir prefixos permitidos, limitar tamanho de payload, timeout, métodos e cabeçalhos encaminhados.

## Sessão na primeira migração

O painel atual guarda a sessão em `localStorage` na chave `zapia_cloud_auth` e envia o token nas chamadas API. Para reduzir o risco da primeira migração, a paridade inicial pode preservar o contrato de token no cliente, mas a chamada de API passa pelo BFF same-origin com validação de Origin/CSRF.

Uma evolução posterior pode migrar a sessão para cookie HttpOnly, Secure e SameSite, desde que login, refresh, logout e renovação concorrente sejam testados integralmente. Não misturar os dois modelos parcialmente.

## Tempo real

O `src/server.js` cria `/ws` apenas fora da Vercel. O consumidor legado também possui sincronização por polling e configuração de realtime, e foi observado um cliente Supabase Realtime no arquivo de Inbox.

Antes da Inbox Next, comparar:
- eventos WebSocket existentes no modo local;
- configuração `/api/cloud/realtime-config`;
- polling `/api/cloud/poll`;
- assinatura Supabase Realtime já utilizada pelo painel.

A implementação deve escolher por ambiente e preservar atualização de conversas, status, mensagens e conexões. Não assumir que o WebSocket local existe no deploy cloud.

## Deploy

- Não alterar o `vercel.json` da raiz nesta fase.
- Não mudar `outputDirectory: public`.
- Não mover nem apagar os HTML/JS/CSS existentes.
- Criar o app Next em `web/` com seu próprio `package.json`.
- Usar projeto Vercel de homologação apontando o Root Directory para `web`, se a configuração do projeto permitir.
- Manter backend e frontend com origens explícitas em variáveis server-side.
- Fazer smoke tests de login, refresh, logout, leitura e escrita antes de considerar qualquer troca de domínio.

## Critérios de aceite antes da primeira tela funcional

- [ ] Build Next.js e verificação TypeScript aprovados.
- [ ] BFF rejeita origem não autorizada e requisição mutável sem proteção CSRF.
- [ ] BFF não aceita destino de proxy arbitrário.
- [ ] Login/refresh/logout preservam o contrato do backend.
- [ ] Token nunca aparece em logs ou resposta pública do BFF.
- [ ] Erros 401/403/409/429/5xx são preservados de forma segura.
- [ ] Isolamento de tenant e modo suporte continuam sendo aplicados pelo backend.
- [ ] Painel legado continua publicável sem mudanças.
- [ ] Testes de regressão do backend permanecem aprovados.

## Limites desta decisão

Esta é a arquitetura recomendada com base nos arquivos inspecionados; ainda não foi implementada nem testada em deployment. O desenho final do BFF depende da inspeção completa do fluxo de login/refresh e da matriz de cabeçalhos/rotas do Express.
