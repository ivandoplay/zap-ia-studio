# Skills adicionais para revisar a Visão geral

**Pesquisa e seleção: 03/11/2026.** Complemento às sete referências iniciais. Foco em backend, contratos, segurança e testes — não em redesenhar a interface.

## Resultado

Foram selecionadas **seis referências novas**, disponíveis localmente em `.agents/skills/`. Os seis `SKILL.md` foram lidos, além das seções de apoio pertinentes. Outros documentos de apoio foram preservados para consulta sob demanda; isso não equivale a uma auditoria completa das coleções.

Não foram instalados marketplaces, plugins, hooks, subagentes, bibliotecas ou ferramentas externas. Não houve mudança de stack, banco, aplicativo em produção ou transporte WhatsApp. Nenhum script das coleções foi baixado/executado. As referências não são carregadas automaticamente por qualquer agente.

## Seleção e aplicação concreta

| Referência | Como ajuda nesta aba | Critério verificável para a próxima correção |
|---|---|---|
| **error-handling-patterns** | Evitar exceções absorvidas e sucesso aparente quando a consulta Evolution falha | Falha de leitura resulta em estado indisponível/desatualizado, com origem/horário, não em confirmação nova de conexão |
| **api-design-principles** | Desenhar um resumo autenticado pequeno, validar entradas e padronizar erros | A rota de resumo não retorna listas completas, chaves ou settings; 401/403/503 distintos; limites e tipos validados |
| **projection-patterns** | Separar o modelo de leitura dos dados pesados usados para executar o atendimento | Contagens agregadas por conta/chip e série diária com definição clara; duplicatas/replay não aumentam totais indevidamente |
| **property-based-testing** | Testar regras em combinações de estados, duplicatas e mensagens fora de ordem | ACK não regride; identidades não se misturam; dados inválidos não geram “pronto”; contadores não duplicam no replay |
| **sharp-edges** | Detectar APIs/configurações fáceis de usar de forma errada, inclusive tipos booleanos e identidade em suporte | `"false"`, `"0"`, ausência e null não ligam/desligam o bot silenciosamente; identidade do operador e cliente acessado não se confundem |
| **differential-review** | Revisar o impacto de uma correção no legado e em seus chamadores | Comparação com a versão anterior, preservação de controles e teste dos caminhos local/cloud; revisão focada, sem alegar cobertura de todo o produto |

Esses critérios são um plano de aplicação, **não funcionalidades já integradas**. A investigação já utilizou a lente de conversões perigosas de `sharp-edges` e confirmou um caso no handler antigo descrito abaixo.

## Origens, versões e licenças

### W. Shobson — `wshobson/agents`

Revisão fixada: `7e2fb559cf4b824b27f1fec49fe88f7511066d26`.

- [api-design-principles](https://github.com/wshobson/agents/blob/7e2fb559cf4b824b27f1fec49fe88f7511066d26/plugins/backend-development/skills/api-design-principles/SKILL.md)
- [error-handling-patterns](https://github.com/wshobson/agents/blob/7e2fb559cf4b824b27f1fec49fe88f7511066d26/plugins/developer-essentials/skills/error-handling-patterns/SKILL.md)
- [projection-patterns](https://github.com/wshobson/agents/blob/7e2fb559cf4b824b27f1fec49fe88f7511066d26/plugins/backend-development/skills/projection-patterns/SKILL.md)

Licença original preservada: **MIT**, copyright Seth Hobson.

### Trail of Bits — `trailofbits/skills`

Revisão fixada: `711af095215ad4ecde5b90cd1d0124b3f1c4ca9e`.

- [property-based-testing](https://github.com/trailofbits/skills/blob/711af095215ad4ecde5b90cd1d0124b3f1c4ca9e/plugins/property-based-testing/skills/property-based-testing/SKILL.md)
- [sharp-edges](https://github.com/trailofbits/skills/blob/711af095215ad4ecde5b90cd1d0124b3f1c4ca9e/plugins/sharp-edges/skills/sharp-edges/SKILL.md)
- [differential-review](https://github.com/trailofbits/skills/blob/711af095215ad4ecde5b90cd1d0124b3f1c4ca9e/plugins/differential-review/skills/differential-review/SKILL.md)

Licença original preservada: **CC BY-SA 4.0**. Os originais foram mantidos sem modificações, com autoria/origem e licença em `SOURCE-NOTICE.txt`/`SOURCE-LICENSE.txt`. As orientações locais ficam em arquivo separado `IENVIA-ADAPTACAO.md`.

## Limites e adaptações importantes

1. **Sem nova arquitetura obrigatória.** `projection-patterns` tem foco em event sourcing/CQRS. Aproveitar o conceito de resumo de leitura, começando pelo desenho mais simples compatível com o banco atual. Não introduzir fila, microserviço, Elasticsearch ou event store só porque aparecem nos exemplos.
2. **REST preservado.** A skill de API também cobre GraphQL. Isso não é recomendação de migrar a stack nem promessa de que GraphQL eliminaria sobrecarga automaticamente.
3. **Retry não autoriza reenvio.** Exemplos de recuperação/fallback não podem duplicar mensagens ou trocar o chip por conta própria. Leitura idempotente e envio com resultado incerto têm regras diferentes.
4. **Sem falsa disponibilidade.** Um fallback não pode transformar dado antigo, erro ou ausência de heartbeat em “conectado/pronto”. Se um snapshot for mostrado, indicar sua idade e origem.
5. **Exemplos não são código pronto.** O exemplo de projeção agregada usa incrementos; exige verificar deduplicação/checkpoint transacional para que replay não conte duas vezes. Não reconstruir estatísticas reais para experimentar.
6. **Não adicionar dependência de testes automaticamente.** `fast-check` é uma possibilidade, não foi instalado. Primeiro usar as ferramentas existentes em testes explícitos de invariantes; qualquer nova biblioteca será discutida com justificativa.
7. **Comparação exige baseline.** `differential-review` serve para correções do código existente; não apresentar uma comparação completa quando a área é nova ou o escopo lido é parcial.
8. **Segurança não se resume a nomes de skills.** Não descrever um defeito de disponibilidade ou coerção como invasão comprovada. Diferenciar evidência, condição e impacto.
9. **Credenciais e dados privados ficam fora das referências e provas.** Logs devem ser redigidos; não copiar exemplos que exponham chaves, tokens, conteúdo de mensagens ou perfis de clientes.

## Primeiro achado adicional, reproduzido sem acionar o bot

O handler antigo `POST /api/wa/toggle-bot`, em `src/server.js`, faz:

```js
const enabled = Boolean(req.body?.enabled);
```

Na reprodução do handler original com armazenamento sintético:

| Entrada | Resultado atual |
|---|---|
| `{ "enabled": false }` | Mantém desativado |
| `{ "enabled": "false" }` | **Ativa** |
| `{ "enabled": "0" }` | **Ativa** |
| `{}` | Grava desativado mesmo sem receber uma escolha válida |

O cliente atual normalmente envia booleano nativo, portanto isso **não demonstra ativação involuntária ocorrida na conta real nem bypass de autenticação**. Demonstra que o contrato aceita tipos indevidos e pode fazer o contrário da intenção de um cliente malformado.

Correção proposta: exigir booleano nativo e devolver 400 para tipo inválido/campo ausente **antes de qualquer gravação**. Cobrir ambos os modos e manter a autorização existente. **A correção não foi aplicada nesta pesquisa.**

Diagnóstico no workspace: `/home/user/auditoria/arquitetura-v2/diagnostico-booleano-bot.mjs` e `.json`. Executa somente o recorte do handler em VM, com storage falso; não importa o servidor, não abre portas, não acessa `.env` nem faz requisições. Nenhum bot real foi acionado.

## Ordem recomendada de uso

1. **Erros + testes de invariantes:** acertar composição de status e leitura desatualizada.
2. **API + defaults seguros:** validar os contratos de resumo/ações e identidade por conta/chip.
3. **Modelo de leitura + referências PostgreSQL já disponíveis:** reduzir a carga sem perder contagens.
4. **Revisão diferencial:** conferir regressões antes de integrar e publicar.

A pesquisa não corrige os problemas sozinha. Cada patch ainda precisa de reprodução, correção, regressão isolada e revisão da evidência.

## Rastreabilidade no workspace

- Manifesto separado: `/home/user/auditoria/arquitetura-v2/skills-backend-manifest.json`.
- Script próprio de obtenção: `/home/user/auditoria/arquitetura-v2/obter_skills_backend.py`.
- SHA-256 por referência e licença, revisão fixa, caminhos e escopo de leitura registrados no manifesto.
- Sete referências iniciais permanecem no manifesto anterior; agora há 13 pastas de skills selecionadas para a reforma. As pastas são locais e ignoradas no Git.
- Os 49/49 testes da prévia e 19/19 da regressão anterior não foram executados novamente nesta pesquisa; o código da aplicação não foi alterado. O diagnóstico adicional não deve ser somado como uma nova suíte E2E.
