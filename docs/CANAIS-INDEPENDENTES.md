# Canais independentes — decisão e implantação incremental

## Decisão do titular

- Remover o teto fixo de três canais do novo modelo.
- **Guardar, mas ocultar:** desmarcar CRM muda somente a visualização padrão; não interrompe a ingestão nem apaga contatos/mensagens.
- CRM, IA e disponibilidade para campanhas são escolhas independentes.
- O titular delegou a ordem das demais melhorias ao desenvolvimento.

## Desenho escolhido

Um canal tem UUID estável por conta, nome, transporte e etiquetas. Nada deriva de `slice(-1)` ou de um array de três posições. Canal novo: CRM visível, IA desativada e campanhas desabilitadas. A configuração não comprova conexão, execução de IA ou disponibilidade de executor. Cadastrar não conecta e habilitar campanhas não inicia envios.

Listagem paginada por cursor, busca e filtros. Sem número máximo de registros no produto; limites de payload/página são proteção operacional, não cota de canais. Capacidade do provedor, RAM/CPU, restrições do WhatsApp e limites de conexão reais continuam existindo.

## Fases e condição de segurança

1. **Base e revisão desta rodada:** modelo/contratos dinâmicos, rascunho SQL aditivo com RLS/CAS, API de cadastro/configuração, interface de organização e simulação do filtro CRM preservando históricos. Testes locais, sem banco remoto.
2. **Migração operacional necessária:** mapear os slots legados para UUID sem renomear silenciosamente sessões, adaptar dispatcher/motores/identidade de instância/webhooks/contatos/campanhas e retirar as constraints legadas de três. Importar canais existentes preservando permissões e sessões. Atualizar os motores por pacote legítimo assinado.
3. **Aplicação/aceite real:** só com autorização específica de banco/publicação/teste. Não usar a conta WhatsApp restrita para experimentar.

**Não declarar conexão real ilimitada na fase 1.** O registro novo não reaproveita o normalizador legado que troca canal inválido por Chip 1. Enquanto a fase 2 não estiver validada, operações de conexão do registro novo ficam bloqueadas e identificadas como pendentes. O diagnóstico e os controles anteriores continuam separados e não são apresentados como motores já migrados.

O SQL ficará apenas em arquivo, sem aplicação. A API retorna erro de preparação pendente se a tabela/RPC nova não existir; ausência de migração nunca é apresentada como lista vazia. No painel local, não haverá fallback silencioso para arquivo ou para outra conta.

## Publicação permitida

Somente a branch `review/reforma-visual` e o projeto estático `ienvia-reforma-visual`, com dados fictícios identificados e zero rede/API/WhatsApp. Não modificar main, projeto principal, campanhas ou banco remoto.

## Implementação local da fase 1

- `/canais/` e `public/v2/assets/channels-{app,view,demo}.js`, `channels.css`, `channel-policy.js`.
- Contrato puro compartilhado com backend: UUID, nomes, etiquetas, booleanos estritos, defaults seguros e projeção de contatos visíveis/ocultos/todos.
- `src/channels/router.js`: lista, cria e atualiza **cadastro**, usando contexto autenticado leve e sem ler contatos/workspace/provedor. Suporte apenas lê; gravações sempre usam o cliente do operador titular, nunca um cliente admin para alterar o alvo.
- API `GET/POST /api/channels` e `PATCH /api/channels/:id`; listagem por cursor de UUID, busca literal por nome/etiquetas, filtro CRM e contagens globais independentes da página. Páginas de até 50 não são limite de quantidade de canais.
- Rascunho aditivo `20261103233000_canais_independentes.sql`: RLS de leitura própria, escrita por RPC com dono derivado de `auth.uid()`, validação SQL, transporte imutável e atualização com revisão otimista. Sem delete de canal, contato, mensagem ou sessão. Não há backfill automático ou alteração de tabelas legadas.
- Interface com busca, etiquetas, paginação, seleção independente de funções e confirmação de cadastro **sem conectar**. Sem exclusão ou comando de WhatsApp nesta base.
- No exemplo público: 32 canais fictícios e um simulador de filtros do CRM. Ocultar mantém as seis conversas e doze mensagens de exemplo; opções duram somente até recarregar a página.
- O endpoint novo retorna `canPair:false` e `operationalMigrationPending:true`. A UI expõe a migração pendente de forma permanente. Não indica que os motores antigos já aceitaram o cadastro novo.
- Sem replay automático de POST/PATCH em 401/5xx/falha de rede; revisão conflitante retorna 409. Erro de migração ausente retorna `CHANNELS_SETUP_REQUIRED`, não dados zerados.

## Evidências locais

- 66/66 testes selecionados finais de canais, dashboard, Conexões e revisão estática (`channels-final-tests.log`).
- SQL PGlite isolado: 57 canais para o mesmo usuário, páginas de 11 sem duplicar/perder registros, filtros/contagens, defaults seguros, CAS, isolamento de usuário, suporte master somente leitura, usuário inativo e escrita direta bloqueados. Não é execução no Supabase remoto.
- Browser: adicionar acima de três, filtrar por etiqueta, carregar mais, alterar apenas CRM sem alterar IA/campanhas, histórico preservado, suporte bloqueado, falha sem zero falso, responsividade e contraste básico nos dois temas. Rede/Fetch/XHR/WebSocket bloqueados no teste da demonstração.
- Regressão identificou um estouro de largura no cabeçalho antigo de Conexões a 320px após adicionar o link da nova base; corrigido com quebra de linha antes do aceite final.

## O que permanece pendente, sem disfarçar como concluído

O filtro do CRM desta rodada é uma projeção pura validada e uma demonstração interativa. **Ainda não está aplicado a todos os endpoints/realtime do CRM legado.** As opções de IA/campanhas do cadastro novo ainda não são consumidas pelos motores. Seus números reais continuam no modelo anterior até a fase 2, a aplicação autorizada do banco e a publicação operacional. O cadastro dinâmico não deve ser vendido como conexão ilimitada já funcionando.

A futura migração precisa preservar identidade de conta/canal/mensagem, dedupe, ACK, executor explícito, intervalos e bloqueios de campanhas. Não converter IDs novos em `slot_1`, não renomear pastas de autenticação e não desconectar/reparear para fazer o mapeamento. O problema do release assinado continua pendente: não falsificar versão ou assinatura para atualizar motores.

Regressão completa desta rodada: **347/349** (`channels-full-suite.log`), apenas as falhas históricas de `ienvia-branding.test.mjs` e `static-release-package.test.mjs`. Depois, um ajuste visual de quebra de etiquetas/nomes longos recebeu regressão adicional de browser/revisão estática (5/5), incluindo 320px. Nenhum pacote/assinatura foi alterado.

## Rodada seguinte — etapa 2A local

Ponte de identidade implementada e validada em `docs/PONTE-CANAIS-LEGADOS.md`: importação administrativa idempotente de slots antigos para UUID, FK composta/RLS/rollback, plano offline sem aplicação, consulta autenticada de vínculo e bloqueios de referências UUID em rotas/motores ainda legados. O normalizador não converte mais um identificador explícito desconhecido em Chip 1; modo desconhecido também não vira rodízio. A etapa 2 inteira **ainda não terminou**: catálogo dinâmico/dispatcher, persistência, CRM/realtime e consumidores de políticas continuam pendentes. Sem aplicação remota, sessão real ou publicação do backend.

Validação final desta rodada: **82/82 selecionados** e **363/365 na suíte completa**; apenas as duas falhas históricas de pacote/release assinado. Houve ajuste do teste local em VM para injetar a nova dependência de validação real; o teste não foi afrouxado e ganhou um caso de bloqueio com PIN/login válidos. O manifesto estático foi regenerado e permanece com os mesmos 30 assets; não houve alteração visual nesta etapa.

## Correção posterior do domínio: instâncias e PWA

O titular esclareceu que quer **instâncias nomeadas**, não um número preso a um único motor. O mesmo número pode ser planejado em uma instância Evolution para CRM e outra local para campanhas, respeitadas as capacidades reais do provedor. Nome é livre. Ele delegou a decisão de histórico e pediu uso completo do PWA. Veja `docs/INSTANCIAS-E-PWA.md`: decisão de conversa canônica por número verificado/cliente, origem preservada e coordenação única de IA; esses mecanismos ainda não estão integrados aos motores reais. Offline: bloquear e avisar. O PWA não equivale a um motor local permanente nem garante menor risco de spam.

A interface agora usa `/instancias/`; `/canais/` continua funcionando. Os contratos internos anteriores são preservados. Esta rodada implementa a base PWA local e controles de demonstração, não Web Push de conversas ou compartilhamento em produção.
