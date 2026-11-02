# Diagnóstico seguro da integração Evolution

**Atualizado em:** 2026-11-02. A rota temporária foi implementada e testada no worktree isolado, mas ainda não foi publicada nem chamada contra a Evolution real. Até aqui não houve leitura autenticada de contatos/conversas, escrita em produção ou exposição de segredos.

## Rotas e funções já existentes

| Componente | O que faz | Segurança/efeito |
|---|---|---|
| `GET /api/evolution-cloud/status` | Consulta instâncias e estado de conexão usando a chave server-side. | Exige autenticação do aplicativo e valida a conta configurada; não retorna histórico. |
| `GET /api/crm/contact-directory` | Usa `getEvolutionApiContacts()` e combina os resultados com a agenda local. | A resposta contém nomes, telefones e URLs de fotos; não compartilhar resposta bruta. |
| `POST /api/wa/sync-history` | Usa `getEvolutionApiChats()` e `findMessages` para importar conversas e histórico. | **Não usar para diagnóstico:** grava contatos/mensagens no CRM. |

A chave Evolution não precisa ser enviada ao navegador; as chamadas são server-side. O preview público redireciona para SSO da Vercel e as rotas existentes também exigem sessão do app. A configuração consultada está no ambiente Production.

## Rota temporária implementada (ainda não publicada)

- Caminho: `GET /api/evolution-cloud/diagnostics/read-only`.
- URL-alvo após publicação: `https://zap-ia-studio.vercel.app/api/evolution-cloud/diagnostics/read-only`. **Não abrir ainda:** a versão em produção não inclui esta rota e pode responder 404.
- Exige sessão válida do app, limita-se ao proprietário Evolution configurado, rejeita impersonação e aplica rate limit best-effort por instância de função.
- Faz somente consultas Evolution: lista de instâncias, estado de conexão, `findContacts`, `findChats` e uma amostra de até 10 mensagens por instância conectada. Não chama envio, marcação de leitura, alteração de instância/webhook, sincronização do CRM ou rotas de persistência.
- Limite por instância: até 8 páginas de 1.000 contatos e 8 páginas de 200 conversas; timeout de 4 s por chamada Evolution. A resposta sinaliza quando a paginação atingiu o teto, sem alegar total completo.
- A resposta inclui apenas contagens, status de conexão, paginação, presença agregada de nome/foto, métricas técnicas da amostra e quantidade de JIDs repetidos entre slots. Nunca serializa nome, telefone, JID completo, URL de foto, conteúdo/mídia de mensagens, token ou payload bruto. Os dados retornados pela Evolution permanecem em memória apenas para agregação e não são logados.
- A rota tem `Cache-Control: no-store`, não carrega o workspace CRM e não aciona `flushCloud`; não realiza escrita no CRM.

## Testes concluídos no worktree isolado

- Novos testes unitários de agregação/paginação/redação e testes do helper/rota com `fetch` sintético: passaram.
- Regressão Evolution/CRM direcionada: 32 testes passaram; depois de ampliar os testes da rota, a suíte total passou 237/239.
- As duas falhas restantes são preexistentes e fora deste escopo: o ZIP assinado `release/motor-update.zip` anuncia versão 5.8.27 enquanto `package.json` anuncia 5.8.28 (isso também faz o endpoint do ZIP falhar no teste de branding). Nenhuma dessas falhas toca a rota Evolution.
- Nenhuma chamada real à Evolution foi feita; não há totais reais a reportar.

## Bloqueio para publicar

A rota está apenas no branch/worktree local `/home/user/crm-backend-rewrite`. O projeto Vercel publica a partir do repositório Git; o workspace tem acesso de leitura ao remoto e ao projeto Vercel, mas não tem uma credencial Git de escrita aprovada nem um método de implantação direta que aceite o worktree local. O token de Evolution não é credencial Git e não foi reutilizado para isso. Portanto, não foi criado deployment/commit de produção.

Quando a alteração estiver publicada, o usuário deve abrir a URL-alvo acima já autenticado no app e compartilhar apenas o JSON técnico agregado. A rota poderá então verificar conexão/autenticação, disponibilidade dos endpoints, totais e limites de paginação. Depois da análise e das correções acordadas, a rota temporária deve ser removida e a regressão/deploy final verificados.
