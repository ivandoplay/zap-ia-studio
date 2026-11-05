# Contas / Administração master — implementação local

Data: 04/11/2026. Branch `review/reforma-visual`. Não é implantação oficial.

## Decisões confirmadas pelo usuário

- Master consulta **e altera** recursos do cliente em modo administrativo explícito, auditado e com confirmação sensível.
- Financeiro **manual**: plano, valor, periodicidade, vencimento, situação e bloqueio/liberação independentes. Sem cobrança ou suspensão automática.
- Equipe delegada por permissão e por carteira/contas. Somente o master titular administra delegações; ninguém se promove a master por esse fluxo.
- Construir e testar localmente antes da implantação oficial; não operar contas reais nesta etapa.

## Onde avaliar

- Revisão estática fictícia: `/contas/`, preview local na porta 4182. Usa o mesmo shell/identidade de Conversas, temas claro/escuro e layouts responsivos.
- Entrada nativa: `public/v2/accounts.html`, `/contas/`.
- A composição real está **fechada**: `allowWrites:false`, `allowWorkspaceWrites:false`, sem fonte global e sem porta de workspaces injetadas. A consulta nativa também retorna indisponível; não chama `listManagedUsers`, não inventa carteira vazia nem cai em demo.
- A demonstração usa somente dados sintéticos em `sessionStorage`, chave `ienvia-admin-board-demo-v1`. Não usa chaves de sessão/PIN/login e não deve receber dados reais. Suporte/desatualizado são somente consulta; erro limpa a carteira exibida; vazio usa fixture vazia.

## Paridade e adaptações do original

Inventário: `public/painel.html` seção Contas e modais de criar/editar; `public/app.js` gestão de clientes, senha/suporte e central comercial; `src/supabaseCloud.js` listar/provisionar/atualizar/excluir; rotas `/api/admin/users` em `src/server.js`. Nenhum desses fluxos legados foi invocado para testar a reforma.

| Controle familiar | Entrega local e limite |
|---|---|
| KPIs, carteira, atualizar e busca | Busca por empresa, login, telefone, notas permitidas e plano; paginação. Filtros ativo/bloqueado, motor online, implantação incompleta, planejado, atraso/pagamento, arquivo e solicitação de exclusão. Ausência de diagnóstico não vira zero, online ou implantação concluída. |
| Novo cliente | Planejamento UUID com nome, login, contato, cota, notas. Não cria Auth/workspace/RLS. Campo de senha inicial deliberadamente desabilitado, sem valor em claro. |
| Ficha comercial | Nome/telefone/notas com motivo e auditoria. Cadastro delegado não lê nem apaga notas financeiras ocultas; patches preservam campos não autorizados. |
| Kit e copiar | Orientação sem senha/token/link de reset; gerado após cadastro planejado ou por conta. Cadastro planejado não promete login existente. Copiar não envia WhatsApp. |
| Cota de chips/instâncias | Proposta por conta, acima de três ou sem limite comercial definido. Não muda o clamp do runtime legado nem desconecta/troca aparelhos. A remoção de limites operacionais depende de implantação dos módulos UUID, não deste campo. |
| Suporte de um clique | Ação visível abre formulário de motivo, modalidade e confirmação para escrita. Sessão administrativa de 15 minutos com ator/alvo/modo fixos, encerramento explícito e auditoria. Não escreve `zapia_act_as`, não pede senha e não altera o suporte legado. |
| Reset de senha | Solicitação auditada e confirmada, **não executada**. Sem gerar senha, email ou token de recuperação. |
| Bloquear/liberar | Estado **planejado** manual e confirmado, independente de vencimento/pagamento. Não suspende/libera a conta Auth real. |
| Excluir | Solicitação auditada, sem exclusão permanente ou limpeza de dados. Arquivo separado e reversão de status manual. |
| Métricas e implantação | DTO seleciona contagens/flags de origem, setup score, último acesso e números conectados permitidos. Não retorna chaves. Não consulta executor/worker real nesta entrega. |
| Vitrine principal, link e preços de 1/2/3 | Central comercial exclusiva do titular, origem HTTPS explicitamente informada (padrão `exemplo.invalid`, não presume domínio oficial), telefone e preços independentes das contas. Não publica site nem altera preços individuais. Os três preços são ofertas comerciais, não teto de instâncias. |
| Playbook / levar ao disparador | Quatro scripts e cinco alavancas revistos, sem promessas antigas de anti-ban, pausa automática ou comissão automática. Preparar texto e navegar para Campanhas não importa destinatários, cria fila ou dispara. Copiar material exige confirmação/motivo auditado. |

Os IDs principais da carteira e dos campos familiares foram mantidos; formulários comerciais/cliente são contextuais e compartilhados. O painel original continua intacto, não é substituído nem alterado para depender desta revisão.

## Novos controles

- Financeiro manual em campos próprios: plano, valor inteiro em centavos, ciclo, vencimento, pago/pendente/atraso informado/isento e observação. Sem vencimento calculado, cobrança, PIX/checkout, lembrete, imposto, nota fiscal ou conciliação automática. O valor de KPI é **valor cadastrado**, não receita recebida nem MRR calculado.
- Recursos planejados por cliente: CRM, IA, Campanhas, Treinamento, Catálogo, Áudios, Simulador, Segurança, Instâncias e Exportações. São política proposta, **não enforcement ativo** nos motores.
- Equipe: modelos Suporte (consulta), Financeiro e Cadastro, editáveis; permissões independentes e escopo de contas ou carteira completa. Criação de clientes exige carteira completa. Não existe permissão delegável `master`/gerenciar equipe. Conta master titular protegida contra bloqueio, alteração, arquivo/exclusão e autodelegação neste fluxo.
- Exportação de ficha parcial: confirmação/motivo, auditada, contém contato/notas/financeiro autorizados; sem senha/chave/PIN. Arquivo **privado**, não backup integral. Exportar não envia o arquivo ao servidor/provedor.
- Auditoria com ator, alvo, motivo, horário, resultado, campos alterados, valores não privados antes/depois e fingerprints de conteúdo privado. A cadeia SHA-256 detecta alteração dos eventos, mas **não é assinatura externa, WORM ou proteção contra administrador do filesystem**. Só titular vê toda a trilha; delegado vê seus próprios eventos.

## Alteração administrativa reutiliza os rascunhos nativos

`src/accounts/workspace-port.js` reutiliza os mesmos repositórios de Treinamento, Recursos (Catálogo/Áudios/PIX), IA e Segurança. Não cria segundo negócio ou executor operacional. O editor tem campos estruturados e uma estrutura avançada validada para listas; os formulários completos das áreas nativas continuam preservados.

A porta recebe um `resolve` confiável que precisa atestar o titular e retornar documento público de origem e o fingerprint **nativo** correto. Não aceitar owner/source/config enviados pelo navegador para construir essa origem. Não usar storage global do master como se fosse do cliente.

- Cada operação verifica sessão, papel/delegação, conta, modo da sessão, validade, source version e revisão CAS do alvo.
- AI e Segurança expõem só configurações públicas. Credenciais cifradas e verificador privado de PIN existentes são preservados **sem retornar, substituir ou removê-los**. Não há rotação de segredos por este editor administrativo.
- Alteração de rascunho: intenção persistida/auditada **antes** da escrita nativa, seguida do resultado. Não se promete transação atômica entre arquivos/repositórios distintos.
- Falha depois de intenção deixa `pending`/`uncertain` e bloqueia novas escritas no alvo. Não reaplicar, reenviar ou limpar automaticamente. Reconciliação explícita só confirma aplicado se titular, requestId, revisão e fingerprint do conteúdo forem exatos; ausência de prova mantém bloqueio. Recuperação de casos sem prova requer procedimento de implantação próprio, ainda não implementado.
- CRM, executor Campanhas UUID, conexão/QR/pareamento, mensagens, histórico/limpeza e Simulador não são executados por este editor. Mapa visível aponta as áreas nativas e explica limites. Cota/flags podem ser planejadas, mas não assumem autorização operacional nos outros módulos.

## Autorização, persistência e APIs

Arquivos: `src/accounts/{router,record,repository,workspace-port}.js`; `public/v2/assets/accounts-{domain,sales,store,view,app}.js` e `accounts.css`.

- APIs fechadas: `GET /api/accounts-v2`, `POST /command`, `/support`, `/workspace-read`, `/workspace-write`, `/workspace-review`.
- Identidade vem somente do contexto autenticado. O titular pode usar o próprio root; delegação exige `administrationRootId` confiável fixado pelo servidor e membro ativo no ledger. Não há root/role/permission aceitos do body/query. Esse vínculo do root à identidade oficial **ainda não está configurado** na composição real.
- Administração global rejeita contexto em atuação/suporte original. A página exige saída explícita dele antes de abrir Contas.
- Validação por whitelist, UUID e fonte atestada; sem fallback global/cloud ou retorno de registro privado bruto. Origem inválida/indisponível não vira sucesso ou lista fabricada.
- Ledger privado proposto em `data/accounts-administration-v2/`, ainda **não criado no workspace real**. Arquivos 0600/diretório 0700, nofollow/symlink guard, lock, arquivo temporário + rename e CAS. Limites de segurança: 1000 contas/200 delegações/2000 eventos/200 intenções/1000 sessões, documento limitado; ao atingir, falha fechado, sem truncar auditoria silenciosamente. Retenção/rotação/multiworker precisam desenho oficial, não ampliar por edição casual.
- RequestId vinculado ao ator e intenção; reutilização histórica recusada. Resposta de outra identidade/root ou tardia após troca de escopo é descartada. Mutações não fazem auth refresh/replay. Erro/incerteza bloqueia novas ações até consulta explícita.
- Timeouts/browser não provam ausência de efeito. A consulta explícita é obrigatória antes de decidir; nenhuma retomada automática foi inventada.

## Validação concluída

- **37/37 novos testes**: domínio/adaptador, HTTP/repositórios reais isolados, servidor real com fetch sintético e cinco cenários Chromium.
- **181/181 selecionados**, incluindo módulos anteriores, sessão e provisionamento legado.
- **758/760 suíte completa**, 254139,074671 ms. Só falhas históricas `ienvia-branding.test.mjs` e `static-release-package.test.mjs`, já presentes antes desta etapa. O teste de busca/navegação foi atualizado da rota antiga `/painel#contas` para `/contas/`, mantendo as verificações de HTML literal.
- **100 assets** estáticos verificados; sem app autenticado/session-client/segredos/APIs no pacote de revisão. CSP com `connect-src 'none'` preservada.
- Chromium nativo: persistência real isolada, cadastro apenas planejado, senha desabilitada/kit sem senha, financeiro sem bloqueio implícito, cota >3, sessão administrativa e alteração do mesmo rascunho nativo, encerramento/auditoria, conflito duas abas, rede incerta sem replay, perda de identidade, confirmação errada sem efeito, export privado sem credencial. Demonstração: vitrine/delegação, persistência fictícia, falha/suporte, 1440/390/320 e dois temas sem API/overflow/erro.
- Cofres e PIN privados sintéticos selados foram preservados nos testes de IA/Segurança sem exposição. Recursos usam repositório nativo; mudança de origem não sobrescreve. Contexto alterado durante await falha fechado.
- Captura: `/home/user/auditoria/arquitetura-v2/contas-1440.png`; evidência `accounts-evidence.json`; logs `accounts-{red,green,browser,selected,full}.log`.

## Ainda precisa implantação oficial — não confundir com controle ativo

1. Homologar fonte global, identidade titular/delegada, RLS e escopo por tenant; não reutilizar `listManagedUsers` sem tratar erros de todas as fontes e impedir devolução de dados privados.
2. Configurar origem de cada workspace e os fingerprints nativos; garantir mesmas raízes e registros preservando cofres/PIN. Não ligar o gate global dos módulos anteriores para obter acesso administrativo.
3. Implementar/homologar provisão Auth + dependências + compensação, emissão/recuperação segura de credenciais e recebimento de convite pela equipe. Planejamento não é usuário criado.
4. Aplicar políticas aprovadas de plano/cota/recursos/bloqueio nos módulos oficiais, com revisão explícita, auditoria e confirmação. Nenhuma suspensão automática por vencimento foi autorizada.
5. Tratar exclusão definitiva, backups/retensão, reconciliação sem prova, coordenação entre workers e trilha externa antes de liberar operações destrutivas.
6. Homologar gates separadamente, sem credencial no front e sem ativação automática, IA paga ou WhatsApp nesta revisão.

Nenhum commit/push/deploy, SQL remoto, alteração de plano, billing, Auth, cliente real ou regra ativa foi realizado nesta etapa.
