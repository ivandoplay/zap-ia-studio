# CRM — estrutura original restaurada na revisão isolada

Data: 04/11/2026. Direção corrigida pelo titular: copiar a organização do painel original em uso e lapidá-la, sem substituir por um aplicativo novo.

## Referência e limites

Referências inspecionadas: `public/painel.html` (menu e CRM/Contatos/Kanban/Coach), `public/styles.css` e handlers CRM de `public/app.js`. O monólito não foi importado nem executado com sessão na demonstrativa. A moldura retoma as seções Operação/Atendente/Ajustes, menu com nomes, quatro visões, caixa/chat/Ficha 360, ferramentas, filtros e composição WhatsApp/nota interna. Tema escuro Slate/Obsidian e tema claro; menu móvel modal e chat/ficha dedicados.

**Não é port operacional completo do CRM.** Há fluxos demonstrativos em memória e opções deliberadamente bloqueadas até suas integrações serem portadas. Exibir uma opção não comprova sua implementação no backend. O adaptador autenticado existente continua somente leitura: nenhuma chamada nova de escrita operacional foi adicionada. Não foram alterados SQL remoto, implantação principal, Evolution, Baileys nem campanhas.

## Inventário e situação

| Recurso original | Situação nesta revisão |
|---|---|
| Menu Operação/Atendente/Ajustes, nomes e grupos familiares | Restaurado no CRM. Páginas ainda não reformadas têm destino explícito “em preparo” na demonstrativa. |
| Conversas / Contatos / Kanban / Coach IA | Restaurados; não se trata mais de uma lista isolada de mensagens. |
| Caixa / chat / Ficha 360 | Três colunas no desktop largo; ficha lateral/modal em telas menores; chat e ficha dedicados no celular. |
| Busca, Ativas, Não lidas, Com você, Quentes, Retorno S19, Arquivadas, Com IA | Filtros locais da demonstrativa. Escopo por instância e visibilidade preservado. |
| Filtros avançados por etapa, etiqueta e negócio | Funcionais nos dados demonstrativos. |
| Ações em massa: lidas, não lidas, etapa, etiqueta, IA, salvar, arquivar, limpar e apagar | Memória demonstrativa, seleção acessível e limpa na troca de escopo. Exclusões pedem confirmação e preservam cadastro. |
| Agenda: busca, salvos/não salvos/bloqueados, cadastro/edição sem mensagem | Memória demonstrativa. Cadastro manual permanece identidade não verificada e não liga automações. Agenda do aparelho/conectada é pendente. |
| Cinco etapas, valores em reais, cartões e mover no Kanban | Memória demonstrativa; mover por botão e arrastar. Sem regressão para três slots. |
| Coach / Raio-X do funil | Fluxo inicial e botão de análise restaurados. Diagnóstico é explicitamente fictício, sem chamar modelo de IA. |
| Ficha: etapa, negociação/ganho/perda/motivo, empresa/cidade/e-mail/origem | Memória demonstrativa, validação estrita dos campos. |
| Tags, atribuição, nota do cadastro e contexto | Demonstração local. Contexto é exemplo pré-definido, não resumo gerado por IA. |
| Checklist de tarefas e S19 (+1 hora, amanhã, data e limpar) | Memória demonstrativa. Nenhum executor de retorno ativado. |
| Agendamento e cancelamento | Somente rascunhos explícitos; instância online do mesmo negócio obrigatória. Nenhum timer, fila ou execução. |
| Pausa IA 30 min / 1h / 4h / manual e retomar | Estado demonstrativo. Não muda worker/IA reais. |
| WhatsApp / Nota interna, rascunhos separados | Funcionais localmente. Nota não tem origem, dispatch nem ACK WhatsApp; não pode ser citada/encaminhada como mensagem externa. |
| Respostas rápidas e atalho /, emoji, sugestões IA | Exemplos locais; sugestões são pré-definidas. Gestão da biblioteca e IA real são pendentes. |
| Voz, áudio estratégico, catálogo, PIX, cartão de contato, anexos e print | Opções preservadas. Bandeja prepara item fictício; foto/documento são exemplos. Voz, biblioteca real, captura/clipboard/print, PIX/QR real, mídia e cartão nativo dependem de integração. Nenhum acesso ao microfone/arquivos/clipboard é iniciado. |
| Mensagens: responder, reagir, favoritar, encaminhar, editar, apagar e origens | Memória demonstrativa, com restrições por tipo e instância de saída explícita. Edição segura/literal; sem prometer todas as formatações avançadas do legado. |
| Conversa: copiar número, salvar/editar, VCF, cartão, TXT, não lida, pin/archive, ignorar IA, bloquear, limpar/apagar e ficha expandida | Menus restaurados. Copiar apresenta campo selecionável; bloqueio é apenas marca fictícia. Nenhuma operação WhatsApp real. |
| Exportar CSV / VCF / TXT e backup JSON | Prévia e download local somente após clique explícito. CSV neutraliza fórmulas; VCF individual exporta só o contato escolhido; TXT identifica notas internas; backup é marcado simulado e não é compatibilidade operacional de restauração. |
| Importar CSV / restaurar backup / sincronizar WhatsApp / carregar exemplos externos | Opções visíveis com bloqueio e explicação; nenhuma importação, restauração ou sincronização real. |
| CRM oculto, origens, UUID e múltiplas instâncias com nome livre | Invariantes anteriores preservadas. Ocultar não apaga dados nem desliga ingresso. Offline bloqueia sem fila/troca silenciosa. |
| Suporte e conta autenticada | Sem escrita. Não há fallback automático ao monólito. Casos sem projeção mostram integração pendente, sem valores/nomes inventados. |

## Código e isolamento

- `conversations-hub.js`: organização original e fluxos de interface, atrás de portas locais explícitas.
- `conversations-crm-contract.js`: cinco etapas e contrato estrito das mutações fictícias.
- `conversations-restored.css`: acabamento responsivo sobre a base anterior.
- Adaptador demonstrativo: memória e dados sintéticos; validações de papel/escopo/instância.
- Build da demonstrativa: **50 assets**, sem `conversations-app.js`, cliente de sessão, monólito ou endpoints; CSP `connect-src 'none'`.
- Nenhum corpo de mensagem, rascunho ou nota nova é persistido em storage do navegador. A preferência de tema mantém seu comportamento anterior.

## Validação executada

- TDD: três novos testes inicialmente vermelhos por `updateMessage` ausente; implementação validada em seguida.
- Regressão de privacidade: citação de nota interna foi primeiro demonstrada como falha e passou a ser rejeitada também pelo adaptador.
- **73/73** na seleção final: Conversas/modelo/restauração/races/autenticado, revisão estática e regressões de Dashboard/Histórico/Conexões.
- **486/488** na suíte geral; as duas falhas preexistentes continuam em `ienvia-branding.test.mjs` e `static-release-package.test.mjs` (release assinado), não mascaradas.
- Chromium: desktop, 320/390/768/1024/1440, temas, foco, contraste automatizado, overflow, leitura/suporte, troca de conta/instância e ACK tardio.
- Fluxos novos: quatro visões, cadastro sem envio, negociação/tarefas/S19/agendamento, nota privada, mensagens, exportação e seleção em massa. Sem fetch/WebSocket/API reais nos testes da demonstrativa.
- `node review-site/verify-static.mjs`: 50 assets íntegros e fontes sincronizadas.
- `git diff --check`: limpo.

Logs e capturas: `/home/user/auditoria/arquitetura-v2/crm-restoration-*` e `crm-restaurado/`. Erros intermediários foram corrigidos antes da seleção final; não são evidência de validação bem-sucedida.

## Publicação

A publicação autorizada se restringe à branch `review/reforma-visual` e ao projeto estático separado `ienvia-reforma-visual`. O registro externo de publicação deve conter SHA/deployment e hashes remotos após sua confirmação. Não confundir esta revisão de interface com migração ou ativação do CRM operacional.
