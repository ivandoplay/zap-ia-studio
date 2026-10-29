# Auditoria Ienvia — origem do navegador e pacotes de treinamento

Referência: 28/10/2026. Correção preparada na versão 5.8.17, commit `7bd30e6`.

## Problema confirmado: páginas de terceiros acessavam o motor local

A configuração anterior considerava qualquer subdomínio `vercel.app` ou `e2b.app` confiável, mesmo se pertencesse a outro projeto. Além disso, a ausência do cabeçalho CORS não impedia que um formulário web de outra origem executasse uma ação: a rota ainda processava o POST.

Em cópia isolada, sem credenciais ou sessões reais, uma origem simulada de outro projeto Vercel conseguiu receber resposta da API local e um POST de formulário chegou ao método de envio **simulado**. O teste não enviou WhatsApp real e não comprova que alguém explorou o problema em produção.

### Correção

A API e os uploads agora recusam solicitações de navegador com origem diferente daquela que serviu o aplicativo, antes de executar a rota. Conexões WebSocket usam a mesma comparação. Requisições diretas sem Origin continuam permitidas; escrita marcada pelo navegador como cross-site e sem Origin é bloqueada. Domínios de hospedagem compartilhada não são confiáveis apenas pelo sufixo: a origem precisa coincidir com o Host solicitado. Em modo local, nomes de host admitidos incluem localhost, endereços LAN, nome do computador e prévias suportadas; teste de DNS rebinding com domínio externo simples foi rejeitado.

Isso não substitui autenticação: acesso direto sem Origin ou acesso pela rede local pode alcançar um motor local sem PIN, de acordo com a configuração existente. A política de incorporação em iframe (CSP `frame-ancestors`) ainda precisa ser avaliada separadamente para não quebrar a prévia; não se afirma proteção completa contra clickjacking. O proxy de prévia ao vivo não pôde ser acessado de dentro do próprio sandbox por exigir token de tráfego; o caso da prévia da mesma origem foi testado por HTTP simulado, não no proxy externo.

### Testes

- Testes que falhavam antes da correção e passaram depois: GET de outra origem, formulário cross-origin, POST sem Origin com `Sec-Fetch-Site: cross-site`, WebSocket e controles mesma origem/CLI.
- Chromium em cópia isolada: POST `no-cors` e WebSocket vindos de outra porta/origem não executaram envio simulado; painel da própria origem executou o envio simulado.
- API cloud simulada: origem própria aceita, outro projeto Vercel recusado. Testes específicos de localhost, rede privada, nome da máquina, prévia simulada, portas e nomes DNS não autorizados.
- 28 arquivos de testes Node passaram na cópia isolada; navegador da vitrine e login testado nas larguras 320, 375, 768 e 1440. Dados, sessões e envio real não foram usados.
- Atualizadores v5.8.15 e v5.8.16 instalaram o ZIP 5.8.17 em diretórios temporários, preservando banco e sessão sintéticos. A assinatura do segundo foi verificada pelo próprio atualizador. A primeira atualização a partir de v5.8.15 ainda não possui verificação retroativa de assinatura.

## Isolamento dos pacotes de treinamento

O pacote rastreado da conta master contém 50 exemplos de conversas, portanto é material potencialmente sensível e deve ser mantido privado. O repositório é privado e o pacote não consta do ZIP público do motor; ele é incluído no pacote destinado à conta master conforme comportamento existente. A inspeção não comprova vazamento para clientes nem autoria/exposição das conversas.

Em teste de memória com três contas sintéticas simultâneas, duas tinham pacotes com o mesmo ID mas conteúdos diferentes; cada uma recebeu apenas seu conteúdo. Uma terceira não recebeu pacote, inclusive depois de um pacote sintético master ter sido carregado no cache. Não foi feito teste entre contas reais nem prova completa das regras RLS. Nenhum pacote real foi alterado ou impresso.

## Estado operacional

A versão 5.8.17 foi publicada no GitHub e promovida na Vercel (`dpl_EJszK5vZnzxHAunyeSwJ1qSGYFWo`). Em produção foram verificadas a API na própria origem (HTTP 200), a rejeição de outra origem (HTTP 403), a resposta ao preflight (HTTP 204) e a assinatura do ZIP público; o pacote é idêntico ao artefato testado. O painel e a consulta de autenticação foram abertos sem login no Chromium em 375 px. Isso não testa login ou comandos de uma conta real.

A atualização remota 90e1215d-b768-40ff-bd56-77cc0958c4cd foi concluída. O Windows DESKTOP-9LRLOPT confirmou heartbeat na versão 5.8.17 às 10:51:30 UTC, e os slots 1 e 2 estavam conectados. A versão 5.8.18 foi publicada na Vercel e seu ZIP assinado validado, sem ordenar novo reinício do motor; ela ainda não foi instalada no aparelho real. A auditoria geral, recuperação completa de histórico e compatibilidade dos runtimes antigos continuam pendentes.
