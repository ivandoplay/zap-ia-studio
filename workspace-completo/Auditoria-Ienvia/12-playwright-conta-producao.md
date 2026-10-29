# Ienvia — acesso à conta real com Playwright

Em 28/10/2026, foi acessado o painel da conta autorizada de Jefferson pelo domínio de produção da Vercel com uma sessão pré-existente do laboratório. A renovação da sessão foi feita pelo endpoint de autenticação; não houve login digitando senha. O navegador foi temporário e foi encerrado depois dos testes. O arquivo antigo de sessão do laboratório não foi atualizado com o token renovado e não deve ser reutilizado como se ainda fosse válido. O Windows usa identidade de dispositivo distinta e seu heartbeat continuou ativo após a operação.

## O que foi verificado

- O domínio de produção respondeu HTTP 200 e autenticou a conta esperada.
- O bootstrap retornou a versão 5.8.21, indicou motor online e carregou 7.452 fichas no momento da consulta; isso não prova que o histórico esteja completo.
- A navegação abriu Início, CRM, Treinamento, Áudios, Catálogo, Simulador, IA e Segurança; nenhuma exceção JavaScript não tratada foi observada durante esses cliques.
- A automação permitiu requisições de leitura ao mesmo domínio e uma renovação de autenticação, bloqueando solicitações de alteração. Não selecionou contatos, enviou mensagens, mudou configurações, apagou dados ou exibiu conteúdo de conversas em logs.
- O motor Windows seguiu online na versão 5.8.21, com os slots 1 e 2 ativos, na verificação realizada logo depois.

## Limites

Isso demonstra acesso e navegação básica de leitura na conta real, não valida todas as operações autenticadas. Envio de WhatsApp, reprodução de mídias reais, alterações, restauração de backup e sincronização de histórico não foram repetidos nesta rodada. Os testes isolados de interface continuam documentados em `11-testes-playwright.md`. O bucket de mídias públicas continua pendente, conforme `08-alerta-midias-publicas.md`.

O teste manual genérico `tests/playwright-conta-leitura.manual.mjs` foi versionado no GitHub. Em teste com servidor e sessão sintéticos, bloqueou uma tentativa de POST não autorizada e não imprimiu as credenciais. Deve receber uma sessão dedicada explicitamente autorizada; a renovação pode invalidar a sessão usada, por isso não se deve usar a sessão de um motor em operação. O script genérico foi validado com dados sintéticos; a navegação real foi realizada por outro script equivalente de laboratório.
