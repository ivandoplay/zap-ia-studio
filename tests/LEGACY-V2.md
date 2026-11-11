# Testes históricos do painel v2

O painel v2 foi congelado e suas páginas/módulos ativos foram removidos por decisão de produto registrada em `src/server.js`. Alguns testes antigos ainda dependem de contratos que já não existem no produto atual (por exemplo, `accounts-store.js`, `ai-settings-store.js`, `crm-quick-library-client.js` e páginas `*-app.js`).

Esses testes foram preservados no diretório `tests/`, mas deixaram de integrar a suíte padrão para que a homologação do painel ativo não seja bloqueada por contratos de uma arquitetura retirada.

Para executar os testes históricos deliberadamente:

```bash
ZAPIA_RUN_LEGACY_V2_TESTS=1 npm test
```

Antes de reativar qualquer um deles, restaure a implementação e os contratos correspondentes. Não apague os testes nem trate a suíte histórica como aprovada enquanto o v2 permanecer congelado.
