# Performance — o que foi executado e o que depende de infraestrutura

Data da auditoria: 5 nov. 2026. As medições foram feitas no navegador com viewport de 390 × 844, rede emulada de 1,6 Mbps/150 ms RTT e APIs substituídas por fixtures sintéticas. Nenhuma conta ou conversa real foi usada.

## Aplicado no repositório

- **Brotli/GZIP:** middleware próprio sem nova dependência; Brotli q5, fallback gzip. Compressão de HTML, CSS, JavaScript, SVG e JSON acima de 1 KiB. Arquivos de imagem/áudio/woff já comprimidos não são recomprimidos. O cache de conteúdo comprimido em memória tem limite de 32 MiB por processo.
- **Assets e ETag:** cache de 5 min + `stale-while-revalidate` para assets de nome fixo; 1 ano e `immutable` apenas para nomes com hash/versão. HTML revalida sempre. `vercel.json` recebe políticas compatíveis. `/api/bootstrap` responde com ETag e 304 quando o navegador tem a mesma representação.
- **Requisições repetidas:** `api()` compartilha somente GETs simultâneos; POST/PATCH não são deduplicados. Chave considera URL, método, token e usuário em suporte. O navegador aborta GETs sem resposta após 30 s; mutações não são abortadas automaticamente, para não induzir reenvio duplicado.
- **Busca e render:** debounce nas buscas que repintam listas; os handlers `oninput` existentes e seus IDs foram mantidos. A Inbox inicia com 50 conversas e acrescenta páginas de 50 ao rolar; isso é renderização progressiva, não uma janela virtual de altura fixa.
- **Primeiro carregamento:** `perf.js` precede o app; scripts do painel usam `defer`; skeletons HTML/CSS estão em Catálogo, Áudios, Contas e KPIs do master. Imagens de catálogo/CRM são lazy-loaded quando não são conteúdo crítico.
- **Consultas Supabase:** os `.select('*')` de `src/supabaseCloud.js` foram removidos e substituídos por projeções explícitas. As cinco consultas do tenant continuam paralelas; a auditoria não encontrou `.from()` dentro de loop (N+1).
- **IA:** o Simulador pode receber tokens em NDJSON quando faz envio de texto puro. O mesmo `generateSmartReply` continua aplicando proteção anti-injection, treinamento, fallback e validação das ações. O streaming não é ativado para mídia; resposta de WhatsApp continua aguardando a geração completa antes do envio.
- **Imagens:** removidas duas cópias PNG sem referência (icon/logo sem `-v2`, 132.656 bytes no total). O hero já usa WebP. As imagens com nomes `-v2.png` foram mantidas porque fazem parte do pacote de atualização assinado; a conversão exige reconstruir e assinar esse pacote.
- **Telemetria:** rota lenta gera log estruturado com trace/span IDs, método, rota e duração; `SLOW_REQUEST_MS` altera o limiar (padrão 800 ms). O navegador coleta LCP, CLS, INP aproximado e TTFB e envia sem identidade pelo `sendBeacon`; os registros vão para o log `[perf-rum]`. `/api/perf/rotas` exige papel master. Estado em memória é **por processo/instância** e não agrega as instâncias serverless.
- **Timeout externo:** foi adicionado timeout de 20 s à transcrição por API. O restante do código já tem timeouts em vários provedores; continuam existindo integrações específicas que precisam de limite próprio.
- **Dependências:** nenhuma removida: a auditoria de imports marcou 12/12 dependências runtime como usadas.
- **Paginação:** contatos são lidos em páginas de 500; campanhas usam `.range()`. Há um helper keyset (`src/shared/keyset-pagination.js`) para consultas com coluna de ordenação única; ele não substitui a paginação offset que já é validada nos endpoints existentes.

## Ainda requer mudança de produto/código

1. **Code splitting real por página:** `app.js` continua um arquivo global grande (aprox. 450 KB sem compressão). O `defer` tira o bloqueio do parser, mas não reduz JavaScript executado. Extrair cada tela para módulos requer preservar o contrato global (`onclick`, eventos e IDs); recomendação: migrar tela a tela e validar cada rota.
2. **Virtualização real:** a Inbox agora renderiza progressivamente em lotes de 50; listas com dezenas de milhares ainda precisam de janela virtual com espaçadores/altura medida. A agenda de contatos já pagina no servidor.
3. **WebP/AVIF dos logos rasterizados:** postergar até reconstruir, testar e assinar `release/motor-update.zip` e seu `update-manifest`.
4. **Atualização otimista:** aplicar somente a alterações reversíveis (marcar lido, pin, tag). Envio de WhatsApp não deve ser mostrado como entregue antes da confirmação do motor/API.
5. **Streaming no atendimento real:** token streaming muda a semântica de entrega no WhatsApp (o cliente recebe uma mensagem final), portanto só está no Simulador. Para conversa ao vivo no painel, seria preciso canal de preview/rascunho separado e política de cancelamento.

## Infraestrutura externa — não foi ativada

- **CDN:** os estáticos do projeto Vercel já podem ser servidos pela edge da Vercel; o repositório agora define headers de cache, mas não altera domínio, plano, região ou configuração de CDN. Não aplique cache público em `/api`, uploads privados ou dados por tenant.
- **Redis/cache distribuído:** não há `REDIS_URL` nem cliente Redis. Se adicionado, usar chave com tenant (`tenant:{uuid}:...`), TTL curto e invalidação após escrita; não guardar tokens, conteúdo privado ou resposta de CRM sem política de isolamento.
- **Fila de jobs:** não há broker de filas configurado. Campanhas e tarefas com efeitos externos precisam de idempotency key, estado persistido e confirmação do worker antes de adotar BullMQ/Redis, SQS ou equivalente.
- **Índices SQL:** `supabase/migrations/20261105010000_performance_indices_leitura.sql` contém índices aditivos para leitura incremental de contatos e listagem de workers por heartbeat. **A migração não foi aplicada no Supabase remoto.** Antes de produção, revisar existência/esquema no projeto correto e aplicar em janela segura; em tabelas grandes, criar `CONCURRENTLY` fora de uma transação e verificar `EXPLAIN (ANALYZE, BUFFERS)`.
- **OpenTelemetry real:** a instrumentação atual emite logs correlacionáveis; não instalamos SDK/exporter nem coletor OTLP. Para produção, escolher sink/retention, exportar `traceparent` até Supabase/provedor IA/worker, filtrar PII e definir amostragem.
- **RUM durável:** no Vercel cada função é efêmera; `[perf-rum]` pode ser ingerido por observabilidade da Vercel ou um sink externo. `/api/rum/resumo` só resume a memória daquela instância e não é painel agregado.
- **Pooler PostgreSQL:** o backend usa Supabase JS/PostgREST. Um pooler de conexão PostgreSQL só ajuda conexões diretas (`pg`); não deve ser adicionado ao fluxo atual sem uma necessidade de conexão SQL direta.
- **Região e múltiplas instâncias:** alinhar região da função Vercel e projeto Supabase reduz RTT; réplicas não corrigem distância. Multi-instância segura exige remover dependência de memória local e coordenar workers/locks por serviço compartilhado.

## Repetir a medição

`npm run perf:lab` serve os arquivos reais e uma fixture local para auth/bootstrap, desabilita cache, usa Chromium em 390 × 844 e emula 1,6 Mbps/150 ms; imprime três execuções. É um laboratório comparável, não medição de usuários reais.

Testes direcionados aprovados nesta etapa: `performance-delivery.test.mjs` (compressão, cache, 304, stream NDJSON e cursor), `landing-browser`, `painel-paginas-browser`, `workspace-style-browser` e `realtime-painel-browser`. A suíte inteira `npm test` excedeu o timeout de 240 s e também registrou falhas existentes no baseline: teste de Contas espera `accounts-app.js` que não existe, e dois imports de `src/shared/contracts/*` esperados por testes não existem. O teste de fluxos do painel tem uma falha preexistente de visibilidade da subvisão Contacts, reproduzida também em `HEAD` limpo.
