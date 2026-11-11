# Auditoria de migração para Cloudflare

Data da auditoria: 2026-11-11
Base analisada: `feat/modernizacao-painel-oficial`

## Resumo executivo

A conta Cloudflare tem um Worker de homologação publicado em `ienvia-cloudflare-staging.ivanjeffersong8.workers.dev`. O Worker funciona como gateway de borda para a origem Vercel. Isso valida a criação/publicação do recurso, mas **não representa a migração do backend**.

## Dependências observadas no backend

| Área | Evidência no código | Impacto na migração |
|---|---|---|
| HTTP | Express 4 em `src/server.js` | Requer validação/adaptação do adaptador HTTP para Workers ou extração gradual de rotas |
| Arquivos | `fs`, `path`, diretórios de dados e uploads em `src/storage.js` | Persistência local não pode ser considerada durável no runtime Workers; mover arquivos para R2/Supabase Storage e estado para Supabase |
| Uploads | Multer com diskStorage e memoryStorage | Substituir diskStorage por streaming/objetos em storage externo; revisar limites e validação de MIME |
| WebSockets | `ws` e servidor HTTP em `src/server.js` | Não assumir compatibilidade direta; definir Durable Objects/WebSocket Hibernation ou serviço separado |
| WhatsApp local | Baileys em `src/whatsappManager.js` | Não portar como Worker sem validar runtime, conexões persistentes e armazenamento de credenciais |
| WhatsApp cloud | Evolution API em `src/evolutionApiCloud.js` | Pode continuar como integração HTTP externa; webhooks precisam de endpoint público e validação de segredo |
| Banco/Auth | Supabase JS em `src/supabaseCloud.js` | Pode permanecer externo; revisar uso de service role, RLS e armazenamento |
| IA | OpenRouter/Gemini em `src/aiEngine.js` | Manter chamadas server-side e configurar secrets sem expor chaves |
| Processamento de áudio | ffmpeg-static e utilitários em `src/audioProcessor.js` | Requer serviço/container separado ou pipeline compatível; não presumir binário nativo disponível no Worker |
| ZIP/XLSX | processamento de arquivos e bibliotecas Node | Testar limites de memória/CPU e compatibilidade por rota |

## Recursos Cloudflare

- Workers: criado e publicado.
- workers.dev: habilitado.
- Observabilidade e invocation logs: habilitados.
- KV: não criado porque não há caso de uso de estado efêmero confirmado.
- D1: não criado porque o Supabase continua como banco principal.
- R2: conta ainda não habilitada; o endpoint da API respondeu que é necessário habilitar R2 no Dashboard.
- Zona/domínio: a conta não retornou zonas; domínio próprio não pode ser vinculado até que um domínio seja adicionado à Cloudflare.

## Bloqueio de acesso à origem

O projeto Vercel tem Deployment Protection/SSO configurado. O gateway não deve contornar nem desativar essa proteção. É necessário configurar um mecanismo de acesso de origem suportado para o ambiente de homologação e validar uma rota autenticada sem expor credenciais.

## Plano seguro de migração

1. **Origem e domínio:** definir domínio gerenciado pela Cloudflare e acesso seguro à origem Vercel durante a convivência.
2. **Assets estáticos:** publicar `public/` como Worker Static Assets ou Pages, com cache versionado e regras no-store para HTML sensível/PWA.
3. **API sem estado:** extrair primeiro rotas HTTP independentes de filesystem, WebSocket e processos locais; adaptar para Workers e testar contrato por contrato.
4. **Dados e mídia:** manter Supabase Auth/Postgres; mover mídia para Supabase Storage ou R2 privado, com URLs assinadas e isolamento por tenant.
5. **Eventos e tempo real:** migrar fanout/estado efêmero para Durable Objects ou serviço compatível; definir estratégia de reconexão e ordenação.
6. **Integrações:** manter Evolution/OpenRouter/Gemini externos, com secrets na Cloudflare e webhooks autenticados.
7. **Processos pesados:** áudio/ffmpeg, ZIP/XLSX e tarefas longas devem ir para serviço/container/filas apropriados, não para um request Worker sem avaliação.
8. **Validação:** executar testes de autenticação, RLS multi-tenant, inbox, contatos, Kanban, treinamento, campanhas, webhooks, uploads, mídia, áudio, histórico e desconexão de instâncias.
9. **Cutover:** somente após testes, configurar domínio/rotas, observar erros e manter rollback para Vercel.

## Critério para considerar a migração concluída

A migração só será considerada concluída quando o painel e as rotas de API operarem sem depender do backend Vercel, com persistência durável, uploads, autenticação, webhooks e fluxos críticos testados. Até lá, Vercel permanece como origem ativa.
