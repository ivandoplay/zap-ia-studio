# Teste da IA na conta pelo site de produção

Data: 28/10/2026. Jefferson forneceu acesso à própria conta e autorizou testes; as credenciais não foram gravadas nos scripts ou neste relatório. Login feito pelo formulário do painel no domínio Vercel, navegador temporário e sessão descartada após os testes. Não abriram sockets WhatsApp adicionais.

## Resultado

- Conta esperada autenticada; motor exibido como online.
- A IA geral permaneceu desligada. Sua configuração final foi confirmada no banco como `false`; chips 1 e 2 constavam conectados e com worker online.
- Teste de conexão pelo botão do painel, após o carregamento completo do formulário: HTTP 400, `This operation was aborted`. Não houve resposta da IA no teste do site.
- Envio de uma pergunta no simulador pelo site: HTTP 500, mesma mensagem. Nenhuma resposta da IA foi recebida. O histórico verificado no acesso seguinte continha as mesmas quatro entradas anteriores; o teste falho não deve ser dado como resposta realizada.
- Uma primeira tentativa do botão foi feita antes da renderização completa do formulário e exibiu chave ausente. Essa observação era inválida: o diagnóstico posterior, já após renderização, confirmou chave Gemini configurada sem registrá-la ou exibi-la.
- Verificação da própria API Gemini em ambiente separado, usando a chave configurada sem imprimi-la: a geração com `gemini-3.5-flash-lite` respondeu HTTP 200 com texto em uma tentativa; outra encerrou por timeout de 20 segundos; uma terceira respondeu HTTP 200 em aproximadamente 30,7 segundos. A consulta de modelo retornou 200. A geração com `gemini-2.5-flash-lite` retornou 404 dizendo que não está disponível para novos usuários. A disponibilidade, a latência e as condições da rede neste ambiente não são necessariamente iguais às da Vercel ou do Windows.
- O código atual cancela cada chamada Gemini após 14 segundos. Isso é compatível com as falhas observadas e com o fato de uma chamada direta ter demorado mais de 30 segundos, mas não demonstra de forma conclusiva a causa de cada timeout na Vercel. A função Vercel tem limite configurado de 60 segundos; alterar o timeout sem considerar a cascata de modelos e os provedores de fallback pode ultrapassar esse limite.

## Limites e pendências

A falha de resposta da IA no site continua sem correção comprovada. Não houve alteração de código, deploy ou publicação GitHub nesta rodada. Não se validou resposta automática real entre chips: o anti-loop continua ativo, e a habilitação global poderia afetar terceiros. Nenhuma mensagem WhatsApp adicional foi enviada. Não foi possível concluir se a IA responderia normalmente no motor Windows, pois o teste de geração direto foi feito em outro ambiente.

Por segurança, recomenda-se que Jefferson altere a senha compartilhada na conversa e utilize uma senha exclusiva.
