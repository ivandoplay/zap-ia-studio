# Backup privado do workspace — 29/10/2026

A pasta `workspace-completo/` reproduz os arquivos persistentes do workspace `/home/user`, incluindo o projeto, as skills, os dados locais e os demais arquivos encontrados na ocasião do backup. O projeto original também permanece na raiz da branch.

**Este backup contém informações confidenciais, inclusive chaves, sessões, dados pessoais e fotos. Não torne este repositório ou esta branch públicos.**

Os diretórios de cache, dependências instaladas e artefatos temporários não persistentes, assim como a pasta técnica `.git` e credenciais Git, foram excluídos. O arquivo `MANIFESTO-BACKUP.json` relaciona os arquivos incluídos e seus hashes SHA-256. O estado foi capturado na data acima; alterações posteriores não são refletidas automaticamente.

A branch principal continua sendo a referência de produção. Este backup é uma cópia pontual, não uma sincronização automática com o GitHub.

Para restaurar os arquivos com os bytes exatos da captura, baixe e extraia `BACKUP-WORKSPACE-COMPLETO.zip`: cada entrada foi validada contra o manifesto. A pasta navegável é uma conveniência; atributos Git podem alterar fins de linha de alguns arquivos durante checkout.
