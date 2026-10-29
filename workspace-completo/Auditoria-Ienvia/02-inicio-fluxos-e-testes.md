# Ienvia — início da revisão de fluxos e testes

Referência: 28/10/2026, versão 5.8.14, commit `0e23bd4`. Esta é uma revisão inicial, não a auditoria completa.

## Acordo de trabalho

- Problemas confirmados: investigar a causa, corrigir diretamente, acrescentar teste e verificar efeitos colaterais.
- Novas funcionalidades ou melhorias que mudem o produto: apresentar a Jefferson para decidir junto antes de implementar.
- Usar os dois chips autorizados quando houver necessidade de teste real, somente entre os números autorizados, sem socket concorrente. Diferenciar testes simulados, comandos do motor e testes manuais pela interface. Não repetir envio de resultado incerto sem conferir.
- Não desconectar o Chip 1, não apagar dados reais e não realizar operações financeiras ou configurar domínio sem autorização específica.

## Trabalho desta etapa

Foi consultada a skill `systematic-debugging`, em complemento às skills de arquitetura, revisão e verificação. Foi iniciado o rastreamento do fluxo de envio no servidor, no despacho de comandos ao motor e no acompanhamento de status pelo painel. A leitura foi parcial; não foi concluída uma avaliação de todas as condições ou fluxos de falha.

Comando de verificação com dados sintéticos e ambiente isolado de WhatsApp:

```sh
VERCEL=1 node --test tests/command-status.test.mjs tests/command-status-http.test.mjs tests/cloud-send-scope.test.mjs tests/pairing-safety.test.mjs tests/pairing-command-guard.test.mjs tests/history-journal.test.mjs tests/queued-send-notifications.test.mjs
```

**Resultado:** 7 arquivos de teste passaram; 0 falhas. As verificações cobriram os cenários sintéticos incluídos nesses testes: consulta de status, escopo por conta/conversa, precaução no pareamento, diário e acompanhamento de envio sem reenvio automático. Isso não prova que todas as condições reais foram testadas nem que o produto está livre de erros.

Não houve envio real, logout, desconexão ou alteração de produção nesta etapa. Nenhum problema confirmado foi corrigido nesta etapa. A verificação do pacote de treinamento rastreado, do fluxo completo de envio e dos controles de segurança permanece pendente.
