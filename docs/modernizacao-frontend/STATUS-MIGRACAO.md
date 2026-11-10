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
- `/campanhas`: listar e criar rascunhos, consultar destinatários e progresso; envio/agendamento desabilitados.
- `/inteligencia-artificial`: configurações não secretas, rascunho e validação.
- `/treinamento`: importação prévia, edição de documento, rascunho e prévia.
- `/simulador`: simulação local, histórico e reset.
- `/conexoes` e `/instancias`: diagnóstico somente leitura.
- `/canais`: consulta, cadastro e edição de metadados/políticas; pareamento e QR Code não liberados.
- `/catalogo`: catálogo, recursos, rascunho e prévia PIX.
- `/audios`: preparação OGG/Opus, transcrição quando habilitada e inclusão no rascunho.
- `/historico`: conversas arquivadas.
- `/relatorios`: resumo e série temporal.
- `/contas`: consulta administrativa e auditoria; mutações administrativas não liberadas.
- `/seguranca`: políticas, PIN mascarado, fila e mensagens aprovadas em modo leitura.
- `/configuracoes`: preferências de aparência.

## Infraestrutura
- Next.js 16, React 19 e TypeScript isolados em `web/`.
- BFF same-origin em `/api/backend/*`, com validação de origem, allow-list de caminhos/métodos/cabeçalhos, limite de payload e timeout.
- Sessão no formato camelCase do painel legado (`zapia_cloud_auth`), refresh serializado e atualização do JWT do Supabase Realtime.
- Supabase Realtime como sinal de mudança na Inbox, com polling de contingência.
- Shell responsivo e tema claro/escuro.
- CI GitHub Actions para typecheck e build.
- Raiz do Turbopack fixada em `process.cwd()`, correspondente a `web/` no CI e no projeto Vercel com Root Directory `web`.

## Validação observada
- Run `42736604491`, no commit `a0fb6bac8f3d34cb97aacccb9e5a16319e3f5295`: typecheck e build aprovados.
- Run `42737003781`, após o ajuste do Turbopack: typecheck e build aprovados. O log não apresentou o aviso anterior de múltiplos lockfiles.
- O build gerou as 21 rotas previstas.
- Os dois checks Vercel reportaram falha com destino `upgradeToPro=build-rate-limit`. A publicação/homologação pela Vercel está bloqueada pelo limite de builds da conta.
- Build verde comprova compilação, não integração ponta a ponta com uma conta real.

## Pendências para conclusão real
1. Criar deployment Vercel separado com Root Directory `web`, configurar `IENVIA_BACKEND_URL` HTTPS e validar domínio/headers. O limite atual de builds precisa ser resolvido na conta Vercel.
2. Homologar BFF com backend real: login, refresh, logout, 401/403/409/429/5xx, uploads e isolamento entre contas.
3. Testar Inbox em conta de teste com Evolution, mídia, notas, perfil e Realtime/RLS.
4. Completar edição avançada de campanhas (blocos, mídia, importação, revisão e conflitos); manter envio/agendamento bloqueados até homologação.
5. Completar CRUD operacional de canais e pareamento/QR Code após homologar comandos de dispositivo.
6. Validar biblioteca de áudio e upload no ambiente hospedado, considerando limites de payload da plataforma.
7. Validar importação/ativação de Treinamento e ativação de Recursos com revisão e confirmação.
8. Implementar e testar ações administrativas de contas com autorização, confirmação e auditoria.
9. Homologar alterações de políticas de segurança e PIN.
10. Fazer auditoria visual/mobile, acessibilidade, desempenho, smoke tests e regressão de todas as ações do painel legado.
11. Revisar a PR e planejar publicação gradual e rollback.

## Critério de conclusão
A modernização só poderá ser declarada 100% após CI verde no commit final, deployment separado funcional, testes end-to-end com backend/conta reais, homologação das operações e confirmação de paridade funcional. Até lá, a PR permanece Draft e o painel legado continua sendo a interface de produção.
