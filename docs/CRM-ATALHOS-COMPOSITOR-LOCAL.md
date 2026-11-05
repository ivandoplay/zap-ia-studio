# CRM — atalhos `/` do compositor e gerenciador demonstrativo

04/11/2026. Continuação automática da reforma. **Fatia local testada; não é conclusão da reforma nem biblioteca autenticada em produção.**

## Referência e autorização

Fonte oficial fixada: SHA `7630b62b40b4518d06a157c4dc5055747fcb157e`, `public/app.js` nas funções `renderSlashPopover`, `applySlashQuickReply`, gerenciador e handlers do compositor; normalização/upsert em `src/storage.js`. Leitura por Git sem checkout/reset. Os arquivos originais/servidor/migrações não foram modificados nesta fatia.

Última ordem mantida: continuar correções/testes e **avisar quando tudo estiver concluído/validado para fazerem o deploy juntos**. Sem deploy agora/automático, SQL remoto, custo novo ou mensagens reais. O pedido atual de continuar não revogou esse limite.

## Fluxo reposto na demonstração

- `/` no início do texto abre **seletor inline acima do compositor**, não diálogo sem filtro nem busca global. Digitar pesquisa código, título e corpo por substring literal; `%`, `_` e marcação não ganham interpretação especial.
- Setas navegam circularmente. Enter/Tab escolhem e **somente inserem texto para revisão**. Escape fecha o seletor sem apagar o texto ou fechar a ficha. Clique escolhe sem perder o contexto; clique fora fecha o menu. Vazio tem indicação explícita; Enter com menu vazio não vira envio acidental.
- `{{nome}}` e `{nome}`, incluindo caixa/espaços, expandem apenas o primeiro nome. Outros placeholders ficam literais. Valores como `$&` e HTML são tratados como dados, sem expansão adicional/HTML executável. Não chama IA nem usa empresa/origem como substituições inventadas.
- Inserir preserva instância de saída, citação e anexo já preparados. Não escolhe instância, não assume origem como saída e não envia. Nota interna não abre seletor. Rascunhos permanecem separados por conversa/modo e somente em memória.
- Texto que já começa por `/` pode ser um atalho literal: depois de inserir, o menu realmente fecha (`aria-expanded=false`), em vez de reabrir como pesquisa sem resultado.
- **Gerenciar atalhos** permite criar, editar, cancelar edição e remover com confirmação, tudo na memória da demonstração. Cancelar remoção por botão **ou Escape** preserva o rascunho do gerenciador. Remover não apaga conversa/mensagem.
- Fonte demonstrativa explícita no adaptador; catálogo recebe cópia. Normalização de código acompanha o legado (retira barra, minúsculas, caracteres ASCII permitidos); novo cadastro com código existente mantém o ID. Edição que colidir com outro ID é recusada sem sobrescrever outro item. Retornos são clonados; outra instância da demo não recebe alterações. Suporte não grava/remove.
- Limites explícitos: código80, título160, texto4000 (compatível com o compositor atual). Expansão do nome que exceder4000 avisa **sem truncar, trocar o rascunho ou enviar**. Não são novos limites aplicados silenciosamente aos dados operacionais legados.
- Formulário fica inerte durante confirmação. Ações/retornos exigem versão atual e diálogo **conectado e aberto**. Diálogo fechado antes do evento `close` não pode produzir submissão tardia. O listener do formulário não fica preso ao AbortSignal global da página; o popup remove listener externo e dados no dispose/troca de conversa/cenário/conta.

## Separação operacional

O nativo continua sem compositor de envio e **não recebe exemplos como biblioteca da conta**. A opção de respostas rápidas informa a integração pendente, sem GET extra/POST ou acesso ao endpoint legado. Nenhuma rota foi acrescentada ao cliente de sessão; não há import do app monolítico, migração, storage privado, ponte por telefone ou execução WhatsApp.

A biblioteca autenticada de atalhos, seu escopo de perfil/conta, permissões/revisões, dados reais e homologação continuam pendentes. O gerenciador demonstrativo não comprova CRUD operacional.

## Evidências

Skills consultadas: TDD, projection-patterns, frontend-design (preservando a direção visual existente, sem redesign), differential-review. Interfaces delegadas: helpers puros, adaptador demonstrativo e UI pública de navegador; não foram solicitadas confirmações técnicas rotineiras.

- **9 testes novos** sobre a base anterior de817; o total atual é826. São2testes de contrato/adaptador,6fluxos adicionais de navegador e1negação explícita no nativo. O teste antigo que esperava diálogo foi atualizado para exigir o seletor inline e seus3itens, conforme o oficial; não foi removida a verificação de atalhos.
- Seleção combinada **90/90**,51757,312137ms, antes do último reforço de ciclo de vida. Após esse reforço,3repetições de13/13 (10719,061663ms;11137,732444ms;10358,559558ms), seguidas pelo full validado.
- **Full validado824/826**,281938,10149ms. Somente as duas falhas históricas `ienvia-branding.test.mjs` e `static-release-package.test.mjs` (release/assinatura antigos), ainda impeditivas de publicação. Não é suíte100% aprovada.
- Full inicial824/826,286754,439777ms. Um full intermediário823/826,288210,945596ms expôs submissão de modal fechado ainda conectado, antes do evento `close`. Foi reproduzida deterministicamente sem esperas arbitrárias e corrigida pela verificação de `dialog.open`; não foi mascarada aumentando timeout ou enfraquecendo a asserção. O full validado confirmou o reparo.
- RED→GREEN para módulo/contrato, popup, CRUD, gerenciador, expansão longa, texto literal iniciado por barra, Escape da confirmação e eventos de formulário descartado/diálogo fechado. Fixtures de seletores foram corrigidas para os rótulos reais/escopo correto; não confundir esses erros de teste com defeitos do produto.
- Captura final repetida no código validado: **13/13**,10741,615966ms.
- Capturas sintéticas inspecionadas: `crm-atalhos-inline-320.png` e `crm-atalhos-gerenciador-1440.png`. Sem overflow a320px, API, WebSocket ou armazenamento dos textos. Não comprova teclado físico/móvel ou auditoria WCAG completa.
- Build/verify **103 assets**, sem runtime/API/sessão no site de revisão. Novo módulo é puramente local; apenas demo/view e builder o consomem. ZIP/demo online anteriores continuam antigos.
- Logs e revisão: `/home/user/auditoria/implantacao-gradual/crm-quick-replies-*`, `crm-quick-replies-review.md`, `crm-quick-replies-evidence.json`. Logs grandes em `.log.gz`, preservados sem perda. O resultado final é `crm-quick-replies-full-validated.log.gz`, não o intermediário com3falhas.

## Próxima sequência

Projeção autenticada de metadata no inbox/filtros sem N+1 ou associação por telefone; biblioteca/cores de etiquetas e integração autenticada dos atalhos; operações/mídias/importação/exportação/backup/sincronização; reauditoria das demais abas; homologação de Auth/RLS/dados/concorrência/migração, assinatura e rollback. Nenhum desses pontos foi declarado concluído por esta fatia.

Antes de trocar qualquer aba: reconfirmar deployment oficial, reconciliar mudanças, concluir a matriz, homologar com autorização e avisar o titular para publicar juntos. Manter painel antigo acessível até equivalência.


## Atualização posterior — biblioteca autenticada de atalhos (local)

`CRM-BIBLIOTECA-ATALHOS-LOCAL.md` registra persistência nova por conta, leitura explícita e CRUD CAS/auditoria preparados. GET/PATCH exatos `/api/crm-v2/quick-replies`; migração aditiva10000, sem importar defaults/dados antigos. UI nativa em Ferramentas → Respostas rápidas / usa fonte autenticada comprovada, readonly sem permissão e sem exemplos/fallback. Editor/remoção confirmada preservam rascunho; suporte não grava; nenhum compositor/envio nativo foi ativado. Demo/atalhos inline anteriores intactos.

Os dois gates de escrita existentes continuam false na aplicação/contas reais; não houve SQL remoto/ativação. A pendência histórica “biblioteca autenticada ausente” está atualizada **quanto ao código local**, não à migração/homologação dos dados originais.14novos;94/94seleção;3repetições25/25browser; full validado853/855 (somente duas falhas históricas de release/assinatura),104assets. Full inicial tinha erro de espera por título intermediário quando a conta já havia sido corretamente descartada; teste passou a esperar o gate final, sem correção runtime/relaxamento de timeout.

Continuam migração/ativação real da biblioteca, etiquetas globais/cores/operações/mídias/import/export/backup/sync, reauditoria demais abas e homologação Auth/RLS/delegação/dados/concorrência/migração/assinatura/rollback. **Sem deploy agora/automático; avisar quando toda a reforma estiver concluída e validada para publicar com o titular.**
