# Atualizações assinadas do Ienvia

A partir da versão 5.8.16, o motor instalado valida um manifesto Ed25519 e os hashes dos arquivos antes de aplicar atualizações. Os arquivos anteriores que serão substituídos são preservados em uma transação local. Se a escrita falhar ou o processo for interrompido, o motor tenta recuperar os arquivos anteriores na próxima inicialização, antes de conectar o WhatsApp. Sessões e dados ficam fora da atualização.

## Preparar uma nova versão

1. Faça e teste todas as alterações, inclusive `package.json` e `package-lock.json` com a mesma versão sem sufixo (`X.Y.Z`).
2. Em uma cópia confiável que tenha a chave privada, execute `node scripts/assinar-versao.mjs`. Para chave em outro local, informe o caminho na variável de ambiente `IENVIA_CHAVE_ASSINATURA`, sem exibir o conteúdo.
3. O processo grava `release/update-manifest.json`, `release/update-manifest.sig` e o pacote pronto `release/motor-update.zip`. Adicione os três arquivos ao commit junto com as alterações. Qualquer mudança posterior em arquivo distribuído exige assinar novamente.
4. O servidor distribui o ZIP pronto e valida sua assinatura antes de servir; assim, alterações nos arquivos durante o build da Vercel não modificam o pacote assinado. Teste o ZIP e a assinatura em um checkout limpo. Depois de publicar, verifique a versão, a assinatura do ZIP e a atualização em instalação isolada antes de supor sucesso nos aparelhos.

## Proteção e recuperação da chave

A chave privada fica fora do Git em `.agents/ienvia-assinatura/chave-privada.pem`, com acesso restrito ao proprietário na cópia onde foi criada. Não a inclua em ZIP, logs, chat, repositório, backups públicos ou servidores. Permissões de arquivo e o workspace não garantem segurança absoluta. O proprietário deve manter um backup privado, cifrado e protegido, sob seu controle, e testar sua recuperação. A perda da chave impede assinar novas versões para instalações que confiam na chave pública atual; a exposição permite falsificar pacotes e exige plano de rotação e resposta ao incidente.

A chave pública está em `src/updatePublicKey.js`. Trocar a chave pública sem uma transição assinada pela chave antiga quebra atualizações de instalações existentes.

## Limites importantes

- A proteção por assinatura e a recuperação transacional valem **após** a instalação do novo atualizador. A primeira atualização de clientes antigos ainda é processada pelo atualizador anterior.
- O CRC detecta corrupção, mas somente a assinatura autenticada protege contra adulteração. Não desative a verificação nem aceite ZIP sem assinatura para contornar falhas.
- Recuperação cobre os arquivos do pacote, não substitui backup de banco, sessões ou mídias; não garante recuperação em todo tipo de falha de disco ou energia. Instalação de dependências e mudanças externas não estão incluídas na transação de arquivos.
- O estado exibido no painel depende do último heartbeat do motor; um pedido de atualização não confirma que ela terminou.
- Windows e Termux precisam de testes reais específicos antes de afirmar compatibilidade total. Uma restauração impossível deve impedir a inicialização do motor e ser investigada, sem apagar o diretório de recuperação.
