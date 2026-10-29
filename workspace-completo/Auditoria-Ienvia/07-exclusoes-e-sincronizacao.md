# Auditoria Ienvia — exclusões e sincronização de histórico

Data: 28/10/2026. Código preparado: v5.8.19, commit `8f61a13`.

## Problemas reproduzidos e corrigidos

1. **Recriação manual de contato:** salvar novamente uma ficha eliminava o marcador de exclusão sem preservar a data de corte. Um lote posterior de histórico podia reintroduzir mensagens anteriores à exclusão. A data de corte agora é transferida para a ficha antes da remoção do marcador. Mensagens posteriores continuam permitidas.
2. **Expiração arbitrária de marcadores:** depois que o mapa excedia 800 chaves, o código removia exclusões antigas sem verificar se a conversa poderia ser importada novamente. A remoção automática foi retirada. O mapa pode crescer e deve ser monitorado; as exclusões já descartadas por versões antigas não podem ser recuperadas desta forma.
3. **Envio de cache desatualizado para a nuvem:** se a nuvem guardava uma lista de mensagens vazia com data de limpeza, a reconciliação não filtrava as mensagens locais antigas. A barreira agora é aplicada mesmo com lista remota vazia.
4. **Recebimento de cache desatualizado da nuvem:** se a cópia local tinha lista vazia e data de limpeza, a importação podia restaurar mensagens remotas antigas. A barreira é aplicada e a correção da linha remota é agendada.

Os quatro cenários foram reproduzidos com dados sintéticos antes da correção e passaram depois. Não houve edição de conversas reais nem envio de mensagens. Os testes incluem isolamento de chips, retenção de 1.200 marcadores e aceitação de mensagens posteriores à exclusão.

## Verificações

- 38 arquivos de testes aprovados em cópia isolada, incluindo navegador, login, origem, histórico, assinatura e motor simulado.
- `npm audit --omit=optional`: nenhum alerta conhecido no momento da consulta; isso não demonstra ausência de falhas desconhecidas nem cobre dependências opcionais.
- ZIP assinado testado em checkout limpo; atualizadores v5.8.17 e v5.8.18 instalaram a v5.8.19 em ambientes sintéticos, preservando banco e sessão de teste.
- A v5.8.19 foi publicada na Vercel (`dpl_ybYBvEnoiZVRtMepVYYnhEe8qWJ1`, READY/PROMOTED); ZIP público idêntico ao local e assinatura válidos. A instalação real da v5.8.19 no motor não foi confirmada. Não foi solicitado novo reinício nesta etapa.

## Limites e trabalhos restantes

As correções não demonstram recuperação integral do histórico do WhatsApp e não cobrem todas as condições de concorrência entre aparelhos. Diário de histórico e cópias de recuperação locais podem conservar dados apagados; sua política de retenção/remoção precisa de avaliação antes de mudanças destrutivas. Permanecem necessárias a auditoria integral das funcionalidades e interfaces, backups/restauração, segurança adicional, testes reais por sistema operacional e verificação final. O prazo ou a completude não podem ser garantidos pelos testes parciais.
