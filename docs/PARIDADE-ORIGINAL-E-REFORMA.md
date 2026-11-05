# Paridade entre painel original e reforma

Atualizado em 04/11/2026. Pedido do titular: avançar pelas próximas abas e conferir sistematicamente o que existe no original e falta na reforma, evitando inconsistências e perdas de recursos.

## Situação e método

**Situação atual: Treinamento, Catálogo/PIX, Áudios, Simulador, Inteligência artificial, Segurança / Configurações e Contas / Administração implementados/testados localmente; implantação oficial permanece separada.** Campanhas continua desligada operacionalmente. A descrição seguinte registra o histórico da sua implementação: O inventário inicial foi concluído antes da implementação e comparou o código local do painel original, sem abrir sessão real ou operar contas. Atualização posterior: a primeira implementação local de interface/fluxos demonstrativos e leitura autenticada foi concluída; nesta continuação também foram implementados e testados rascunhos UUID persistentes com CAS/idempotência, remoção manual, catálogo paginado, Excel local e contratos de IA/mídia privada. O executor dedicado UUID, controles persistentes e ciclo completo local também foram implementados e testados (34 testes novos; suíte geral 588/590, com duas falhas históricas). A composição de worker/IA e os provedores foram exercitados sinteticamente, não instalados/ativados nos processos reais. Migração remota, opt-in e homologação operacional continuam bloqueados. Veja `CAMPANHAS-EXECUTOR-LOCAL.md` e `CAMPANHAS-INTERFACE.md` para a situação atual, testes e limites. Os registros de “inventário inicial” abaixo são históricos, não prova de migração integral.

Não tratar paridade visual como paridade funcional. Para cada recurso, acompanhar separadamente:

1. Encontrado no original, com referência de código.
2. Interface e fluxo demonstrativo implementados e testados.
3. Backend local, permissões e persistência implementados e testados.
4. Integração operacional homologada, somente após autorização específica.

Um botão visível, um exemplo em memória ou uma API antiga existente não satisfazem as quatro etapas. Uma alteração intencional por segurança ou por decisão do titular deve ter motivo registrado, e não desaparecer como se fosse esquecimento.

## Respostas do titular antes da implementação de Campanhas

Questionário realizado em 04/11/2026, após o titular pedir esclarecimentos antes de começar a implementar:

- Uso: disparo em massa para destinatários existentes ou novos, fornecidos em listas. Novo destinatário não equivale a autorização de contato; manter o aviso de consentimento original.
- Origem dos destinatários nesta etapa: listas coladas e arquivos, como no original. Não acrescentar seleção pelo CRM agora.
- As demais configurações devem ser verificadas no original e preservadas; não submeter novamente ao titular os ajustes já existentes ou as decisões técnicas delegadas.
- Resposta comum do destinatário não deve gerar pausa ou ação automática nova na campanha. A IA já conectada responde conforme o treinamento, quando habilitada. A campanha não habilita IA automaticamente nem cria um atendente paralelo.
- Não acrescentar programação nova de reconhecimento de pedido de saída, descadastro ou bloqueio automático. Preservar os controles manuais existentes, o aviso de consentimento e as proteções já existentes para contatos ignorados; não prometer opt-out automático.
- Permanecem as decisões anteriores: instâncias UUID/nome livre; permissões independentes de CRM/IA/campanhas; offline bloqueia e avisa; sem troca silenciosa de instância ou reenvio automático de tentativa incerta.

Estas respostas definem o escopo, não significam que a nova tela foi implementada ou que envios reais foram autorizados.

## Mapa das abas originais

Fontes: botões `data-tab` e seções `tab-*` em `public/painel.html`; navegação nova em `public/v2/assets/navigation.js`; escopo das entregas documentado nos arquivos indicados.

| Original | Destino na reforma | Situação a preservar no acompanhamento |
|---|---|---|
| Dashboard | Visão geral + Instâncias + Conexões / Motor | Telas já reformadas; diagnóstico, cadastro e operação são capacidades distintas. Migração operacional dos motores permanece pendente. |
| Conversas / CRM | Conversas, Contatos, Kanban e Coach dentro do CRM | Estrutura original restaurada. Muitos fluxos são demonstrativos; app autenticado continua de leitura. Backend de ficha local não significa formulários operacionais ligados. Ver `CRM-ORIGINAL-RESTAURADO.md` e `CRM-CONTATOS-BACKEND-LOCAL.md`. |
| Campanhas | Nova MPA local `/campanhas/` | Interface e fluxos em memória implementados; aplicação autenticada consulta o legado sem escrita. Excel, IA, mídia e execução UUID reais ainda pendentes. Publicação anterior permanece inalterada. Ver `CAMPANHAS-INTERFACE.md`. |
| Treinamento | Treinamento | 32 controles originais inventariados/preservados; nova página, estúdio M/S/H, regras/FAQ/docs, modelos, importação e prompt pelo motor original em memória, backup de rascunho e gerador. Testes e persistência local sintética concluídos; escrita oficial desligada, nuvem não homologada e backup integral de áudios continua no original. Ver `TREINAMENTO-LOCAL.md`. |
| Catálogo | Catálogo | Nova página local, CRUD/pausa, filtros, preço textual/campos futuros, galeria de até cinco imagens/PDFs/áudios, PIX e QR pelo original. Rascunho privado/CAS testado; escrita oficial desligada e binários legados ainda não migrados. Ver `CATALOGO-AUDIOS-LOCAL.md`. |
| Áudios | Áudios | Biblioteca/editor, arquivo/microfone, transcrição manual, contexto/IA/manual/M01, player privado e conversor original testados localmente. IA paga desligada, hardware/FFmpeg/outros formatos e binários legados não homologados. Ver `CATALOGO-AUDIOS-LOCAL.md`. |
| Simulador | Simulador | Implementado/testado localmente; motor original isolado, versões explícitas, Raio-X e ensino no mesmo rascunho de Treinamento. Gates oficiais desligados. Ver SIMULADOR-LOCAL.md. |
| Motor de IA | Inteligência artificial | Implementada/testada localmente: provedores/modelos/pool, rota original, controle rápido proposto e telemetria. Segredos não retornam; rascunho de teste cifrado. Gravação/cofre e teste pago bloqueados na composição. Ver INTELIGENCIA-ARTIFICIAL-LOCAL.md. |
| Segurança / Anti-Ban | Configurações | Implementada/testada localmente: cadência/presets, handoff, PIN proposto, horários/dias/fuso e ignorados manuais. Fila original visível sem comandos; Campanhas mantém listas/instâncias UUID. Gates de escrita/PIN desligados. Ver SEGURANCA-CONFIGURACOES-LOCAL.md. |
| Contas | Titular master e equipe explicitamente delegada | Carteira/ficha/kit/cota/suporte/vitrine/playbook preservados e ampliados com financeiro manual, flags por cliente, escopo, confirmações e auditoria. Usuário autorizou alteração administrativa de rascunhos, não acesso irrestrito da equipe nem operação real. Ver `CONTAS-ADMINISTRACAO-LOCAL.md`; gates fechados, sem provisão/cobrança/senha/exclusão reais. |

Histórico por instância é uma separação adicionada pela reforma, não substituto de todas as funcionalidades de Conversas ou Campanhas.

## Campanhas — inventário de paridade inicial

Referências: `public/painel.html:284–309`, `public/campanhas.js`, `src/campanhaApi.js` e rotas `/api/campaigns` em `src/server.js:726–842` na árvore de trabalho inspecionada. Números de linha são desta revisão; o manifesto local registra hashes.

**Situação comum a todas as linhas abaixo:** encontrado no código original; nova interface e nova integração ainda pendentes. Os testes citados são referência de regressão, não prova de que a reforma já os implementa.

| Recurso que não pode se perder | Evidência original / cuidado de migração |
|---|---|
| Lista, seleção e detalhes; rascunho, ativa, pausada e concluída | `atualizar`, `listarRender`, `detalhe`, mapa `tipos`. Erro não pode virar lista vazia ou zero. |
| Criar rascunho, editar e preservar destinatários existentes | `resetEditor`, `abrir`, `editar`, submit de `campFormulario`. Salvar não pode iniciar automaticamente. Alterações não desfazem etapas já iniciadas. |
| Lista colada, CSV, XLSX e TXT; separador CSV explícito | `campImportar`, `/import-preview`, `campanhaImportacao.js`, `campanhaXlsx.js`. Original limita arquivo de lista a 4 MB. |
| Conferência, amostra, inválidos/duplicados e invalidação da prévia ao editar | `campImportarStatus`, `campAmostra`, listeners de números/arquivo/separador. Não reutilizar uma conferência antiga para outra lista. |
| Personalização `{{nome}}`, `{{telefone}}` e campos adicionais | Importação e `validarCamposDaLista`. Campo ausente deve bloquear, não gerar mensagem incompleta ou vazar dados. |
| Sequência ordenada de blocos de texto, imagem e áudio | `novoBloco`, `blocosRender`, `blocoParaPlano`; subir/descer/excluir. Ordem deve funcionar também sem arrastar e no celular. |
| Texto fixo, spintax e rodízio de textos completos | `blocosRender`, `campanhaPlano.js`, `campanhaVariacoes.js`. Não interpretar chaves de texto fixo como spintax. |
| Variações com IA, prompt próprio, revisão e fallback explícito ao original | `/ai-variations`; original aceita 1–20 variações. Alterar o texto/prompt invalida geração; falha não deve fingir sucesso. Demo não chama IA real. |
| Pastas separadas de imagens e áudios | `pastas`, criação, `arquivosDaPasta`. Gestão não pode se resumir a um seletor vazio. |
| Upload de vários arquivos, finalização, listagem paginada e exclusão | `/upload-init`, `/upload-finalize`, `/files`, `/delete`; aviso de interrupção preserva arquivos concluídos. Respeitar armazenamento privado, autorização e confirmação. |
| Escolha sequencial ou aleatória de textos/mídias | Seletores por bloco e `campanhaSelecao.js`. Não confundir escolha do conteúdo com escolha da instância. |
| Áudio como nota de voz ou arquivo anexo | `notaVoz` no plano e opção de formato na interface. Não retirar a distinção na reforma. |
| Saída fixa ou rodízio e comportamento após queda | `campModoChips`, `campRetomada`, `campChips`. **Adaptar ao modelo UUID/nome livre; não copiar a restrição antiga de três slots.** Offline bloqueia e avisa, sem troca silenciosa ou reenvio incerto. |
| Intervalos por pessoa, lotes, pausas entre lotes e entre blocos | Campos do formulário e `opcoesValidas`. Validar mínimo/máximo, unidades e limites; não converter segundos incorretamente. |
| Início futuro, dias, janela de horário e fuso | `campInicioEm`, `campDias`, `campInicio`, `campFim`, `campFuso`, `campanhaHorarios.js`. Não usar o fuso do navegador como se fosse o da campanha. |
| Iniciar, pausar, retomar e pular pausa quando permitido | `controlar`, `/control`. Preservar confirmações e elegibilidade por estado. Abrir a tela jamais inicia campanha. |
| Progresso, próxima ação estimada e causas de pausa | `detalhe`, `contador`; indisponível, provedor ambíguo, pessoa restrita, campos e preparação. Estimativa não é garantia de execução. |
| Conferência de envio incerto ligada à tentativa correta | `/resolve`, `tentativaId`, decisões confirmada/não enviada. Não reenviar automaticamente nem permitir resolver outra tentativa por resposta atrasada. |
| Destinatários paginados e remoção das próximas etapas | `destinatarios`, `/recipients`, `/remove`. Remoção não desfaz envio confirmado/iniciado. |
| Consentimento, ignorados, resposta à campanha e distinção aceite/entrega | Aviso original, `campanhaResposta.js`, proteções de destinatário e emissor. Não prometer prevenção de bloqueio; sequência concluída não comprova entrega/leitura. Não copiar promessa de opt-out automático inexistente. |

## Incompatibilidade prioritária já encontrada

O editor e o contrato originais usam `slot_1`, `slot_2`, `slot_3`, com autorização por `maxWaSlots` (`planoDaConta`). O modelo novo usa UUID e nome livre, sem esse teto de cadastro.

**Não basta trocar “Chip” por “Instância”.** É preciso preservar a origem dos registros antigos e resolver explicitamente a instância/conta/transporte autorizados. As APIs antigas não devem receber UUIDs que não compreendem, nem converter referência desconhecida em Chip 1. Campanhas novas não podem enviar por uma instância só porque ela aparece conectada no CRM. A opção independente de campanhas e a capacidade atual precisam ser verificadas no despacho. A ponte legada e seus limites constam em `PONTE-CANAIS-LEGADOS.md`.

A interface original oferece retomada automática quando segura. A migração deve confrontar essa opção com a decisão vigente de bloquear offline e com as reservas/tentativas incertas; preservar segurança e clareza é obrigatório, não copiar um seletor sem o contrato por trás.

## Sequência de implementação proposta

1. Campanhas: contratos/adaptadores isolados, leitura/lista/detalhe, rascunho/editor, destinatários, agenda, mídia e controles, com testes de paridade e estados de falha.
2. Treinamento.
3. Catálogo e Áudios, preservando a relação com composição e campanhas.
4. Simulador.
5. Inteligência artificial.
6. Segurança/Configurações.
7. Contas, com restrição master.

Pendências reais de CRM, motores e PWA continuam em acompanhamento transversal; avançar uma aba não as marca como concluídas. A sequência é técnica, não promessa de que todas as abas já foram inspecionadas em profundidade.

## Validação desta rodada e limites

Seleção de regressão existente de Campanhas: **36/36 aprovados**, cobrindo plano, estados, revisão, importação, horários, API, detalhes, variações, proteção de destinatário, sessão segura, reserva e recuperação. Log local: `/home/user/auditoria/arquitetura-v2/campanhas-paridade-baseline.log`.

Esta rodada produziu inventário e referência de regressão. Não foi criada a nova tela de Campanhas, não foi executada a suíte inteira nem feita homologação operacional. Não houve consulta/alteração do banco remoto, sessão WhatsApp, envio, mudança nos motores, commit, push ou publicação.

Nas próximas entregas, cada linha deve ganhar referência de implementação e teste ou impedimento explícito. Não declarar “aba completa” somente porque o visual está pronto.

## Atualização de execução local — 04/11/2026

As linhas de paridade de agenda, cadência/lotes, sequência de blocos por pessoa, rodízio, pausa/retomada, remoção futura, edição pausada e conferência agora têm implementação em `src/campaigns/{executor,drivers,media,coordination,scheduler,worker,executionRouter}.js`, na migração `07000` e no cliente `campaigns-execution-client.js`. Casos correspondentes estão em `tests/campaigns-execution*.test.mjs`, incluindo fluxo nativo HTTP/SQL, sessão adquirida e Evolution sintéticos, reinício manual/automático e aceite tardio.

Os 49 controles de origem foram mantidos. Não houve nova regra automática de descadastro, reação a resposta comum ou seleção de destinatários pelo CRM. A edição da execução exige pausa e ausência de tentativa pendente; alterar etapa futura não repete a passada. Inicialização não cria conexão/socket.

A revisão estática continua sendo demonstração; homologação operacional é outra fronteira. Não foi aplicada migração externa nem instalado o coordenador nos processos vivos. Nenhuma alteração nos oito arquivos originais de Campanhas citados na evidência anterior.


## Treinamento — implementação local posterior (04/11/2026)

Identidade/solo, tom/instruções, trava/escudo, FAQ/conhecimento, estúdio M/S/H com campos futuros preservados, modelos públicos e importação confirmada agora têm implementação em `public/v2/assets/training-*` e `src/training/`. Prévia e compilação nativas reutilizam os motores originais com contexto descartável em memória. O rascunho por UUID tem revisão/CAS, último pedido conferido, gravação privada atômica e suporte somente leitura. A composição do servidor mantém escrita desligada e não possui ativação; origem cloud ausente não cai em dados globais.

Separar explicitamente: demo volátil e prévia estrutural; integração local sintética persistente e prévia/compilador originais; integração operacional ainda não instalada. Exportação nova conserva o rascunho e anexos importados, não copia os áudios em uso. Backup integral segue acessível no painel original até a etapa de mídia privada; MD/TXT na demo entra como instrução, enquanto a integração nativa compila M/S/H pelo motor existente. Essas duas fronteiras não devem ser anunciadas como migração integral concluída.

Validação: **41/41 novos**, **74/74 selecionados**, **629/631 geral** (duas falhas históricas). Revisão estática regenerada com **69 assets** e testes Chromium, sem sessão/API/WhatsApp. Nenhuma operação remota. Detalhes, matriz de capacidades e limites em `TREINAMENTO-LOCAL.md`. Próxima etapa da sequência: Catálogo/Áudios, não implantação oficial.


## Catálogo/PIX e Áudios — implementação local posterior (04/11/2026)

Páginas separadas `/catalogo/` e `/audios/`, contrato/documento compartilhado para não perder alterações entre abas, repositório privado CAS e sessão/PIN/suporte existentes. Origem indisponível não vira biblioteca vazia. PIX/QR e conversão reaproveitam os módulos originais; sem novo motor financeiro ou de voz. A transcrição por IA permanece bloqueada por padrão, com porta sintética testada.

Anexos novos ficam no documento privado por UUID e podem ser exportados/reimportados com os metadados. Referências de mídias antigas são preservadas, mas o acesso binário não é contornado pelo diretório global ou por URL arbitrária. Backup integral original/migração dos arquivos antigos continuam pendentes da origem proprietária oficial, inclusive para o Treinamento. Nenhum envio/cobrança é implementado pela tela.

Validação: **26/26 novos**, **82/82 selecionados**, **655/657 completa** (duas falhas históricas), **78 assets** estáticos. Casos nativos e Chromium descritos em `CATALOGO-AUDIOS-LOCAL.md`. Sem operações remotas. Próxima aba: **Simulador**.


## Atualização — Simulador local

Inventário original, interface, runtime/HTTP/repositório e correção compartilhada concluídos localmente. **24/24 novos, 91/91 selecionados, 84 assets estáticos**. Limites de mídia/IA/demo/origem cloud e resultado geral em `SIMULADOR-LOCAL.md` e `simulator-evidence.json`. Sem ações reais ou alterações no negócio ativo; gates de sessões/ensino false. Próxima aba **Inteligência artificial**.


## Atualização — Inteligência artificial local

Provedores/modelos/pool, rota original, pausa proposta/fallback, métricas, proteção de credenciais e rascunho local implementados. Export não inclui chaves. **19/19 novos, 133/133 selecionados, 698/700 geral** (duas falhas históricas), **89 assets** estáticos. Gates de gravação/cofre false, teste pago bloqueado e sem gestão operacional de chave de cofre ou ativação; ver `INTELIGENCIA-ARTIFICIAL-LOCAL.md`. Próxima **Segurança / Configurações**, depois Contas master.

## Atualização — Segurança / Configurações local

Todos os controles originais preservados, com limites explícitos de PIN/fila/alerta e sem nova automação de opt-out. **23/23 novos, 145/145 selecionados, 721/723 geral** (mesmas duas falhas históricas), **94 assets**. Ver `SEGURANCA-CONFIGURACOES-LOCAL.md`. Gates de escrita/PIN false; sem alteração na autenticação, CRM ou regras ativas. Próxima aba **Contas master**.

## Contas / Administração — implementação local concluída em 04/11/2026

As três decisões de negócio foram confirmadas: master consulta e altera com auditoria/confirmação; financeiro manual, sem automação; equipe com permissões e escopo limitados. Carteira, filtros originais, notas, kit, senha solicitada, status e exclusão solicitada foram preservados, além de vitrine/link/preços e playbook comercial revisto. Novos controles: financeiro estruturado, recursos por cliente, delegação e trilha de alterações. Alteração administrativa usa os mesmos rascunhos nativos de Treinamento, Recursos, IA e Segurança, com intenção auditada antes da escrita, CAS e incerteza sem repetição automática. CRM, campanhas/execução, conexão e histórico permanecem nas áreas nativas, sem execução por este módulo.

**37/37 novos, 181/181 selecionados, 758/760 completa** (só duas falhas históricas), **100 assets**. Backend real mantém `allowWrites:false`, `allowWorkspaceWrites:false`, sem fonte global/porta de workspaces ou root de equipe configurados. Cadastro/bloqueio/recursos são planejamento; reset/exclusão são solicitações, não efeitos reais. Não ligar gates antigos nem afrouxar suporte legado. Documento detalhado: `CONTAS-ADMINISTRACAO-LOCAL.md`; evidência `accounts-evidence.json`, captura `contas-1440.png`, preview seguro4182. Todas as abas da sequência foram construídas localmente; implantação oficial ainda depende de etapa própria autorizada.
