# Ienvia — testes com Playwright

Referência: 28/10/2026. Site e motor na versão 5.8.21 no início dos testes. Os testes de interação com dados foram executados em cópia isolada, com contatos, arquivo OGG/Opus, imagem e chave PIX fictícios; nenhuma conexão concorrente com WhatsApp foi aberta.

## Resultado

- **Produção, somente leitura:** Chromium abriu a vitrine e a tela de login nas larguras 320, 375, 768 e 1440 px. Logo carregado, acesso ao painel, ausência de overflow horizontal na vitrine e ausência de erros JavaScript não tratados nos cenários observados. Sem login ou alteração de dados de produção.
- **Playwright em laboratório:** quatro arquivos de testes passaram: vitrine/login, tratamento de sessão e perfil, bloqueio de origem cruzada e painel com fluxos sintéticos.
- **Painel simulado:** navegação em 320, 375, 768 e 1440 px, filtros por chip e busca, quatro visões do CRM, leitura de conversa, envio simulado de texto por cada um dos chips 1 e 2, nota interna sem envio, imagem simulada no chip 2, visualização e reprodução de áudio OGG/Opus sintético, cadastro de áudio e envio simulado, prévia de QR Code PIX fictício e cadastro de catálogo com imagem.
- **Dados sintéticos:** criação de contato, backup JSON e restauração no laboratório, limpar e excluir uma conversa mantendo a do outro chip, paginação de mais de 200 fichas e tratamento seguro de HTML no nome de um contato.
- **Falha de comunicação simulada:** resposta HTTP 504 ao enviar; a interface orientou conferir a conversa, preservou o texto e o ensaio não registrou reenvio automático.
- **Suíte complementar:** 44/44 arquivos de teste passaram em cópia isolada, incluindo os quatro com Playwright. Os demais são testes de código/HTTP, não executados por um navegador.

## Limites

Os testes não cobrem todas as funcionalidades, todas as combinações de dados, todas as versões de navegadores ou todos os dispositivos. Apenas Chromium foi utilizado. Os envios do laboratório usaram motor simulado, embora as respostas sintéticas da API utilizem os mesmos campos que indicariam envio no funcionamento real. A tela autenticada de produção e envios reais de texto, imagem e áudio não foram repetidos nesta rodada. Não há conclusão de recuperação completa de histórico WhatsApp, segurança total, compatibilidade com Windows/Termux em qualquer cenário, nem de que o produto esteja 100% livre de falhas.

A exposição do bucket público/listável e a pendência de isolamento dos arquivos legados em backup de voz permanecem abertas. Consultar `08-alerta-midias-publicas.md` e `10-cache-de-midias.md`.

Teste novo versionado em `tests/painel-fluxos-playwright.test.mjs`, com `tests/fixtures/audio-sintetico.ogg`. Logs: `playwright-existentes.log`, `playwright-producao.log` e `testes-com-playwright-atuais.log`. O arquivo de áudio contém apenas um tom senoidal de teste, sem voz ou dados pessoais.
