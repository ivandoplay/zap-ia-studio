# Status da modernização gradual do Ienvia

Atualizado: 2026-11-10

## Regras mantidas
- `zap-ia-studio` continua sendo a fonte da verdade.
- `ienvia` é referência visual e de experiência; o modelo de dados, a autenticação e as regras do backend principal são preservados.
- O painel legado permanece intacto em `public/`.
- Toda a modernização está isolada na branch `feat/modernizacao-frontend-next` e na PR Draft #4.
- Nenhuma alteração foi mesclada em `main` e nenhum deploy de produção foi executado.

## Rotas já criadas

| Rota | Estado da interface | Contrato principal |
|---|---|---|
| `/login` | Login conectado ao backend | `POST /api/auth/login` |
| `/visao-geral` | Indicadores reais | `GET /api/dashboard/parity` |
| `/inbox` | Lista, histórico, envio de texto/mídia, notas, lida/não lida, fixar, arquivar, pausar/retomar IA e ficha | `/api/conversations-v3` |
| `/contatos` | Lista, filtros, ficha, etiquetas, tarefas e follow-up | `/api/crm-v2/contacts` |
| `/campanhas` | Criar/listar rascunhos, consultar destinatários e progresso | `/api/campaigns-v2/drafts` |
| `/inteligencia-artificial` | Configuração não secreta, rascunho e validação | `/api/ai-settings-v2` |
| `/treinamento` | Documento, rascunho e prévia | `/api/training-v2` |
| `/simulador` | Simulação local, histórico e reset | `/api/simulator-v2` |
| `/conexoes` | Diagnóstico somente leitura | `/api/connections/summary` |
| `/instancias` | Diagnóstico de chips e dispositivos, somente leitura | `/api/connections/summary` |
| `/canais` | Lista de canais, vínculo e capacidades | `/api/channels` |
| `/catalogo` | Documento de recursos, rascunho e prévia PIX | `/api/resources-v2` |
| `/audios` | Biblioteca de áudio, somente leitura | `/api/resources-v2` |
| `/historico` | Conversas arquivadas | `/api/conversations-v3` |
| `/relatorios` | Resumo e série de sete dias | `/api/dashboard/summary` |
| `/contas` | Consulta administrativa e auditoria, conforme permissões | `/api/accounts-v2` |
| `/seguranca` | Políticas, PIN mascarado, fila e mensagens aprovadas, somente leitura | `/api/security-settings-v2` |
| `/configuracoes` | Preferência de aparência clara/escura | `/api/dashboard/appearance` |

## Infraestrutura incluída
- Next.js 16, React 19 e TypeScript em `web/`.
- BFF same-origin em `/api/backend/*`, com origem validada, backend HTTPS configurado somente no servidor, caminhos segmentados, métodos permitidos, cabeçalhos selecionados e timeout.
- Sessão no formato camelCase do painel legado (`zapia_cloud_auth`), com refresh serializado e atualização do JWT do Supabase Realtime.
- Realtime Supabase como sinal de mudança em contatos, com polling de contingência.
- Tema claro/escuro e shell responsivo.
- CI GitHub Actions executando TypeScript e build.

## Validação observada
- GitHub Actions: TypeScript e build Next.js aprovados no commit `d8eaf9f3ab7efa6ed920ad34c31cc188c16bfce8`.
- Isso valida compilação; não equivale a teste end-to-end contra uma conta real nem homologação do deploy.
- O workflow continua executando em cada atualização da branch.

## Pendências para declarar 100%
1. Homologar o BFF com o backend real: login, refresh, logout, 401/403/409/429/5xx, uploads e isolamento entre contas.
2. Criar deployment Vercel separado com Root Directory `web`, configurar `IENVIA_BACKEND_URL` HTTPS e validar domínio/headers.
3. Testar o fluxo de Inbox em uma conta de teste, incluindo Evolution, mídia, notas, perfil e Realtime/RLS.
4. Completar edição avançada de campanhas (blocos, mídia, importação de destinatários, revisão e conflitos). O envio/agendamento permanece desligado.
5. Completar CRUD de canais e pareamento/QR Code, somente depois de homologar os comandos de dispositivo.
6. Completar biblioteca de áudio: upload, prévia, transcrição e recursos, respeitando as capacidades do backend.
7. Completar importação/ativação de Treinamento e ativação de Recursos, com revisão e confirmação.
8. Completar ações administrativas de contas com confirmação, autorização e auditoria; não liberar operações destrutivas sem testes.
9. Completar alterações e ativação de políticas de segurança, inclusive PIN, com homologação própria.
10. Auditoria visual/mobile, acessibilidade, testes de regressão, desempenho e smoke tests.
11. Comparar todas as ações do painel legado com a nova interface e registrar paridade funcional.
12. Revisão final da PR e publicação gradual, com plano de rollback.

## Critério de conclusão
A modernização só pode ser marcada como 100% depois de todas as pendências acima concluídas, CI verde no commit final, testes end-to-end e homologação no deployment separado. Até lá, a PR permanece Draft e o painel antigo continua sendo o ambiente de produção.
