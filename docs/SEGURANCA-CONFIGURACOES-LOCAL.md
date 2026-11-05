# Segurança / Configurações — implementação local (04/11/2026)

## Original e referências

Autorização posterior à aba Inteligência artificial. Conferidos a seção `tab-seguranca` de `public/painel.html`, render/coleta/presets/ignorados/fila/alerta de `public/app.js`, defaults de `src/storage.js`, handlers de `src/server.js` e regra de expediente de `src/whatsappManager.js`. Motores e UI legada não foram editados. Skills consultadas: TDD, frontend-design, webapp-testing, api-design-principles, error-handling-patterns e sharp-edges.

Nova página `/configuracoes/`, menu Configurações, identidade Conversas e **todos os IDs da seção original preservados**. Não é outro aplicativo nem uma ativação das regras no servidor principal.

## Funcionalidades locais

- Cadência: presets **Natural (4 s / 1200–3200 ms), Moderado (6 s / 1800–5200 ms), Agressivo (12 s / 3000–8000 ms)** iguais ao original; debounce, digitação, divisão de mensagens, intervalos/teto da fila, espera de leitura e limite de respostas por contato. Intervalos invertidos são rejeitados. Preset não apaga demais campos.
- Atendimento humano: pausar ao responder no celular, duração, WhatsApp pessoal e flag existente de notificar. Uma flag falsa **não é forçada a true** ao salvar, ao contrário do coletor antigo. Nenhum alerta ou pausa real é executado.
- Horário: três modos originais, início/fim, mensagem opcional; dias da semana e fuso já existentes agora são visíveis e preservados. Limites inclusivos no mesmo dia civil; janela que cruza meia-noite é avisada, não reinterpretada como turno noturno. Nenhum scheduler é iniciado.
- Ignorados: inclusão/remoção **manual no rascunho**, com nome, número e notas existentes; validação/dedup usam o normalizador de Campanhas. DDI internacional explícito é preservado, sem adicionar DDI brasileiro por engano. Não cria descadastro automático por mensagem, não modifica flags do CRM nem bloqueia no WhatsApp.
- PIN: referência do original ou proposta de definir/retirar; PIN atual nunca aparece. Manter não apaga, campo vazio não significa remoção. Sessão atual não é atualizada/encerrada.
- Rascunho persistente privado, revisão/CAS, consulta manual, reset explícito quando a origem mudou, export **sem PIN/verificador**. Export contém telefone pessoal e ignorados e exige confirmação de arquivo privado; não é backup integral original.

## Fila original e Campanhas

Lista de contatos, mensagem aprovada/personalizada, modo de saída e botões Iniciar/Pausar/Limpar continuam visíveis. **Os comandos estão bloqueados**, não são handlers legados disfarçados. O estado do executor não é consultado: quando disponível, mostra somente quantidade de registros legados, nunca chama isso de saldo/execução ou presume fila vazia.

Lista e texto de ensaio ficam só na página, não no documento/export. A conferência conta números válidos, linhas inválidas/repetidas e coincidências com ignorados propostos. Não verifica WhatsApp, não remove/enfileira/envia automaticamente e não seleciona contatos do CRM. Até 1.000 linhas na prévia; listas persistentes maiores seguem em Campanhas.

A escolha de instâncias UUID, armazenamento de listas e planejamento persistente continuam em **Campanhas**, não num segundo executor. Não reintroduzir teto de três slots, mapeamento automático de Chip 1 ou troca silenciosa de número. O teto da fila legada não é transferido para limites de campanhas UUID. Templates vêm do mesmo rascunho de Treinamento, quando existente, ou do pacote original autorizado; sem pacote disponível não são buscados em outra conta. Até 100 opções/8.000 caracteres por texto nesta interface; compilação/edição integral permanece em Treinamento. Selecionar uma opção só copia texto para o ensaio, não altera nem ativa o aprovado.

## PIN e segurança da proposta

`src/security-settings/pin.js` recebe chave/pepper de 32 bytes por **injeção explícita**. Não lê `.env`, não gera/grava chave e não guarda PIN reversível. Verificador: scrypt (N=16384, r=8, p=1), sal aleatório de 16 bytes e entrada HMAC vinculada ao owner com pepper externo. HMAC separado por propósito também protege a intenção de idempotência; evita deixar um digest simples de PIN de baixa entropia no arquivo. Comparação interna em tempo constante, sem endpoint de tentativa de PIN.

O registro privado contém somente verificador e metadados; GET/export/erros não contêm PIN, sal, hash, dica ou comprimento. Substituições têm replay exato sem derivar novo verificador; reuso do pedido com outra intenção conflita. Há lock em voo por conta, CAS/lock de arquivo, UUID, 0600/0700 e nofollow. A chave de pepper não existe nesta implantação composta; teste usa chave sintética descartável.

**Não copiar o verificador para `settings.securityPin` legado.** A ativação futura requer migração do verificador de autenticação, armazenamento/rotação/recuperação segura do pepper, limitação de tentativas, revisão de sessões/PIN e autorização específica. Não é hardening completo, auditoria/pen-test ou proteção de um painel exposto à internet. Cadência/digitando não garantem ausência de banimento.

## API e fronteiras

Namespace `/api/security-settings-v2`: GET raiz, PUT draft, POST reset/validate e contratos bloqueados de test-owner-alert e queue/start/pause/clear. Dono derivado de sessão; suporte master somente leitura; allowlist exata, parâmetros estritos, no-store, erros sem eco de segredos. Troca de conta/modo/perfil de acesso é verificada novamente após operações assíncronas e derivação de PIN. Mutação não renova autenticação nem se repete após 401/resultado incerto: consultar antes de decidir. Operação já aceita pode ter gravado somente o rascunho da conta antiga; não é ativada ou transferida para a nova.

**Composição: `allowWrites:false`, `allowPinWrites:false`, nenhum protector/pepper injetado. Comandos de fila/alerta e ativação são sempre indisponíveis.** Nenhum dispatch, manager, agenda, socket, CRM ou provedor é importado pelo módulo. Fonte cloud ausente retorna 503, não lê workspace/PIN global nem fabrica documento vazio. Configuração legada inválida não é normalizada/destruída silenciosamente: fica indisponível para revisão antes da migração. Campos futuros fora do escopo permanecem no original, não são sobrescritos nem incluídos neste export parcial.

Demo: dados sintéticos, somente memória e sem sessão/API/rede externa. PIN demonstrativo guarda só o estado, não valor/verificador; repetição de comando de PIN exige consulta. Não usar PIN/contatos reais. O shell pode salvar aparência individual, não configurações ou contatos.

## Validação

- **23/23 testes novos**: domínio/presets, telefone internacional, listas/dedup sem ação, dias/fuso, PIN/pepper/conta, HTTP, repositório, adaptador, gates do servidor real isolado e Chromium.
- **145/145 selecionados**, incluindo IA, Simulador, Treinamento, Catálogo/Áudios, sessão e revisão estática.
- **721/723 suíte completa**, somente as duas falhas históricas `ienvia-branding.test.mjs` e `static-release-package.test.mjs`. Comando `ZAPIA_TEST_TIMEOUT_MS=360000 npm test`, cerca de 257 s. Nenhum teste foi alterado para mascarar as falhas.
- Build/verificador: **94 assets** estáticos, sem aplicativo autenticado, cliente de sessão, módulo de PIN ou dados privados.
- Chromium: IDs originais, presets, inclusão manual de ignorados, persistência/recarga, M01 e prévia sem envio, export privado sem PIN/lista de ensaio, sessão PIN inalterada, CAS entre abas, rede incerta sem replay, troca de sessão, HTML literal e demo com CSP real em **1440/390/320 px e dois temas**, sem API/rede externa/erros JS/overflow. Não é auditoria WCAG ou homologação física/operacional integral.

Evidências em `/home/user/auditoria/arquitetura-v2/security-settings-*`, screenshot `configuracoes-1440.png`. Preview seguro: `PORT=4181 REVIEW_START_PATH=/configuracoes/ node scripts/preview-visual-review.mjs`; somente demonstração fictícia, sem servidor operacional ou `.env`.

Próxima aba: **Contas (master)**. Depois, revisão das pendências de integração oficial. Sem commit/push/deploy, SQL remoto, troca real de PIN, alerta, conexão ou envio nesta etapa.
