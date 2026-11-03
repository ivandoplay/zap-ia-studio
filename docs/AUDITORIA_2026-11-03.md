# Auditoria técnica — ZAP-IA Studio / Ienvia

**Data:** 03/11/2026
**Repositório:** https://github.com/ivandoplay/zap-ia-studio
**Base auditada:** `4260e7e2bad9606a3b4e7b08427b6534c3d6d82c` — versão anunciada `5.8.28`
**Situação:** correções locais e regressão executadas; **não publicado e não homologado ponta a ponta em produção**.

> Este relatório não certifica ausência de outros defeitos. A rodada revisou os fluxos críticos de Evolution, campanhas, ingresso/saída de mensagens, persistência, isolamento, configuração e atualização do motor. Há pendências explícitas na seção 5. Não se deve publicar o código isoladamente sem a migração e a configuração descritas abaixo.

## 1. Resumo executivo

Foram encontrados problemas que permitiam falsificação de eventos de webhook, atribuição de instâncias desconhecidas à conta padrão, respostas duplicadas, perda de mensagens em concorrência, reenvio da mesma reserva de campanha e classificação indevida de aceite. Também foi identificado um bloqueio de **imagem/áudio em campanha Evolution**: o seletor preparava uma URL privada, mas o repositório ainda exigia um Buffer local próprio do Baileys.

As correções estão na cópia local. Foram adicionadas autenticação independente do webhook, normalização compartilhada de identidade, trava persistente por tentativa de campanha e projeção SQL transacional de mensagens/recibos. Foram mantidas as proteções de isolamento, mídia privada e ausência de retry automático após incerteza.

### Resultado reproduzível

| Verificação | Base original | Código corrigido |
|---|---:|---:|
| Suíte completa, ambiente isolado e Chromium disponível | 247 aprovados / 250, 3 falhas | **272 aprovados / 274, 2 falhas** |
| Recorte Evolution/CRM/campanhas | Não separado nesta comparação | **70 aprovados / 70** |
| SQL novo, PostgreSQL embarcado PGlite | Não existia | **8 cenários aprovados**, incluídos na suíte |
| Sintaxe de `src`, `api` e `scripts` | Não medida separadamente | **56 arquivos, nenhum erro** |
| `npm audit --omit=dev --json` | Não medido separadamente | Nenhum advisory reportado nessa consulta |

As **duas falhas restantes** são `ienvia-branding.test.mjs` e `static-release-package.test.mjs`. Ambas decorrem do mesmo problema: o release assinado é `5.8.27`, mas o projeto anuncia `5.8.28`. A validação de assinatura foi preservada; não houve troca de chave nem falsificação de artefato.

A falha adicional da base original era um teste de interface desatualizado: tentava selecionar um filtro que passou a ficar dentro do painel de filtros avançados. O teste foi adaptado para abrir esse painel e conferir `aria-expanded`, sem forçar interação com elemento oculto.

As primeiras tentativas de teste evidenciaram requisitos de ambiente: flag de isolamento, raiz descartável, caminho de Playwright e bibliotecas do Chromium. Esses erros de infraestrutura não foram contabilizados como defeitos do produto na comparação acima. A base original foi reextraída do Git e retestada no mesmo ambiente preparado.

## 2. Inspeção externa — somente leitura

### Supabase

- O projeto correspondente foi identificado como `ZAP-IA Studio`, na região `us-west-2`, com estado retornado `ACTIVE_HEALTHY`.
- As 17 tabelas públicas inventariadas têm RLS habilitado. Isso é uma constatação do catálogo, **não uma certificação de todas as políticas**.
- Foram consultadas as políticas de contatos, workspace, slots e checkpoints. Os checkpoints têm leitura limitada ao titular ativo e não permitem alteração direta pela conta autenticada.
- A migração de falhas de provedor `20261103031329_campaign_provider_failures.sql` consta como aplicada. A migração nova desta auditoria **não foi aplicada remotamente**.
- A conta `conta_titular` foi localizada e está ativa, com limite de três chips.
- O snapshot de `zapia_wa_slots` tinha dois registros com status `disconnected`. Esses registros não confirmam o estado atual da Evolution: o projeto mantém estados de motor e de provedor em caminhos diferentes. Não foi declarado que a instância real está desconectada apenas com base nesse snapshot.
- A consulta agregada de checkpoints dessa conta retornou **927 pendentes**. Nenhum checkpoint, destinatário, campanha ou conversa foi alterado para testar.

### Vercel e HTTP público

- O último deployment de produção consultado estava `READY`, associado ao mesmo commit da base auditada.
- `/api/public/version`: HTTP 200, versão `5.8.28`.
- `/api/evolution-webhook/health`: HTTP 200. Isso prova apenas disponibilidade do handler, não saúde ponta a ponta do WhatsApp.
- `/api/evolution-webhook/status`: HTTP 200 no código publicado, expondo URL/configuração e nomes de instâncias. A versão local reduz essa resposta a indicadores, sem os nomes.
- `HEAD /api/public/motor-update.zip`: **HTTP 500**, coerente com o bloqueio de release reproduzido localmente.
- A chave `EVOLUTION_API_KEY` foi identificada na Vercel como `sensitive`. A tentativa de leitura autorizada retornou `value: null`, `decrypted: false`. Não houve tentativa de contornar essa proteção, extrair segredo de logs ou reconstruir credenciais.

### Autorização de teste real

O usuário autorizou envio apenas pela conta `conta_titular`, exclusivamente para **DESTINATARIO_AUTORIZADO**. **Nenhuma mensagem real foi enviada nesta rodada.** Não havia sessão autenticada disponível nem chave Evolution recuperável pelo conector para verificar a instância e realizar o envio. Não foram criados links de login, alteradas senhas ou impersonadas sessões para contornar isso.

## 3. Inconsistências e correções locais

### A01 — Webhook sem autenticação — Crítica

**Evidência:** `src/server.js` montava o webhook antes da autenticação comum; `evolutionApiWebhook.js` não validava assinatura ou segredo. O nome da instância vinha do próprio corpo e poderia selecionar o workspace de um titular.

**Correção:** `EVOLUTION_WEBHOOK_SECRET` independente, validado por comparação constante no header `x-ienvia-webhook-secret`. Ausência de configuração falha de forma fechada. O modo sem banco é permitido somente no isolamento sintético explícito, nunca na Vercel. A configuração enviada à Evolution inclui o header.

**Teste:** segredo ausente/incorreto não acessa persistência, IA ou envio. Não foi feita prova ofensiva contra produção.

### A02 — Instância desconhecida atribuída à conta padrão — Crítica

**Evidência:** o resolvedor aceitava `EVOLUTION_DEFAULT_USER_ID` para qualquer nome não reconhecido; a listagem cloud usava fallback semelhante.

**Correção:** `src/evolutionIdentity.js` unifica as regras. A conta padrão vale apenas para nomes legados exatos `zap-ia-slot_1/2/3`. Nome com UUID resolve sua própria conta; nome personalizado exige mapa explícito com titular e chip. Instância desconhecida é recusada.

### A03 — Nomes personalizados colidindo no slot 1 — Alta

**Evidência:** vários trechos inferiam `slot_1` se o nome não terminasse no padrão conhecido. A listagem podia reconhecer um proprietário enquanto o envio procurava outro nome, gerando inconsistência entre status, histórico e disparo.

**Correção:** mapas personalizados usam `{userId, slotId}`. Listagem, envio, histórico, diagnóstico e operações de instância usam a identidade compartilhada. Múltiplas instâncias mapeadas para o mesmo chip bloqueiam a operação em vez de escolher silenciosamente uma delas.

**Impacto de rollout:** os mapas antigos com nome personalizado e valor somente string precisam de revisão. Não foi escolhido arbitrariamente um chip para os dois aliases de teste existentes na configuração publicada.

### A04 — Webhooks repetidos podiam responder duas vezes — Alta

**Evidência:** a deduplicação dependia de ler o histórico antes da IA e só gravá-lo depois do envio. Duas invocações concorrentes podiam observar a mesma ausência.

**Correção:** entrada persistida antes da IA, com chave durável `conta/conversa/messageId`. Só a primeira inserção autoriza a resposta. Em falha posterior, não há reenvio automático do mesmo evento.

**Limite:** isso privilegia não duplicar. Uma queda depois da entrada e antes da resposta ainda exige reconciliação; não foi implantado um worker de outbox de IA.

### A05 — Entrada perdida quando IA/envio falhava — Alta

**Evidência:** entrada e resposta eram gravadas apenas ao final; o catch devolvia HTTP 200 mesmo quando nada fora persistido. `saveHistory` podia retornar erro que o handler ignorava.

**Correção:** falha de projeção antes do aceite devolve 503. A entrada é salva primeiro. Resposta prestes a ser enviada é registrada como incerta; só passa a aceita com ID do provedor. Falha posterior à persistência não pede repetição cega ao provedor.

### A06 — Leitura/reescrita concorrente do JSON de contatos — Alta, mitigada no caminho Evolution

**Evidência:** `saveHistory` e `persistMessageAck` faziam read-modify-upsert separado. Duas mensagens/ACKs podiam se sobrepor. O merge também truncava a conversa em 120 mensagens.

**Correção:** RPC `ienvia_merge_evolution_contact`, exclusiva de `service_role`, usa lock transacional por conta/conversa, mescla IDs, preserva metadados e notas e não aplica o corte arbitrário em 120. A rota de envio de campanha não carrega nem faz flush de um snapshot completo do workspace.

**Limite importante:** outros escritores legados de contatos ainda usam `flushTenantStoreToCloud`. A garantia transacional desta correção não se estende automaticamente a todo o sistema; ver P04.

### A07 — Recibos fora de ordem ou regressivos — Alta

**Evidência:** ACK era descartado se chegasse antes da mensagem; uma reescrita de histórico podia voltar o status para aceito. Status numérico em string não era interpretado como número.

**Correção:** recibos ficam persistidos mesmo antes da mensagem, são reaplicados ao merge e avançam por `max(ack)`. Há normalização de ACK numérico/string. Aceito não equivale a entregue/lido. A interface mostra aviso explícito para envio incerto, em vez de inferir um check de enviado; ACK real remove esse estado. O merge respeita `historyClearedAt` para não ressuscitar histórico limpo.

### A08 — Imagem/áudio Evolution impedido pelo repositório de campanha — Alta

**Evidência:** `campanhaSelecao.js` corretamente não baixa o arquivo no caminho Evolution; `candidatoValido` em `campanhaRepositorio.js` exigia `anexo.buffer` para toda mídia, sem distinguir provedor. Os testes antigos cobriam texto no motor e áudio diretamente na rota, mas não esse contrato intermediário.

**Correção:** para Evolution, o repositório valida os UUIDs de arquivo e pasta sem exigir bytes locais. O caminho Baileys continua exigindo Buffer. A rota de envio mantém a validação da mídia privada e do ticket da própria conta.

**Teste:** regressões específicas para imagem e áudio sem Buffer, com manutenção das rejeições no caminho Baileys.

### A09 — Replay de `/campaign-send` podia disparar a mesma tentativa — Alta

**Evidência:** a rota verificava apenas se o checkpoint estava `em_envio`; não consumia a permissão de envio. Duas chamadas concorrentes ou repetidas podiam passar pela mesma leitura.

**Correção:** RPC `ienvia_claim_evolution_send` faz claim único persistente por titular/tentativa. Revalida campanha ativa, checkpoint, provedor, chip, cota e restrições de destinatário. Sem migração ou sem claim, não há chamada de envio. Uma tentativa utilizada não é liberada automaticamente após timeout.

**Teste:** duas requisições concorrentes, com clientes diferentes, geram uma aceitação e um bloqueio; há testes SQL de conta distinta, inativa, campanha pausada e opt-out.

### A10 — Registro da campanha ausente no caminho Evolution — Alta

**Evidência:** `campanhaEmissor.js` retornava antes de chamar `registrar` no ramo Evolution. O callback `SEND_MESSAGE` não continha `campaignId`, prejudicando correlação e contexto de resposta/opt-out.

**Correção:** o emissor registra também nesse ramo, com fallback seguro de chave por chip. A rota grava o marcador de campanha por RPC no banco. Erro de registro depois do aceite retorna aviso, sem transformar o aceite em autorização de reenvio. O registro Evolution não inventa `ack:1`.

### A11 — HTTP 2xx sem ID tratado como sucesso — Alta

**Evidência:** funções de envio podiam aceitar `{}` ou resposta não JSON se o HTTP fosse 2xx. Rejeição expressa por status numérico também não era coberta.

**Correção:** texto, mídia, voz e contato exigem ID não vazio do provedor. JSON inválido é recusado; rejeições numéricas >=400 são tratadas como falha. A aceitação continua distinta da entrega. Ausência de ID gera incerteza, não retry automático.

### A12 — Direção interpretada incorretamente com `"false"` — Alta

**Evidência:** `Boolean('false')` é verdadeiro. O webhook e o normalizador CRM podiam registrar entrada como saída e omitir o atendimento.

**Correção:** conversão booleana explícita compartilhada. Casos `false`, `"false"`, `true`, `"true"` e valor numérico compatível são tratados deliberadamente.

### A13 — Formatos de evento inconsistentes — Média/Alta

**Evidência:** o handler principal não processava arrays de mensagens, ignorava conteúdo efêmero encapsulado e podia falhar com timestamps inválidos/ISO. Broadcast/status podiam atravessar a filtragem limitada a grupos.

**Correção:** processamento de registros por lote, desempacotamento limitado de wrappers, timestamp normalizado e filtragem de JIDs para atendimento direto. Evento sem ID não dispara IA, pois não há identidade segura para deduplicar.

### A14 — Pausa/opt-out e switch de chip ignorados — Alta

**Evidência:** o webhook verificava essencialmente `settings.botEnabled`; não aplicava as mesmas restrições de chip e contato do motor.

**Correção:** valida titular ativo/cota, switch global, switch do chip, `aiIgnored`, lista de ignorados e pausa do contato. Pedido explícito de parada é persistido antes da IA. Restrições são revalidadas após a latência de IA, antes do envio. Não se envia demonstração de IA como resposta operacional.

**Limite:** a janela entre a última validação e o efeito externo não é uma transação com o WhatsApp. As ações avançadas da IA ainda não têm paridade integral com o motor, conforme P07.

### A15 — Mídia sem conteúdo acessível desaparecia ou virava entrada vazia — Média

**Correção:** áudio/imagem/documento sem arquivo disponível ficam registrados com marcador. Sem texto ou base64 validável, o sistema não finge compreender mídia nem responde a entrada vazia. Base64 tem limite e MIME permitido; não há download de URL arbitrária fornecida no evento.

**Pendente:** validar decodificação, formatos e disponibilidade reais com a instância do usuário. O teste sintético não certifica PTT/áudio no celular.

### A16 — Conteúdo de conversas em logs e resposta pública — Alta

**Evidência:** o webhook imprimia número, texto de entrada e trecho da resposta; a rota de status publicava nomes de instâncias.

**Correção:** remoção desses dados dos logs operacionais e redução do status público a indicadores. As respostas do novo webhook não expõem o texto gerado pela IA.

### A17 — Chip inválido redirecionado silenciosamente para slot 1 — Alta

**Evidência:** connect/refresh/reconnect/disconnect usavam fallback para slot 1 quando recebiam slot malformado.

**Correção:** rejeição 400 para chip inválido e validação de cota nas operações com perfil autenticado. Não há efeito externo nesse caso. Falta de segredo é detectada antes de criar/reiniciar instância.

### A18 — Destino de webhook baseado em Host/preview — Alta

**Evidência:** sem variáveis da plataforma, o destino podia ser construído a partir de `Host`; previews podiam virar destino permanente. A URL recebe o segredo configurado para o webhook.

**Correção:** origem HTTPS explícita ou host estável de produção. Em Vercel, o destino não depende do header Host da requisição nem do deployment preview. Segredo e origem são documentados separadamente.

### A19 — Setup restrito a nomes legados e alteração em lote — Média

**Correção:** `scripts/evolution-setup.sh` exige uma instância exata em `EVOLUTION_SETUP_INSTANCE`, exige segredo e HTTPS e configura o header. Não percorre todas as contas alterando webhooks em massa nem ignora silenciosamente nomes com UUID.

### A20 — Testes não reproduzíveis em instalação limpa — Média

**Evidência:** não havia script `npm test`; vários testes precisavam de flags, isolamento e resolução de Playwright não configurados pelo pacote.

**Correção:** `scripts/test-isolated.mjs` executa numa cópia descartável sem sessões, banco local privado ou `.env`; só herda variáveis básicas do sistema. Foram adicionados `test`, `test:evolution`, `test:sql` e dependência de desenvolvimento PGlite. Execução é serial para evitar interferência em estado de teste compartilhado.

### A21 — Teste de interface interagia com filtro oculto — Média

**Correção:** o teste abre os filtros avançados pela interface e valida a expansão antes de selecionar o chip. Os fluxos sintéticos passaram em 320, 375, 768 e 1440 px, incluindo envio simulado por chip, nota privada, anexo, áudio, catálogo e backup/restauração.

### A22 — Lote vazio quebrava ingresso CRM — Média

**Evidência:** `src/crmV2/eventIngress.js` acessava `events[0].instanceName` mesmo quando a normalização gerava lista vazia.

**Correção:** retorno neutro para lote vazio, sem consultar titular inexistente nem persistir registros.

## 4. O que foi efetivamente testado

- Segredo correto, incorreto e ausente; instância desconhecida e mapa explícito de chip.
- Duplicação concorrente de eventos e replay concorrente de envio de campanha.
- Entrada salva antes da IA; erro de leitura/gravação; timeout de envio sem repetição.
- Texto encapsulado, direção em string, lote, timestamp inválido e broadcast.
- Pausa global, switch por chip, opt-out e mídia indisponível.
- Reserva de imagem/áudio Evolution sem Buffer e manutenção da exigência no Baileys.
- Tickets privados de áudio, endpoint PTT e validação de escopo em transporte simulado.
- SQL compilado/executado em PostgreSQL embarcado, locks/constraints presentes, isolamento por titular, restrições de acesso, dedupe, ACK antecipado, progressão de status, tombstone, retenção de mais de 120 mensagens e marcador de campanha.
- Interface de CRM/campanha, autenticação, isolamento, atualizador, mídia, origem do navegador, importação e demais testes já existentes na suíte.

**Não foi testado:** entrega/leitura real no telefone, recebimento físico de mensagem pela instância, processamento real de PTT, assinatura de release novo, deploy de homologação ou migração em cópia integral do banco produtivo. PGlite não substitui teste multi-sessão/load de um PostgreSQL Supabase real.

## 5. Pendências e riscos remanescentes

| ID | Prioridade | Pendente / motivo |
|---|---|---|
| P01 | Bloqueia release | Gerar pacote da versão correta e assiná-lo com a chave privada legítima. O artefato existente é 5.8.27; endpoint produtivo retorna 500. A chave não está disponível neste ambiente. Não baixar a versão anunciada nem desabilitar verificação para mascarar o problema. |
| P02 | Bloqueia rollout | Homologar e aplicar a migração nova, configurar segredo no receptor/provedor e revisar os mapas de instância personalizados. Tudo permanece local. Publicar só o JS quebraria o ingresso e os disparos por falha fechada deliberada. |
| P03 | Alta | Teste real autorizado ainda não executado. Exige sessão autenticada válida da conta ou acesso operacional seguro à Evolution. O conector Vercel não devolve a chave sensível. Não enviar segredos em chat nem usar outros destinatários. |
| P04 | Alta | Consolidar escritores de contatos em operações atômicas/versionadas. `flushTenantStoreToCloud` ainda lê/mescla e faz upsert fora da nova RPC; um escritor legado concorrente pode sobrescrever dados do webhook. A mitigação desta rodada cobre os caminhos Evolution alterados, não todo o CRM. |
| P05 | Alta | Separar IA do request de webhook por fila/outbox durável com worker e reconciliação de envio. A entrada agora é durável e repetição não duplica, mas uma queda depois do claim de ingresso pode deixar resposta ausente. Atualmente a recuperação é manual, não retry automático. |
| P06 | Alta | Validar cargas grandes e eventos não implementados. O novo ingresso limita lotes a 500 registros; lotes maiores precisam de paginação/ingestão assíncrona homologada. A Vercel limita a função a 60 s. Eventos de edição/exclusão/conexão não têm projeção operacional completa nesse handler e continuam exigindo trabalho específico. |
| P07 | Média/Alta | Paridade funcional de IA: envio de catálogo, PIX, biblioteca de voz, handoff e outras ações do motor não são implementados integralmente pelo webhook cloud. A rodada cobre resposta textual/mídia de entrada e restrições de segurança, não toda a automação do motor Baileys. |
| P08 | Média | Homologar aliases PN/LID e mídia real. JID LID é preservado, mas não se inventa telefone para auto-responder; pode ser necessária correlação segura com PN. Tickets e endpoints de áudio foram testados por mocks, não no WhatsApp real. |
| P09 | Operacional | Definir retenção/observabilidade das tabelas novas de ingresso e claims. Não remover claims de tentativas ainda reutilizáveis: sua retenção é parte da proteção contra replay. Não há garantia de "exactly once" ponta a ponta com serviço externo. |

## 6. Migração nova e implantação segura

Arquivo: `supabase/migrations/20261103120000_evolution_ingress_send_safety.sql`.

Cria duas tabelas de controle privadas com RLS e três RPCs:

1. `ienvia_claim_evolution_send`: claim único de envio da campanha, sob titular autenticado.
2. `ienvia_merge_evolution_contact`: projeção transacional exclusiva de `service_role`.
3. `ienvia_record_evolution_campaign_send`: correlação da saída aceita com a campanha do titular.

### Sequência recomendada — não executada em produção

1. Fazer backup e preparar homologação com esquema equivalente ao produtivo; revisar grants e políticas reais, não apenas o fixture SQL mínimo dos testes.
2. Executar a suíte e aplicar a migração nessa homologação. Validar concorrência multi-sessão, carga e falhas com serviço real.
3. Gerar o segredo fora do Git e configurá-lo no receptor. Não publicar nem registrar o valor.
4. Confirmar na versão instalada da Evolution que `webhook.headers` é encaminhado ao receptor. Configurar o mesmo segredo no header de webhook **das instâncias já existentes**, uma por vez. Não desconectar nem reparear chips apenas para trocar webhook.
5. Conferir `EVOLUTION_INSTANCE_USERS`: nomes personalizados precisam de `userId` e `slotId`. Resolver duplicidade de instância por chip antes do rollout.
6. Aplicar a migração revisada e realizar rollout coordenado do backend. O código antigo não valida o novo header; coordenar a transição para minimizar a janela anterior de webhook desprotegido.
7. Usar uma sessão autenticada da conta autorizada para verificar o slot conectado. Fazer um envio pequeno, identificado como teste, **somente para DESTINATARIO_AUTORIZADO**. Conferir ID, webhook, ACK e recebimento no telefone. Depois testar resposta de entrada e uma campanha de um único destinatário, sem adicionar contatos de produção.
8. Se houver timeout ou status incerto, conferir a conversa e o ID antes de qualquer repetição. Nunca trocar de chip silenciosamente.
9. Finalizar o release, assinar com a chave legítima e conferir versão/hash/assinatura. Somente então promover o pacote do motor.

Variáveis: `.env.example`, `EVOLUTION-API-INTEGRACAO.md` e `EVOLUTION-API-VERCEL.md` foram atualizados. Segredos de produção não devem ser reutilizados em previews.

## 7. Como reproduzir

```bash
npm ci --ignore-scripts
npx playwright install --with-deps chromium
npm run test:evolution
npm run test:sql
npm test
npm audit --omit=dev --json
```

`npm test` retorna código de saída 1 enquanto os dois testes do release assinado estiverem falhando. Isso é intencionalmente visível, não foi transformado em sucesso artificial.

Os testes usam dados sintéticos e cópia descartável. Não devem ser executados diretamente sobre um diretório com sessões ou dados reais. O arquivo ZIP desta auditoria é uma cópia de revisão local, **não um pacote de autoatualização assinado**.

## 8. Evidências e entrega

Pasta: `docs/auditoria-2026-11-03/evidencias/`.

- `baseline.txt`: base Git original, com ambiente preparado — 250 testes, 3 falhas.
- `suite-final.txt`: código corrigido — 274 testes, 2 falhas de release.
- `evolution.txt`: recorte focado — 70 testes aprovados.
- `sintaxe.json`: 56 arquivos verificados sem erro.
- `npm-audit.json`: resultado integral da consulta de advisories.

Não foi feito push, merge, deployment, alteração de variável remota, migração remota ou disparo real. O conector GitHub não está disponível nesta plataforma; o clone público via Git funcionou. Os conectores Supabase e Vercel foram usados nas consultas indicadas.


## Adendo posterior — teste real A1 e migração pontual autorizada

Após a entrega original, o usuário forneceu credencial Evolution, confirmou o servidor e autorizou explicitamente corrigir a função de reserva no Supabase. Foi reproduzida incompatibilidade antes não coberta: a função SQL recusava o campo `provedor` emitido pelo worker. Corrigida e aplicada **somente** a migração `20261103153731_campaign_reservation_provider_compat.sql`, com 9/9 testes SQL e 19/19 testes focados adicionais. As outras migrações/correções locais continuam sem publicação; não houve deploy.

Campanha `CAMPANHA_TESTE_A1`, conta conta_titular, destino exclusivo DESTINATARIO_AUTORIZADO: duas mensagens entregues com DELIVERY_ACK, segunda com texto editado e depois da nova janela. Reserva real às 12:40:32 foi bloqueada, apesar de já vencida a pausa anterior; janela abria 12:41. Campanha concluída, revisão 14, dois checkpoints confirmados. A execução foi pontual via RPCs no conector e emissor/transporte locais com chave em memória — não homologa o scheduler/endpoint Vercel do titular nem resolve sua autenticação. O histórico recebeu os textos, mas ACK/campaignId ainda estavam ausentes. Ver relatório completo `auditoria/RESULTADO_CAMPANHA_TESTE_A1.md` (cópia no diretório docs deste projeto). O ZIP/patch originais são entregas anteriores e não incluem este adendo.


## Validação pré-commit posterior ao teste real

A suíte integral foi novamente executada após o adendo SQL de compatibilidade de provedor e o reforço do runner para excluir `.runtime`, uploads e screenshots. Resultado: **281/283 testes aprovados**, sem skips; duração aproximada 81 segundos. As duas falhas seguem restritas a `ienvia-branding.test.mjs` e `static-release-package.test.mjs`, já documentadas como bloqueio de release assinado. Evidência: `docs/auditoria-2026-11-03/evidencias/suite-pre-commit.txt`. As versões de relatório destinadas ao Git foram anonimizadas; as evidências reais completas permanecem fora do repositório. O arquivo `.env` continua ignorado e não versionado.
