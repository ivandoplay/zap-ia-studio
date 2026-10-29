# Auditoria Ienvia — perfis, permissões e isolamento no banco

Referência: 28/10/2026. Dados e credenciais das contas não estão reproduzidos neste relatório.

## Permissões excessivas

As sete tabelas `zapia_*` possuíam TRUNCATE, TRIGGER, REFERENCES e MAINTAIN para `anon` e `authenticated`. RLS não protege TRUNCATE. A existência de um caminho de exploração não foi comprovada. Os quatro privilégios foram revogados em produção; CRUD de `authenticated` e `service_role` permaneceu concedido. Migração e teste estão no repositório.

## Perfil ausente tratado como ativo

A função RLS `zapia_is_user_active` retornava verdadeiro para um ID sem perfil. O mesmo pressuposto era usado no login, renovação, validação e ativação do motor; login inclusive fabricava um perfil caso a criação retornasse erro. Nenhuma exploração foi demonstrada. Na verificação havia duas contas ativas, nenhuma bloqueada e nenhuma conta Auth órfã; signup público e usuários anônimos estavam desabilitados.

A função SQL foi corrigida em produção para retornar falso sem perfil. Reteste confirmou falso para ID aleatório e os dois perfis existentes preservaram seu status. Login, renovação, validação e ativação do motor foram corrigidos no código da versão 5.8.18; a conta deve existir e estar ativa. Erro de consulta bloqueia a operação, mas não apaga automaticamente a sessão do motor. Se ocorrer durante renovação e o Auth já houver rotacionado o token, o navegador salva o token novo sem considerar a operação autorizada. Na inicialização do motor, uma falha temporária na consulta impede a restauração; recuperação automática após reconexão ainda não foi comprovada, podendo ser necessário tentar novamente.

## Cadastro incompleto reportado como sucesso

A criação pelo Master ignorava objetos `{error}` retornados pelas três gravações do Supabase. Em teste simulado, falhas produziram sucesso indevido. Agora o cadastro só informa sucesso se as três etapas concluírem e o perfil ativo é criado por último. Auth e banco não constituem uma única transação: se a operação falhar após criar Auth, o sistema alerta para regularização manual e não apaga automaticamente a conta. Esse tratamento foi testado com serviços sintéticos; não foi criada ou apagada conta real.

## Testes

- RLS com duas identidades reais simuladas em transação revertida: leitura e UPDATE entre contas negados nas sete tabelas; UPDATE do próprio perfil funcionou; INSERT em contato de outra conta negado; criação e exclusão de contato sintético próprio funcionaram e foram revertidas. Isso não prova todos os INSERT/DELETE, RPCs ou interfaces.
- Autenticação, renovação, falha de perfil, bloqueio, contas trocadas, provisionamento, ativação do motor e comportamento de navegador testados em ambiente sintético sem sockets reais.
- Suite completa: 35 arquivos de testes aprovados em cópia isolada; a primeira execução revelou que o laboratório tinha sido montado sem todos os arquivos do pacote; uma repetição revelou resíduo sintético de diário. O primeiro foi corrigido no laboratório e o segundo no próprio teste; nova execução foi integralmente aprovada.
- ZIP assinado v5.8.18 validado em checkout limpo. Atualizadores v5.8.16 e v5.8.17 instalaram-no com banco e sessão sintéticos preservados. Vercel deploy `dpl_EUXxB292YYcSEH2Bok9nSE7JMvfp` READY/PROMOTED; versão pública, ZIP HTTP 200, assinatura Ed25519 e bytes idênticos ao artefato validado. A instalação real da v5.8.18 foi confirmada posteriormente por heartbeat, conforme registro abaixo.

Não houve novo logout, reinício, pareamento ou envio real nesta etapa. O motor real continuava em 5.8.17 na última consulta (heartbeat 10:52:54 UTC), com ambos os chips registrados como ativos; consulta anterior confirmou os dois conectados. As definições das duas RPCs Security Definer usam auth.uid(), verificam conta ativa e restringem a alteração ao próprio usuário; execução anon estava revogada. Isso é revisão estática, não validação exaustiva. Auditoria adicional de funções/RPC, políticas de escrita não cobertas, histórico, CSP, backups e interfaces permanece necessária.

## Atualização remota solicitada posteriormente

Foi enviado uma única vez o comando `22640036-998a-4cbe-9cd4-fc6ab2473aaa` para o Windows `DESKTOP-9LRLOPT`, após confirmação do ZIP de produção v5.8.18 e da sua assinatura. O comando terminou em `done` às 10:58:37 UTC; após reinício, o próprio Windows registrou heartbeat v5.8.18 às 10:59:14 UTC e os slots 1 e 2 foram consultados como `connected` às 10:59:26 UTC. Nenhum comando adicional foi enviado.
