# Lapidação do ZAP-IA Studio com as skills North

## Método

Em vez de acionar uma centena de workflows indiscriminadamente, relacionamos cada skill ao problema certo, lemos as instruções e os materiais relevantes, adaptamos ao código real, criamos testes e registramos limites. O catálogo completo e as revisões das fontes estão em `BIBLIOTECA-NORTH.md`. Conteúdo de terceiros não autoriza operações externas, publicação, operações financeiras ou exposição de credenciais.

As skills aplicadas neste ciclo foram lidas integralmente em seus arquivos `SKILL.md`: **tdd**, **diagnosing-bugs**, **codebase-design** (Matt Pocock), **replica-test**, **replica-backend** e **replica-design** (Replica), **vercel-react-best-practices** e **web-design-guidelines** (Vercel), e **landing-page** (Emotix). As instruções específicas de React, clonagem ou processos não compatíveis com o projeto não foram aplicadas literalmente. Também foram consultadas as diretrizes atuais de interface da Vercel.

## Ciclo 1 — segurança de cotas e fluxo de envio

- **Cota de chips:** a inspeção dos privilégios e do código do gatilho em produção revelou que a coluna `max_wa_slots` podia ser atualizada pelo cliente autenticado na própria ficha, apesar de a cota ser administrativa. Antes, a checagem da definição do gatilho não encontrava proteção de cota na criação nem na atualização. A migração `supabase/migrations/20261028_proteger_cota_chips.sql` foi aplicada no Supabase existente, mantendo a configuração pelo serviço Master e a atualização de `last_seen_at` no login.
- **Teste de segurança:** `tests/sql/guard-cota-chips.sql` usa tabela temporária sintética e `ROLLBACK`. Executado no projeto: cliente autenticado não altera a cota nem cria registro com cota elevada; login atualiza o último acesso; `service_role` pode configurar a cota. O teste não altera contas reais. Não é uma auditoria de todas as políticas e funções.
- **Envio em fila:** o painel acompanha o estado em consulta autenticada e filtrada pelo usuário, sem criar outro envio. Só mostra confirmação do motor quando o resultado tem `sentRealWhatsApp: true`; isso **não** significa leitura pelo destinatário. Em erro ou timeout, orienta conferir a conversa antes de reenviar. Acompanhamento dura cerca de três minutos, depende da aba aberta e não substitui recibos do WhatsApp.
- **Teste de envio:** unidade e HTTP com Supabase simulado cobrem autenticação, isolamento entre contas, dados mínimos, estados e falta de confirmação. A expressão de projeção foi aceita pelo PostgREST real com acesso anônimo retornando zero linhas; não é teste autenticado de produção nem envio real desta versão.

## Ciclo 2 — vitrine, mobile e acessibilidade

- Em Chromium, a 320 e 375 px, a primeira coluna da demonstração ultrapassava a tela e era cortada pela regra global de overflow. Ajustados grid, badge e botão; o teste verifica limites dos elementos importantes em 320, 375, 768 e 1440 px.
- O controle de valor médio tinha valor inicial 450 incompatível com o passo 20 a partir de 80: o navegador ajustava para 460. Corrigido o passo para 10 e o exemplo estático; o teste confirma o valor 450 e a estimativa correspondente, R$ 9.000. Os valores continuam sendo apenas uma simulação, não promessa de resultado.
- Abas da demonstração agora aceitam setas, Home e End, com foco móvel e associação ao painel. O teste usa teclado e verifica seleção e foco.
- Ajustada a comunicação para não prometer histórico completo, tempo fixo de resposta ou comportamentos universais de concorrentes. Diferenciada a ativação de IA por chip de uma chave de IA por chip.
- `tests/landing-browser.test.mjs` usa Playwright externo, servidor local em modo Vercel, API simulada e sem contas ou mensagens reais. Não cobre todas as páginas internas autenticadas nem todos os navegadores.

## Mapa de revisão por partes

| Área | Situação neste ciclo | Próximos cuidados |
|---|---|---|
| Contas, permissões e cotas | Gatilho de cota corrigido e exercitado com dados sintéticos; políticas de contas, contatos, comandos e chips inspecionadas | Testar mais papéis, RLS e modo suporte com contas de teste; revisar privilégios e funções sem ampliar acesso |
| Envio e atendimento | Nova consulta de comando e testes locais com rede simulada; sem novo envio real | Validar fluxo autenticado em produção sem repetir mensagens já enviadas; lidar com acompanhamento após fechar a aba |
| Multi-chip e sincronização | Suíte local em cópia isolada com chips sintéticos passou | Expandir testes de reconexão e concorrência com múltiplos aparelhos, sem abrir socket concorrente |
| Histórico | Testes de journal, ingestão, correlação e bootstrap passaram em dados sintéticos | **Aberto:** cache continua limitado a 120 mensagens; journal não é pesquisa/restauração nem prova de recuperação integral. Desenvolver persistência paginada, exclusão e backup com testes de falhas antes de usar em produção |
| Desempenho e nuvem | Teste de deduplicação em 7.500 fichas passou; consulta de status não carrega workspace inteiro para conta própria | Medir payload e frequência do polling; modo suporte ainda carrega contexto completo; evitar comprometer a sincronia |
| Vitrine e login | Mobile, teclado, simulador e calculadora testados no Chromium com dados fictícios | Ampliar para leitores de tela, outros navegadores e telas autenticadas |
| Dependências | `npm audit --omit=dev` sem vulnerabilidades reportadas no momento do teste | Repetir a cada atualização; zero resultados não é garantia de segurança |
| Windows, Linux, Termux e PWA | Nenhuma alteração no mecanismo de instalação neste ciclo | Validar atualizador e painel local em aparelhos reais antes de afirmar compatibilidade total |
| IA, CRM, biblioteca, PIX e catálogo | Recursos preservados; sem alteração funcional neste ciclo | Testes individuais com dados fictícios, consentimento e verificação de isolamento por chip |

## Limites

- A quantidade de skills não é uma medida de qualidade. Aplicar uma skill inadequada ou suas instruções cegamente pode piorar o produto.
- A análise completa de cada área e de cada skill útil **não está concluída**; este documento é um registro de trabalho por ciclos, não uma certificação do produto.
- Não houve novos envios de WhatsApp neste ciclo. Testes sintéticos não substituem uso no telefone ou evidência de entrega ao destinatário.
