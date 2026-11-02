# Plano de evolução do Ienvia — por área

## Objetivo
Deixar o sistema mais fácil para quem está chegando pela primeira vez, visualmente mais claro e mais leve conforme aumentam conversas e contatos. A navegação deve manter o shell (menu, cabeçalho e estado essencial) e carregar a tela/conteúdo/dados da área ativa sob demanda, em vez de montar e buscar tudo de uma vez. A execução será incremental, por área, com verificação funcional e de desempenho antes de passar à próxima.

## Decisão de escopo
Começar pela **Home do painel autenticado** (`public/painel.html`, `#tab-dashboard`, nome atual “Início & Conexão”), não pela página pública de apresentação. A Home é a primeira tela de uso e deve explicar o próximo passo sem competir com a operação avançada.

**Estratégia:** lapidar e reescrever os trechos confusos da Home, preservando os fluxos e regras que funcionam. Não reescrever o sistema inteiro nem trocar a stack às cegas.

## Diagnóstico inicial — leitura estática
- A Home mistura configuração inicial, conexão WhatsApp, monitoramento, estatísticas, download e comandos do motor, disparo ativo e registro ao vivo.
- O onboarding já existe, mas tem cinco etapas; “Treinamento”, “Catálogo/PIX”, “Áudios”, IA e pareamento aparecem como tarefas paralelas, enquanto a página também repete ações e instruções operacionais.
- A seção da Home tem cerca de 16 KB de HTML, 12 botões e 36 estilos inline. Isso não é uma medição de tempo de carregamento, mas mostra pontos de complexidade e manutenção.
- O painel entrega uma página HTML de cerca de 212 KB, `app.js` de cerca de 397 KB e CSS principal de cerca de 106 KB, antes de considerar compressão e rede. As abas estão presentes no mesmo documento; algumas rotinas só são iniciadas ao selecionar uma aba, mas isso precisa ser auditado por fluxo antes de alterar.
- O frontend atual é JavaScript/HTML/CSS sem React. Portanto, não será introduzida uma nova stack só para seguir skills que pressupõem React.

## Primeiro ciclo de implementação — progresso

- A Home não baixa mais `campanhas.js` nem o módulo de Supabase Realtime do CRM durante a abertura inicial. Cada arquivo é requisitado uma única vez ao abrir a área correspondente; o CRM encerra sua assinatura realtime quando a pessoa sai dele. Os dois recursos somam **236.159 bytes (≈230,6 KiB) sem compressão** adiados em relação ao HTML inicial.
- O polling mantém a atualização essencial, mas as renderizações de Home e CRM foram condicionadas à área ativa, evitando reconstruir essas visões a cada atualização enquanto estão inativas.
- O Playwright agora observa os pedidos desses módulos, testa sua carga sob demanda e saída do CRM em mobile e desktop, além de gerar massa sintética de **2.500 contatos**. Em Chromium headless a 1440 px, a renderização direta da agenda completa (2.503 registros sintéticos no fixture) mediu **202,7 ms** no último ensaio; é uma linha de base local, não uma meta universal nem uma medição de produção.
- A Home autenticada foi reorganizada para orientar quem está começando: título focado na tarefa; roteiro honesto de **4 etapas reais** (treinamento, chave de IA, simulador e conexão); ações opcionais separadas; próximo passo em destaque; lista completa recolhida em telas estreitas; status com texto e métrica/funil acessíveis em disclosure. A configuração da conta não conta artificialmente como progresso. Os controles de envio manual e instalação do motor continuam disponíveis em “Mais ferramentas”.
- Revisei o fluxo em screenshots de 320, 390, 768 e 1440 px e no tema claro. Os fluxos existentes mantiveram seus IDs; o link para conexão rola até o painel e move o foco para seu título.
- Verificação: suíte `tests/painel-fluxos-playwright.test.mjs` passou em 320, 375, 768 e 1440 px, incluindo progresso/onboarding, disclosure por teclado, foco da conexão, módulos sob demanda, mensagens simuladas, nota privada, mídia, catálogo, backups e proteção XSS. Executada em cópia isolada, com rede externa bloqueada e sem dados reais.
- **Limite explícito desta etapa:** as dez seções ainda estão no HTML inicial; `app.js` continua um bundle monolítico e o bootstrap ainda carrega contatos na sessão inicial. Portanto, isto é a primeira redução mensurável e um teste de contrato para dois recursos, não a conclusão do carregamento independente de todas as abas. A extração completa por aba — inclusive de Campanhas e Realtime — fica adiada; os carregamentos sob demanda atuais desses scripts não equivalem a extrair marcação, estado e dados de cada aba.
- A skill Impeccable `detect` foi executada nos alvos web; a varredura ampla retornou 133 avisos de contraste, tamanhos de texto, headings e acentos laterais, em sua maioria fora dos componentes da Home revistos. Eles ficam registrados para uma auditoria global, sem correções incidentais fora do escopo.
- Skills aplicadas neste ciclo: Impeccable (onboard, clarify, optimize, polish e craft-floor), Emil Design Engineering (feedback e motion proporcional), Taste Skill (crítica por screenshots, sem chamar ferramentas que exigem Node 22), Web Design Guidelines/Vercel e acessibilidade. O shell visual existente foi preservado; as imagens recebidas eram referências de skills, não mockups, e não há MCP Figma conectado.
- A Home foi revisada em estado local/sintético desconectado; ainda falta cobrir com fixtures explícitas os estados conectados, erro de pareamento e suporte/master antes de declarar a matriz de estados completa.

## Ordem de trabalho

### 1. Home — clareza primeiro
1. Definir a tarefa principal da Home para usuário novo: saber o estado atual e o próximo passo.
2. Organizar em dois níveis: **“Comece por aqui”** (poucos passos, linguagem simples) e **“Operação”** (conexão, motor, métricas e atividade), sem esconder ações críticas.
3. Usar o estado real da conta para indicar o próximo passo; não marcar como concluído algo que não foi validado.
4. Reescrever rótulos, instruções e erros para linguagem direta, sem jargão desnecessário.
5. Remover duplicação visual, aplicar os tokens existentes e melhorar responsividade e acessibilidade.
6. Testar estados novo, parcialmente configurado, conectado, erro/vazio, usuário master/suporte e telas estreitas.

### 2. Base de desempenho — medir antes de otimizar
- Registrar recursos carregados, tamanho transferido, tempo até a Home utilizável, tarefas longas e chamadas disparadas na entrada.
- Confirmar quais módulos, marcações HTML e dados são carregados mesmo sem o usuário abrir cada área.
- **Requisito confirmado pelo usuário:** cada aba/menu deve carregar de forma independente — não montar todas as abas no HTML inicial nem inicializar todo o JavaScript e todos os dados juntos. Manter somente o shell comum (autenticação, navegação e estado essencial) no primeiro carregamento; carregar o módulo/marcação da aba selecionada e seus dados apenas ao entrar nela. Ao sair, parar listeners/tarefas da aba; manter cache limitado apenas quando houver benefício, sem perder rascunhos/contexto.
- Critério verificável: em uma sessão nova, abrir a Home não deve baixar/inicializar recursos exclusivos de Conversas, Contatos ou Campanhas nem pedir seus dados. Abrir cada menu deve buscar só o necessário para aquela área; voltar ao menu deve respeitar política clara de cache. Medir rede, memória e tempo de interação antes/depois.
- Depois da linha de base, migrar áreas pesadas em etapas, sem quebrar links diretos, atualização em tempo real ou permissões multi-tenant.

### 3. Conversas e contatos — escala de dados
- **Achado estático confirmado:** `fetchAllCloudContacts()` em `src/supabaseCloud.js` consulta em páginas de 500, mas acumula todas as páginas em um array. `loadTenantContextFromCloud()` usa esse caminho quando não recebe um contato específico. A paginação atual evita o limite da API, mas não limita o total de dados mantidos na aplicação.
- **Achado de renderização:** `renderContactsAgendaView()` em `public/app.js` copia a lista inteira, filtra, ordena e cria markup para todos os contatos. `renderCrmBoard()` também reconstrói as visões de CRM/agenda. Com 2.500 contatos, mais históricos e campos, isso pode pesar em rede, memória, CPU e DOM.
- Próximo passo é medir a quantidade/tamanho transferidos e o custo de renderização com fixtures sintéticas isoladas; não usar nem copiar contatos reais.
- Corrigir com consulta paginada sob demanda, resumo leve na lista, filtros/pesquisa no servidor e detalhe/histórico apenas quando o contato é aberto; avaliar virtualização da lista conforme medição.
- Preservar isolamento multi-tenant e ordenação/consistência enquanto novas páginas chegam; testar com massas sintéticas grandes.

### 4. Próximas áreas
Rever navegação geral e, depois, Treinamento/Aulas, Campanhas e demais áreas em ciclos separados. Ao fim de cada ciclo: testes, revisão visual, acessibilidade e comparação de desempenho.

## Skills e ferramentas de trabalho
- Já existem no ambiente instruções para frontend, layout, acessibilidade, escrita de interface, design e otimização de desempenho; serão usadas sem baixar coleções indiscriminadamente.
- Instaladas localmente as skills das fontes indicadas nas imagens: **Emil Design Engineering** (`emilkowalski/skills`, commit `a81dbca07f2217b7103e510c0f13f8d5b017afc9`), **Taste Skill** (`Leonxlnx/taste-skill`, commit `12af471f627f866411b4bd785b19646d3672784c`) e **Impeccable** (`pbakaus/impeccable`, commit `e89e3ada3e875a89ac2c5d33d11e65ebef6fe285`). Também está instalada **Web Design Guidelines** (`vercel-labs/agent-skills`, commit `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62`). Cada pasta tem `UPSTREAM.txt` com origem e commit quando aplicável.
- O projeto usa frontend sem React; por isso, a skill Vercel React Best Practices não foi instalada. As skills atuais são compatíveis com HTML/CSS/JavaScript e incluem revisão de UI, onboarding e inspeção visual.
- Playwright já estava declarado nas dependências de desenvolvimento; a instalação foi concluída, o Chromium e suas bibliotecas de sistema foram instalados no ambiente e um teste mínimo de abertura/renderização do browser passou. O cache do navegador é ambiental e pode precisar ser reinstalado em outro ambiente.
- Foram instaladas as skills oficiais Figma **figma-design-to-code** e **figma-use** (`figma/mcp-server-guide`, commit `f3f264d…`) para o caso de integrar um arquivo. A Arena não oferece conector Figma nesta conversa, então não consigo autenticar nem chamar o MCP daqui. O servidor remoto oficial exige autorização da conta num cliente MCP compatível; até haver integração, posso usar screenshots e links públicos/exports como referência, com Playwright para conferir o resultado no navegador.
- A pasta `.agents/` é ignorada pelo Git neste projeto; skills e binários locais não são enviados ao deploy. Instaladores auxiliares das skills não serão executados sem inspeção prévia.

## Critérios para encerrar uma área
- O fluxo principal fica compreensível para alguém sem familiaridade prévia com o produto.
- Os estados de carregamento, vazio, erro e sucesso são claros.
- Os controles funcionam por teclado e em telas pequenas.
- Não há regressão em conexão, ações do CRM, permissões ou isolamento multi-tenant.
- Mudanças de desempenho são comparadas com uma linha de base, e não declaradas por impressão.

## Limites deste primeiro diagnóstico e ciclo
A leitura inicial foi estática; a Home já foi revisada visualmente e testada em Chromium headless, mas essas medidas não representam perfil de produção. A matriz de estados da Home (conectado, erro de pareamento e suporte/master) e o isolamento real de conteúdo/dados para todas as abas continuam pendentes. Nenhum dado real foi usado ou modificado. Preservar a alteração preexistente em `CONTEXTO_SISTEMA.md`.
