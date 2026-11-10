# Status da modernização gradual do Ienvia

Atualizado: 2026-11-10

## Regras mantidas
- `zap-ia-studio` continua sendo a fonte da verdade.
- `ienvia` é referência visual e de experiência; modelo de dados, autenticação e regras do backend principal são preservados.
- O painel legado permanece intacto em `public/`.
- A modernização está isolada em `feat/modernizacao-frontend-next` e na PR Draft #4.
- Nenhuma alteração foi mesclada em `main` e nenhum deploy de produção foi executado.

## Rotas implementadas
- `/login`: autenticação no backend principal.
- `/visao-geral`: indicadores do dashboard.
- `/inbox`: lista, histórico, envio de texto e mídia, notas internas, leitura, fixação, arquivamento, IA e ficha.
- `/contatos`: busca, filtros, ficha, etiquetas, tarefas e follow-up.
- `/campanhas`: listar/criar rascunhos, editar plano e opções com revisão, prévia CSV/TXT/XLSX, biblioteca privada de pastas e mídia por URL assinada, inserir blocos de imagem/áudio e consultar destinatários/progresso. Envio/agendamento continuam bloqueados.
- `/inteligencia-artificial`: configurações não secretas, rascunho e validação.
- `/treinamento`: importação prévia, edição de documento, rascunho e prévia.
- `/simulador`: simulação local, histórico e reset.
- `/conexoes` e `/instancias`: diagnóstico somente leitura.
- `/canais`: consulta, cadastro e edição de metadados/políticas; pareamento com confirmação explícita somente quando `capabilities.canPair` for liberado pelo backend.
- `/catalogo`: catálogo, recursos, rascunho e prévia PIX.
- `/audios`: preparação OGG/Opus, transcrição quando habilitada e inclusão no rascunho.
- `/historico`: conversas arquivadas.
- `/relatorios`: resumo e série temporal.
- `/contas`: consulta administrativa e auditoria; mutações administrativas não liberadas.
- `/seguranca`: edição e validação de rascunho, PIN condicionado a permissão e ativação condicionada à capacidade do backend; fila permanece somente leitura.
- `/configuracoes`: preferências de aparência.

## Infraestrutura
- Next.js 16, React 19 e TypeScript isolados em `web/`.
- BFF same-origin em `/api/backend/*`, com validação de origem, allow-list de caminhos/métodos/cabeçalhos, timeout e limite explícito de 4.500.000 bytes para request/response.
- Sessão no formato camelCase do painel legado (`zapia_cloud_auth`), refresh serializado e atualização do JWT do Supabase Realtime.
- Supabase Realtime como sinal de mudança na Inbox, com polling de contingência.
- Upload de mídia de campanhas usa URL assinada diretamente do armazenamento privado, sem trafegar o arquivo grande pelo BFF.
- Shell responsivo e tema claro/escuro.
- CI GitHub Actions para typecheck e build.
- Raiz do Turbopack fixada em `process.cwd()`, correspondente a `web/` no CI e no projeto Vercel com Root Directory `web`.

## Validação observada
- Run `42736604491`: typecheck e build aprovados.
- Run `42737003781`: typecheck e build aprovados após fixar a raiz Turbopack; o aviso de múltiplos lockfiles deixou de aparecer.
- Run `42737399777`: typecheck e build aprovados após edição de rascunhos e prévia de importação de destinatários.
- Run `42737684763`: typecheck e build aprovados após melhorias em Segurança e Canais.
- Run `42738113212`: typecheck e build aprovados após biblioteca privada de mídia e limite de payload no BFF. O build gerou as 21 rotas e não apresentou o aviso anterior de múltiplos lockfiles.
- Os checks Vercel reportaram falha com destino `upgradeToPro=build-rate-limit`. A publicação/homologação pela Vercel está bloqueada pelo limite de builds da conta.
- CI verde comprova compilação, não integração ponta a ponta com uma conta real ou validação de CORS do armazenamento.

## Pendências para conclusão real
1. Resolver o limite de builds na conta Vercel e criar deployment separado com Root Directory `web`, variável server-side `IENVIA_BACKEND_URL` HTTPS e domínio/headers validados.
2. Homologar BFF com backend real: login, refresh, logout, 401/403/409/429/5xx e isolamento entre contas.
3. Testar Inbox em conta de teste com Evolution, mídia, notas, perfil e Realtime/RLS. Migrar uploads/downloads grandes da Inbox para URLs assinadas; o limite de payload das Functions é 4,5 MB.
4. Testar biblioteca privada de campanhas em armazenamento real: CORS de PUT assinado, validação de bytes, finalização, leitura e isolamento de tenant.
5. Completar revisão de conflitos, pastas/blocos e testes de campanhas; manter envio/agendamento bloqueados até homologação.
6. Completar executor de canais, pareamento/QR Code e atualização de QR quando o backend liberar essas operações; testar em dispositivo real.
7. Validar biblioteca de áudio e uploads no ambiente hospedado; migrar payloads maiores para upload direto.
8. Validar importação/ativação de Treinamento e ativação de Recursos com revisão e confirmação.
9. Implementar e testar ações administrativas de contas com autorização, confirmação e auditoria.
10. Homologar alterações de políticas de segurança/PIN e operações da fila de abordagem.
11. Fazer auditoria visual/mobile, acessibilidade, desempenho, smoke tests e regressão de todas as ações do painel legado.
12. Revisar a PR e planejar publicação gradual e rollback.

## Critério de conclusão
A modernização só poderá ser declarada 100% após CI verde no commit final, deployment separado funcional, testes end-to-end com backend/conta reais, homologação de armazenamento e operações, e confirmação de paridade funcional. Até lá, a PR permanece Draft e o painel legado continua sendo a interface de produção.
