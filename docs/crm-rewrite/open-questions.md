# Decisões e perguntas do CRM

## Decisões confirmadas pelo usuário

- Reescrever o backend de toda a aba CRM; manter o frontend existente.
- Atualizar mensagens automaticamente, sem depender do usuário clicar para atualizar.
- Usar estratégia híbrida: eventos em tempo real + sincronização/recuperação.
- Consultar a documentação pública atual da Evolution API e produzir documentação Markdown.
- O usuário quer testar a nova versão antes de decidir sobre a troca; não substituir produção sem aprovação.
- Testes que enviem mensagem podem usar exclusivamente `5586981638438`; não enviar para outros números.
- Preservar históricos e relacionamentos. Não fundir contatos apenas por semelhança de nome/telefone.
- Manter mudanças preexistentes do Kanban fora da reescrita/escopo de commits anteriores.
- Incluir na primeira versão todas as áreas e ações levantadas: Inbox, Contatos, Kanban, Coach e recursos associados.
- O frontend pode ser alterado se isso for necessário para o melhor resultado; preservar o visual e os fluxos como padrão, e justificar mudanças que o usuário perceba.
- Alvo de atualização automática: aproximadamente 5–10 segundos em condições normais.

## Regra de fonte de verdade confirmada

- **Evolution prevalece** para mensagens e estado/conexão do WhatsApp.
- **Banco CRM prevalece** para dados comerciais próprios: etapas de Kanban, tarefas, notas, tags e preferências.
- Estados com representação nos dois lados (por exemplo, lida/arquivada/bloqueada) devem ser sincronizados; falhas ficam visíveis e são reconciliadas, sem sobrescrever silenciosamente o estado local.

## Observação para fase de teste

- Confirmar se há instância Evolution/número separado para staging. Até isso ficar claro, fazer testes sintéticos isolados e não alterar configurações da instância de produção.
- O usuário confirmou que existe um ambiente de staging e autorizou gravações sintéticas somente nele. Referência do projeto Supabase e URL/nome da instância Evolution ainda não foram informados; não conectar nem gravar até receber identificadores não secretos. O projeto Supabase de produção consultado não tem branches de banco listados; não criei projeto/branch nem alterei produção.

## Observações a resolver durante o levantamento

- A documentação OpenAPI pública consultada informa `2.3.7`; versão/provider da instalação não confirmados.
- O frontend já tem Supabase Realtime por mudanças em `zapia_contacts` e polling de contingência via `/api/cloud/poll`. Investigar a cadeia de persistência/publicação atual antes de desenhar uma substituição.
- Há discrepâncias entre alguns payloads/paginação do código atual e o OpenAPI público. Resolver com testes de contrato contra a instalação correta antes de mudar comportamento.
- Extrair uma matriz exaustiva de rotas e DTOs de `public/app.js` e `src/server.js` é um passo obrigatório antes de implementação.
