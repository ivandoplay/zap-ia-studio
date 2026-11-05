# Inteligência artificial — implementação local (04/11/2026)

## Original, referências e experiência

A autorização seguinte ao Simulador foi aplicada à próxima aba, **Inteligência artificial**. Conferidos `public/painel.html` (aba `tab-ia`), `public/app.js` (`renderAiSettings`, coleta, telemetria, save/test e toggle), `src/server.js` (teste antigo), defaults de `src/storage.js` e roteamento real de `src/aiEngine.js`. Não editados esses motores, UI legada ou banco ativo. Skills consultadas: TDD, frontend-design, webapp-testing, api-design-principles, error-handling-patterns e sharp-edges. Questionários técnicos não repetidos, conforme delegação vigente.

Página `/inteligencia-artificial/`, menu e identidade Conversas, com todos os IDs originais do bloco preservados:

- Cinco métricas originais, com dia registrado e leitura manual; ausência vira “—”, não zero inventado. Latência é do original, não um teste desta página.
- Gemini/OpenRouter, modelos atuais inclusive modelo customizado já cadastrado, pool de extras, Auto/Fallback, reserva, criatividade 0–1 e memória 4–60 mensagens.
- Controle rápido e fallback quando pausada. O toggle é **proposta no rascunho**, não chama `/api/wa/toggle-bot` e não salva/ativa automaticamente.
- Modelos listados são opções preservadas do original, não catálogo confirmado ou promessa de gratuidade, capacidade ou disponibilidade atual. Não foi feita consulta ao provedor.
- Verificação de configuração sem IA e prévia da regra de rota; teste externo de conexão visível, porém **bloqueado** porque pode consumir cota/cobrar.
- Recarregar com confirmação de descarte local, export sem chaves e reinício explícito a partir do original. Origem alterada exige esse reinício, não merge silencioso.

## Rota: regra original, não outro motor

Auto seleciona Gemini para áudio e OpenRouter para texto/imagem. Após falha de uma chamada configurada, a reserva é o outro provedor, **mesmo que a seleção de reserva diga outra coisa**; por isso esse seletor só fica editável no modo Fallback. No Fallback, principal é selecionado e só há reserva distinta se habilitada. Sem chave principal o motor original retorna erro antes de tentar reserva. A prévia descreve essa regra, não chama nem substitui `generateSmartReply`.

Modelo de texto pode não analisar imagem; resposta de IA não comprova pagamento. Pool não garante aumento de cota nem gratuidade e não contorna termos de uso. Nesta versão de rascunho, substituição de pool aceita até 30 entradas deduplicadas; cadastros originais maiores permanecem referências, sem migração/apagamento. Métrica de entradas pode incluir repetição entre principal e extras; não é quantidade de chaves válidas/cotas.

## Segredos e persistência

API `/api/ai-settings-v2` guarda rascunho público e, quando **explicitamente** habilitado em composição de teste, substituições cifradas. Nenhuma chave original é devolvida, copiada para frontend ou automaticamente migrada. Estados por campo: Manter, Substituir, Limpar no rascunho, Usar original. Limpar não apaga o cadastro ativo. Campos vazios não significam remoção implícita.

`src/ai-settings/vault.js`: AES-256-GCM, nonce aleatório de 96 bits e AAD vinculada à conta/campo/contagem. Chave de 32 bytes **injetada**, nunca lida de `.env`, inventada automaticamente, retornada ou gravada pelo módulo. HMAC de intenção permite replay exato sem recifrar; adulteração, troca de conta/campo/contagem e chave incorreta falham. Nenhum endpoint lê o segredo cifrado para o cliente.

Repositório privado UUID, 0600/0700, lock exclusivo, CAS, rename atômico e proteção contra symlink; diretório ignorado no Git. Não promete recuperação de perda de chave, rotação/KMS ou durabilidade física após queda de energia. Esses itens e provisionamento seguro da chave de cofre são requisitos da implantação oficial, não serviços operacionais já habilitados.

**Composição real: `allowWrites:false`, `allowSecretWrites:false`, sem cofre injetado; teste de conexão sempre indisponível.** Testes habilitam apenas diretório/chave e credenciais sintéticas descartáveis. Não houve gravação de credencial real, IA externa, toggle real, CRM, WhatsApp ou ativação. Arquivos novos não são instalados automaticamente nos processos reais.

ReadSource exige settings locais proprietários; cloud não homologada retorna 503, não busca workspace/segredo global para preencher um falso estado vazio. Suporte master só consulta. Allowlist exata, parâmetros estritos, no-store, respostas/erros sem segredos, invalidação por sessão/PIN/conta/modo e mutações sem refresh/replay automático. Após resultado incerto, consultar antes de decidir; uma operação já aceita pode ter gravado o rascunho da conta antiga, nunca uma ativação ou transferência para a nova.

## Backup, original e demo

Export inclui **somente campos públicos conhecidos do rascunho**, sem credenciais ou envelopes. Não é backup do cofre ou configuração integral original. Campos futuros, escudo e demais configurações do original não são exportados/sobrescritos. A implantação futura deverá mesclar os campos permitidos, não substituir indiscriminadamente o objeto settings/ai. Treinamento e Simulador permanecem os mesmos; nenhuma nova fonte de conhecimento.

Demo estática: dados fictícios, sem API, autenticação ou rede. Estados e contagens são voláteis; texto de chave digitada não é retido no documento, apenas digest de intenção e contagem em memória. Não usar credenciais reais na demo. A aparência pode continuar sendo salva individualmente pelo shell, mas configurações e segredos não vão ao localStorage. Nova carga da página descarta alterações. Suporte/falha/stale são ensaios identificados.

## Validação e entrega

- **19/19 testes novos**, incluindo domínio, cofre, HTTP, repositório, adaptador, gates do servidor real isolado e Chromium.
- **133/133 selecionados**, com Simulador, Treinamento, Catálogo/Áudios, sessão, configuração original e revisão estática.
- Suíte geral final: **698/700**. A suíte excedeu o prazo antigo de 240 s em uma tentativa; o harness agora aceita `ZAPIA_TEST_TIMEOUT_MS` validado (padrão preservado de 240 s). Reexecução com `ZAPIA_TEST_TIMEOUT_MS=360000 npm test` concluiu em cerca de 248 s, sem alterar seleções ou asserções. Somente as duas falhas históricas `ienvia-branding.test.mjs` e `static-release-package.test.mjs`; não mascaradas.
- Build/verificador: **89 assets** estáticos, sem app autenticado, cliente de sessão, módulo de cofre, arquivos de dados ou função de backend.
- Browser: todos os IDs originais, modelo legado, pausa não automática, CIFRA e recarga sem eco de chave, pool deduplicado, export sem segredos, verificação sem conexão, duas abas/CAS, rede incerta sem replay, perda de sessão, HTML literal, suporte/falha e demo 1440/390/320 px com dois temas e CSP real, sem API/rede externa/overflow/erros JS. Não equivale a auditoria WCAG/pen-test completo ou homologação de provedores, cotas e aparelhos físicos.

Evidências: `/home/user/auditoria/arquitetura-v2/ai-settings-*`, `inteligencia-artificial-1440.png`. Preview seguro: `PORT=4180 REVIEW_START_PATH=/inteligencia-artificial/ node scripts/preview-visual-review.mjs`. Somente revisão fictícia, sem servidor operacional ou `.env`.

Próxima aba: **Segurança / Configurações**; depois Contas master. Sem commit/push/deploy, SQL remoto, upgrade de plano, IA paga ou operação real nesta etapa.
