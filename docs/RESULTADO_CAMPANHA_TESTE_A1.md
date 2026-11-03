# Resultado do teste real de campanha A1 — versão anonimizada

> Cópia própria para versionamento. Telefone, usuário e IDs reais foram substituídos por rótulos; as evidências completas permanecem fora do Git.

**Data:** 03/11/2026. Horários locais em `America/Fortaleza` (UTC−3).

## Resultado executivo

**Duas mensagens reais entregues ao único destinatário autorizado `DESTINATARIO_AUTORIZADO`.** Ambas receberam `DELIVERY_ACK` na Evolution. A segunda utilizou o texto editado depois da primeira e foi solicitada somente depois de abrir a nova janela de horário.

A campanha terminou como **`concluida`**, revisão **14**, com **2 checkpoints confirmados e 0 pendentes**. Leitura pelo destinatário não foi confirmada.

| Item | Evidência |
|---|---|
| Conta | `conta_titular` |
| Campanha | `CAMPANHA_TESTE_A1` |
| Nome | TESTE CONTROLADO - Edicao e horarios - 03-11-2026 A1 |
| Instância / chip | `zap-ia-slot_1` / `slot_1` |
| Destinatários | Exatamente 1: `DESTINATARIO_AUTORIZADO` |
| Mensagens solicitadas | Exatamente 2; sem retry automático |
| Conexão consultada | Instância `open`; identidade vinculada à conta principal na configuração Vercel |
| Validação do número | Evolution retornou `exists=true` e JID exato `DESTINATARIO_AUTORIZADO@s.whatsapp.net` |
| Credencial | Fornecida pelo usuário; utilizada em memória, sem inclusão em código, arquivos de configuração ou relatórios |

## Falha real encontrada e correção autorizada

A função publicada `ienvia_private.reservar_campanha` rejeitava material com a propriedade `provedor`, embora o repositório do worker envie essa propriedade tanto em Evolution quanto em Baileys. A condição `(p_material-'slotId'-'bloco') <> '{}'` tornava a reserva vazia sem apresentar erro. O checkpoint continuava pendente e nenhum envio acontecia.

O teste real reproduziu esse bloqueio antes de qualquer mensagem. A campanha foi pausada enquanto a correção era preparada.

Foi criada uma migração que aceita o campo opcional `provedor` somente com valores `baileys` ou `evolution_api`, mantendo compatibilidade com materiais legados sem o campo. Mantém os controles de proprietário, conta ativa, revisão exata, lock, chip, material preservado, ordem, horário e reserva única.

**Após autorização explícita do usuário**, foi aplicada no Supabase a migração:

- Versão registrada: **`20261103153731`**.
- Nome: **`campaign_reservation_provider_compat`**.
- Fonte local: `supabase/migrations/20261103153731_campaign_reservation_provider_compat.sql`.
- Somente o corpo da função privada existente foi alterado. Não houve deploy da aplicação, alteração de credenciais ou aplicação das outras migrações locais da auditoria.
- Verificação posterior: RLS permanece ativo nas tabelas de controle/checkpoint e `anon` não recebeu permissão de execução da função privada.
- Não foi iniciado scheduler geral nem ativada outra campanha. O registro de worker temporário do teste foi removido ao final.

## Linha do tempo e IDs reais

| Evento | Horário Fortaleza | Resultado |
|---|---|---|
| Primeiro aceite | **12:37:54** | ID `ID_PRIMEIRA_MENSAGEM`; entrega confirmada por `DELIVERY_ACK` |
| Edição após primeira etapa | **12:38:16** | Texto da etapa pendente alterado para **CONTEUDO ATUALIZADO**; nova janela de 12:41 a 12:59 |
| Reserva antecipada real | **12:40:32** | Bloqueada: checkpoint pendente, sem material e sem tentativa |
| Abertura da nova janela | **12:41:00** | Liberação de novas reservas permitida pelo horário |
| Reserva da segunda etapa | **12:41:11** | Checkpoint real `em_envio`, material com o texto atualizado |
| Segundo aceite | **12:41:20** | ID `ID_SEGUNDA_MENSAGEM`; entrega confirmada por `DELIVERY_ACK` |
| Conclusão conferida | **12:41:28** | Campanha `concluida`, revisão 14, 2 confirmadas, 0 pendentes |

### Por que a checagem antecipada comprova a janela

A pausa previamente calculada venceria às **12:40:16**. Às **12:40:32**, ela já tinha vencido, mas a nova janela ainda estava fechada. A RPC real não reservou a etapa; a revisão permaneceu 12 e o checkpoint continuou pendente, sem tentativa nem material. Logo, o bloqueio não foi simplesmente a pausa antiga ainda em andamento.

A edição também mudou o intervalo entre etapas de 120 para 180 segundos. Como já explicado na auditoria, essa alteração **não recalculou** a `proxima_acao_em` existente. A nova janela foi respeitada independentemente disso.

### Conteúdo da segunda mensagem entregue

> [TESTE TECNICO IENVIA A1] Etapa 2 de 2 - CONTEUDO ATUALIZADO. Texto e janela de horario alterados apos a primeira etapa; reserva liberada somente no novo horario.

A consulta posterior à Evolution confirmou esse texto no registro do próprio ID da segunda mensagem. O texto original da segunda etapa não foi solicitado ao provedor.

## Histórico, entrega e pendência que continua aberta

As duas mensagens apareceram no histórico Supabase do aplicativo, com os mesmos IDs retornados pela Evolution. O script de teste não gravou esse histórico; a aparição é evidência do ingresso real das mensagens no sistema.

**Entretanto, nessa conferência o histórico publicado ainda tinha `ack=null`, `deliveryStatus=null` e `campaignId=null` nesses dois registros**, embora o provedor já apresentasse `SERVER_ACK` e `DELIVERY_ACK`.

Isso não invalida a entrega confirmada pelo provedor, mas significa que o rastreamento de entrega/correlação de campanha no painel **não foi homologado como corrigido**. As correções de merge/ACK/correlação e a migração de segurança da auditoria anterior continuam sem publicação/homologação em produção.

## Escopo preciso: o que este teste prova e o que não prova

**Prova neste cenário real:**

- Instância autorizada conectada e número confirmado sem troca de destinatário.
- Reserva durável real após a correção pontual do SQL.
- Preparação e envio com os módulos locais `campanhaPlano`, `campanhaEmissor` e `evolutionApiCloud`.
- Entrega real das duas mensagens.
- Edição de conteúdo pendente e bloqueio pela nova janela, sem repetir a primeira etapa.
- Confirmação real dos checkpoints e conclusão da campanha.
- Ingresso dos dois textos no histórico do aplicativo.

**Não prova:**

- Login/sessão do titular no executor local: isso não foi fabricado nem necessário neste transporte direto autorizado.
- Fluxo automático completo do worker autenticado, scheduler geral ou endpoint de envio da Vercel. As RPCs foram acionadas pelo conector Supabase, com escopo explícito do titular, e o envio pela chave Evolution fornecida usando o código local.
- Disponibilidade contínua de um motor para futuras campanhas: o executor deste teste foi pontual.
- Demais correções locais publicadas, novas RPCs de claim/merge da auditoria anterior, mídia, volume, concorrência real, leitura pelo destinatário ou resposta de entrada do destinatário.
- Garantia de que toda alteração futura afete materiais já reservados/preparados; as regras documentadas continuam válidas.

## Testes automatizados adicionais

- **9/9 testes SQL** em PostgreSQL embarcado (PGlite), carregando a migração integral de campanhas original e a nova correção. Reproduzem o defeito original e verificam Evolution, Baileys, legado, rejeição de provedores inválidos, chip, tenant, conta ativa, revisão, pausa, agendamento, janela, material preservado, reserva única, grants e RLS.
- **19/19 testes focados** incluindo esses SQL, proxy Evolution, repositório/material e reserva de worker.
- Na validação pré-commit, após este adendo, a suíte integral foi reexecutada em ambiente isolado: **281/283 passaram**, sem skips. As duas falhas continuam sendo `ienvia-branding.test.mjs` e `static-release-package.test.mjs`, relacionadas ao release assinado 5.8.27 versus aplicação 5.8.28. A evidência está em `docs/auditoria-2026-11-03/evidencias/suite-pre-commit.txt`. Não foi alterada a assinatura para mascarar esse bloqueio.

## Arquivos de evidência

- `a1-provider-delivery.json`: textos e status retornados pela Evolution, filtrados exclusivamente pelos dois IDs do teste.
- `a1-validacao-horario.json`: checagem antecipada e janela.
- `envios-a1/etapa_0.json` e `etapa_1.json`: aceite, IDs e tentativas locais, sem segredo.
- `a1-reserva-etapa-0.json` e `a1-reserva-etapa-1.json`: snapshots restritos das reservas reais.
- `campanha-provider-reservation-sql.log`: 9/9.
- `campanha-teste-real-regressao.log`: 19/19.

## Recomendação de segurança

Como a chave Evolution foi compartilhada no chat, **revogá-la e gerar uma nova após o teste**, atualizando-a pelos mecanismos seguros usados na infraestrutura. Este teste não realizou rotação nem alterou a chave da Vercel.
