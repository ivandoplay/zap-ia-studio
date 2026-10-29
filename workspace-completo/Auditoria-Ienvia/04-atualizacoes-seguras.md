# Ienvia — proteção das atualizações, versão 5.8.16

## Implementação

1. **Recuperação de arquivos:** antes de substituir os arquivos de uma atualização, o motor prepara uma cópia dos anteriores. Falhas durante a troca acionam tentativa de retorno; caso o processo seja interrompido, a próxima inicialização tenta recuperar a instalação antes de conectar o WhatsApp. O procedimento não altera `data`, sessões, mídias ou bibliotecas instaladas.
2. **Origem:** pacote com manifesto de hashes e assinatura Ed25519. O novo atualizador usa uma chave pública fixa para verificar a assinatura, a versão e todos os arquivos antes de gravá-los. Arquivos ausentes, extras, alterados, duplicados, sem assinatura ou de versão incompatível são rejeitados. Uma atualização para versão anterior é ignorada.
3. **Painel:** mostra as versões do site e do motor, indica motor offline ou versão desconhecida e não anuncia uma atualização concluída apenas porque o pedido foi aceito. Em múltiplos aparelhos, lista as versões online disponíveis.

## Verificações

- Testes com pacotes sintéticos: assinatura válida, arquivo adulterado mesmo com ZIP válido, assinatura inválida, arquivo faltando, arquivo repetido, versão diferente e pacote corrompido.
- Falha simulada durante troca e encerramento de processo após uma gravação: restauração dos arquivos anteriores e preservação de banco e sessão sintéticos. Também testado bloqueio de links simbólicos.
- Atualizador v5.8.12 instala o ZIP atual preservando dados sintéticos; atualizador v5.8.15 instala v5.8.16 e o novo atualizador aceita uma versão 5.8.17 assinada simulada.
- Verificação de pacote assinado em checkout limpo, incluindo diferenças CRLF/LF; teste em navegador 320, 375, 768 e 1440 px, com status sintético; 24 arquivos de testes Node em cópia isolada passaram.
- O ZIP assinado é gerado antes do deploy e verificado pelo servidor antes de ser servido. O arquivo público em produção foi comparado byte a byte com o artefato local testado; a assinatura foi verificada novamente com a chave pública.
- Nenhum socket WhatsApp real foi aberto nem mensagem real foi enviada durante essas verificações. Testes reais de falha elétrica e instalações Windows/Termux não foram executados.

## Limites e cuidados

A versão antiga ainda não possui a verificação nova. Assim, a **primeira instalação da v5.8.16 é feita pelo atualizador anterior**; a checagem de assinatura e a recuperação novas passam a proteger as atualizações seguintes, depois que a v5.8.16 estiver instalada.

A recuperação se aplica aos arquivos do pacote, não substitui backup de dados e não cobre alterações de dependências ou falhas físicas irrecuperáveis de disco. Não existe garantia absoluta contra todo cenário de energia, hardware ou sistema de arquivos.

A chave privada de assinatura foi criada em pasta local ignorada pelo Git, com permissões restritas. Ela não está no ZIP nem no repositório. O workspace e suas permissões não garantem segurança absoluta ou persistência: **o proprietário deve manter backup privado e cifrado da chave**. Sem a chave, novas versões não podem ser assinadas para clientes já instalados; se ela for exposta, assinaturas podem ser falsificadas e uma rotação planejada será necessária. Não compartilhar a chave no chat. O processo está documentado em `docs/ATUALIZACOES-ASSINADAS.md`.

## Publicação e ocorrência

As duas primeiras tentativas de publicação apresentaram erro HTTP 500 no ZIP público, por divergências entre os arquivos locais e o ambiente de build da Vercel. Em cada tentativa a versão anterior foi restaurada. A solução final usa um ZIP imutável montado e assinado antes do deploy; alterações do ambiente de build não mudam seus bytes. O commit final `a6b4be2` foi publicado e o deploy `dpl_H5zV79PeCEdFEfpwikTsp1ZPL3TX` ficou READY/PROMOTED. O endpoint público forneceu o ZIP e a assinatura foi verificada. Durante os intervalos de erro, pedidos de download/update não podiam concluir; não se verificou impacto em outros recursos.

O último heartbeat consultado durante o trabalho indicou o motor Windows na versão 5.8.15 com slots 1 e 2 ativos; não foi enviado comando de reinício e não foi comprovada a instalação da v5.8.16 no aparelho real. O dono pode atualizar/reiniciar no momento adequado e conferir o painel.
