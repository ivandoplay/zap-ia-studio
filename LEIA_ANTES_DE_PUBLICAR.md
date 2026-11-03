# Correções locais — auditoria de 03/11/2026

Este diretório contém o projeto revisado localmente, não um release pronto para produção.

- Relatório completo: `docs/AUDITORIA_2026-11-03.md`.
- Evidências: `docs/auditoria-2026-11-03/evidencias/`.
- Migração nova: `supabase/migrations/20261103120000_evolution_ingress_send_safety.sql`.
- Base Git: `4260e7e2bad9606a3b4e7b08427b6534c3d6d82c`.

## Atenção antes de publicar

1. Homologar a migração contra esquema equivalente ao produtivo.
2. Configurar `EVOLUTION_WEBHOOK_SECRET` no receptor e no header `x-ienvia-webhook-secret` de cada instância autorizada. Validar suporte na versão instalada.
3. Revisar mapas de instância personalizados: devem indicar `userId` e `slotId`; não mapear duas instâncias para o mesmo chip.
4. Não publicar somente o JavaScript: sem migração/segredo, o sistema bloqueia ingresso e disparos por segurança.
5. Resolver o release assinado: projeto anuncia 5.8.28, mas `release/motor-update.zip` é da 5.8.27. Não remover assinatura ou trocar a chave pública para forçar o teste.
6. Executar homologação real. Nesta rodada não houve mensagens reais, push, deploy ou mudanças no Supabase/Vercel.

A autorização de teste real cobre somente a conta `conta_titular` e o destinatário **DESTINATARIO_AUTORIZADO**. Não criar campanha com a lista existente nem acrescentar outros destinatários para testar.

## Testes

```bash
npm ci --ignore-scripts
npx playwright install --with-deps chromium
npm run test:evolution
npm run test:sql
npm test
```

Resultado: 70/70 testes focados aprovados; suíte completa 272/274. As duas falhas de release continuam visíveis, com exit code 1. Há outras pendências arquiteturais e operacionais detalhadas no relatório.


## Adendo posterior — teste real A1 e migração pontual autorizada

Após a entrega original, o usuário forneceu credencial Evolution, confirmou o servidor e autorizou explicitamente corrigir a função de reserva no Supabase. Foi reproduzida incompatibilidade antes não coberta: a função SQL recusava o campo `provedor` emitido pelo worker. Corrigida e aplicada **somente** a migração `20261103153731_campaign_reservation_provider_compat.sql`, com 9/9 testes SQL e 19/19 testes focados adicionais. As outras migrações/correções locais continuam sem publicação; não houve deploy.

Campanha `CAMPANHA_TESTE_A1`, conta conta_titular, destino exclusivo DESTINATARIO_AUTORIZADO: duas mensagens entregues com DELIVERY_ACK, segunda com texto editado e depois da nova janela. Reserva real às 12:40:32 foi bloqueada, apesar de já vencida a pausa anterior; janela abria 12:41. Campanha concluída, revisão 14, dois checkpoints confirmados. A execução foi pontual via RPCs no conector e emissor/transporte locais com chave em memória — não homologa o scheduler/endpoint Vercel do titular nem resolve sua autenticação. O histórico recebeu os textos, mas ACK/campaignId ainda estavam ausentes. Ver relatório completo `auditoria/RESULTADO_CAMPANHA_TESTE_A1.md` (cópia no diretório docs deste projeto). O ZIP/patch originais são entregas anteriores e não incluem este adendo.
