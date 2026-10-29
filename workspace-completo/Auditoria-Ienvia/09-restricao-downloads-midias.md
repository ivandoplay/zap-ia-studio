# Auditoria Ienvia — downloads de mídia no motor

Versão v5.8.20, commit `c3f2b41`, 28/10/2026.

## Achado e correção

Em laboratório sem credenciais, sockets ou rede real, o download para o cache e o encaminhamento aceitaram uma URL sintética apontando para serviço interno, incluindo a possibilidade de encaminhar os bytes simulados. Não há evidência de exploração real. Ambas as rotas de download agora exigem origem do Supabase configurado, bucket previsto e pasta da conta ativa; não seguem redirecionamentos e recusam fluxo maior que 35 MiB, inclusive sem `Content-Length`. URLs externas de terceiros anteriormente aceitas nesses caminhos passam a ser bloqueadas; arquivos locais continuam com o comportamento existente.

Os dois cenários reproduziram a falha em código anterior e passaram após a correção. Os testes também cobrem arquivo legítimo sintético, nome divergente, pasta de outra conta, URL malformada/escapada, redirecionamento e tamanho. A restrição protege esses caminhos específicos, não é comprovação de segurança de todas as buscas externas nem de isolamento do cache compartilhado.

## Verificações

- 40 arquivos de testes passaram em cópia isolada; suíte inclui Chromium, mas envio/recebimento real não foi repetido nesta etapa.
- `npm audit --omit=optional`: zero alertas conhecidos na consulta, sem cobertura de opcionais ou de vulnerabilidades desconhecidas.
- Assinatura verificada em checkout limpo; atualizadores anteriores instalaram a v5.8.20 em cenários sintéticos com banco e sessão preservados.
- Confirmar publicação, ZIP real e versão do dispositivo separadamente; sem qualquer reinício ou envio real nesta etapa.

## Bloqueio crítico remanescente

O bucket permanece público e permite listagem anônima. O Supabase recusou a alteração por propriedade da tabela, em migração e na execução administrativa direta. É preciso acesso pelo mecanismo autorizado do Storage e migração segura dos leitores para bucket privado/URLs temporárias antes de afirmar confidencialidade das mídias. A auditoria geral permanece incompleta.

## Publicação e motor

A v5.8.20 foi publicada e o ZIP distribuído foi conferido com a assinatura. O comando remoto `3fc2c477-9fe1-4234-8fcd-74aae07f08fd` concluiu e o Windows confirmou heartbeat v5.8.20 com slots 1 e 2 ativos. Não foram repetidos envios de mídias reais.
