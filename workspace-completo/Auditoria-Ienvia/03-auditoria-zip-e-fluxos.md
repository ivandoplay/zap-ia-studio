# Ienvia — auditoria parcial: fluxos e integridade dos pacotes

Data: 28/10/2026. Versão de partida: 5.8.14. Correção: 5.8.15, commit `f759d69`, publicado no GitHub e na Vercel (`dpl_DDXPdUnPz9X2YVrkiRqus2aj6hzR`, READY/PROMOTED). A versão pública e a integridade/conteúdo do ZIP foram verificados. O motor Windows ainda reportava 5.8.11 na última consulta; não foi reiniciado nem foi confirmado que ele já recebeu a atualização.

## Problema confirmado e corrigido localmente

Os leitores de ZIP usados na importação de treinamento e na atualização automática aceitavam arquivos cujo conteúdo havia sido alterado sem corresponder ao CRC informado no ZIP. Com um pacote sintético armazenado sem compressão, um byte foi modificado: antes da correção, o leitor aceitou o arquivo; o teste inicial falhou conforme esperado. Em teste separado, o atualizador anterior aplicou um pacote com conteúdo corrompido e anunciou sucesso.

A correção faz o leitor verificar o tamanho e o CRC de cada arquivo e rejeitar diretório incompleto e métodos não suportados. O atualizador passa a usar esse leitor e valida todo o pacote antes de iniciar as gravações. Não se trata de autenticação criptográfica: CRC detecta corrupção acidental, mas um atacante pode recalculá-lo.

### Evidências

- `tests/zip-integrity.test.mjs`: entradas íntegras Store/Deflate; conteúdo alterado, tamanho incompatível, diretório incompleto e método não suportado.
- `tests/auto-update-integrity.test.mjs`: pacote corrompido rejeitado antes de alterar arquivos e dados sintéticos; pacote válido aplicado preservando banco sintético.
- `testar-atualizador-anterior.mjs` nesta pasta: atualizador da v5.8.12 instalou o ZIP atual da v5.8.15 em pasta temporária, preservando banco e sessão sintéticos. Esta verificação não demonstra proteção da versão antiga contra corrupção: a proteção passa a valer somente depois que o novo atualizador estiver instalado.
- Em cópia isolada sem sessões reais, **18 arquivos de testes Node passaram**, incluindo cenários de histórico, envio local com chips simulados, pareamento, comandos, ZIP e atualização. O teste Playwright da vitrine não foi executado nesta etapa por ausência do navegador/dependência no ambiente. Os testes não comprovam funcionamento real em Windows, Linux, Termux ou nos chips.
- `npm audit --omit=optional`: nenhum alerta de vulnerabilidade conhecida no resultado disponível, o que não prova ausência de vulnerabilidades.
- `git diff --check` e verificação sintática dos arquivos alterados passaram.

## Atenção ainda não resolvida

- Os instaladores Windows e Linux aceitam Node.js com versão principal >= 20, sem verificar os níveis recentes de correção de segurança. O ambiente desta auditoria utiliza Node 20.20.2, que está fora de suporte. Um diagnóstico anterior do motor indicava Node 24.14.0; a versão atual do aparelho não foi novamente verificada aqui. Não se conclui que ocorreu exploração.
- O projeto Node anunciou correções de segurança para as linhas suportadas em 21/10/2026: https://nodejs.org/en/blog/vulnerability/october-2026-security-releases. As versões portáteis previstas nos instaladores são mais recentes, mas o programa também pode reutilizar Node antigo já instalado. Uma correção segura deve preservar a instalação em Windows, Linux e Termux e ser testada antes de aplicação; ainda não foi implementada nesta etapa.
- O teste automatizado da skill de Node sinalizou `src/pix.js` como possível Brotli, mas o trecho apontado usa `brcode` como nome de código PIX; essa sinalização isolada não comprova uso de Brotli vulnerável. Outras rotas e dependências ainda não foram auditadas completamente.
- A análise inicial identificou permissão de origem ampla em `src/server.js` para subdomínios `.vercel.app` e `.e2b.app`; a exploração e a correção compatível com acesso local/preview não foram validadas. Trata-se de hipótese de risco, não de invasão comprovada.
- O pacote de treinamento rastreado pelo Git requer revisão de privacidade, sem exposição desnecessária do conteúdo.

## Escopo e publicação

A leitura de arquitetura e fluxos continua parcial. A auditoria completa de todos os arquivos, o teste de RLS entre contas reais e a recuperação histórica real seguem pendentes. Não houve envio real entre chips, logout ou alteração de produção nesta etapa.

O acesso ao GitHub foi restabelecido e o commit foi enviado à branch main. O deploy da Vercel foi promovido, e o site e o ZIP retornaram a versão 5.8.15. Motores locais precisam receber a atualização separadamente; não se deve assumir que todos já a aplicaram. Nenhuma credencial deve ser publicada em documentação ou código.
