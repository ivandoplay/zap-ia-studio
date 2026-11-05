# Simulador — implementação local (04/11/2026)

## Original e escopo

Conferidos `public/painel.html` (aba e modal), `public/app.js` (atalhos, microfone, diagnóstico e correção), handlers legados de `src/server.js`, `src/aiEngine.js` e `src/trainingPackEngine.js`. Preservados os controles originais na nova `/simulador/`, com a identidade visual de Conversas e sem trocar os menus. Skills de TDD, frontend, testes web, contratos de API e tratamento de erros orientaram a implementação. Inventário e etapas RED/GREEN em `auditoria/arquitetura-v2/simulator-*`.

- Texto, anexos/microfone, perfil e status da IA (apenas leitura), quatro atalhos gerais e seis específicos do pacote Lizandro.
- Histórico privado limitado a 40 mensagens em pares, recarga, exportação e limpeza explícita. O histórico do Simulador original permanece intacto.
- Raio-X: skills, humanização, objeções, personas, provedor/modelo, latência quando medida, fallback e escudo.
- Catálogo, PIX/QR, voz, pausa/silêncio, encerramento e passagem humana aparecem como **propostas/diagnósticos**, nunca efeitos reais.
- Corrigir/Ensinar abre a resposta e salva FAQ ou regra no **mesmo repositório de rascunhos de Treinamento**, com revisão/CAS e idempotência por intenção. Não existe segundo cérebro nem escrita no negócio ativo.

## Motor e versões

O backend reutiliza `generateSmartReply` e `buildSystemPrompt` originais sem editar `src/aiEngine.js`. Cada execução usa Storage em memória e contexto de tenant próprio. Provedor propositalmente sem credenciais, guard anterior à execução e allowlist do resultado impedem uso de chaves do ambiente ou IA externa. Teste instala chaves sentinelas e proíbe fetch externo; nenhum acesso ocorre. Esse modo local determinístico **não avalia a qualidade de uma resposta generativa**.

A versão é explícita: original ou sobreposição dos rascunhos reais de Treinamento/Catálogo/Áudios. Fingerprint/revisão impedem misturar alterações silenciosamente. Mudança exige nova conversa confirmada. O prompt nativo é construído pelo motor original; a prévia da demo é identificada como resumo estrutural.

Arquivos de entrada não são interpretados, transcritos ou validados como comprovante. Conteúdo fica só em memória durante o pedido; o histórico guarda metadados. Saídas podem guardar snapshots de anexos privados do rascunho. URLs e uploads globais antigos são apenas referências indisponíveis; não são abertos/buscados nem incluídos como binários no export.

## Isolamento e fronteiras

API `/api/simulator-v2`: GET raiz; POST send/reset/teach/prompt-preview. Dono derivado da sessão, suporte somente leitura, no-store, parâmetros estritos, UUID, CAS/lock, arquivos privados 0600 e proteção contra symlink. Sessão/PIN/conta invalidam dados, respostas e trilhas de microfone. Escritas não renovam autenticação nem são reenviadas automaticamente após 401 ou resultado incerto; consulta manual antes de decidir.

**Composição oficial mantém `allowSessions:false, allowTeach:false`.** Origem cloud não homologada não usa perfil global nem fabrica vazio. Não há ativação, WhatsApp, CRM, alteração de botEnabled, aviso a humano ou provedor real. Nenhum deploy, SQL remoto, commit/push ou cobrança nesta etapa.

## Demo e validação

A revisão estática contém apenas perfil fictício e exemplos pré-calculados pelo motor original em cópia descartável sem dados/env/rede. Mensagem livre ou mídia recebe resposta explicitamente ilustrativa; sem latência inventada. Correções ficam só na memória da página, não reexecutam os exemplos e não passam entre as demos separadas de abas. Isso não substitui a integração nativa, que usa os mesmos repositórios reais.

- **24/24 testes novos**: domínio, runtime, HTTP, repositório, gates e Chromium.
- **91/91 selecionados** de Simulador, Treinamento, Catálogo/Áudios e sessão.
- Build/verificador: **84 assets** estáticos, sem app autenticado, cliente de sessão ou funções.
- Chromium: catálogo/Raio-X, QR decodificado, persistência, ensino compartilhado, versões/prompt, conflito, rede incerta sem replay, troca de sessão, HTML literal, suporte/falha, microfone sintético liberando trilhas e PDF não interpretado. Revisão com CSP real, 1440/390/320 px e dois temas, sem API/rede externa/overflow/erros JS. Não é homologação de microfone físico nem auditoria WCAG integral.

Suíte geral: **679/681**, somente as duas falhas históricas `ienvia-branding.test.mjs` e `static-release-package.test.mjs`. Integridade: ver `simulator-evidence.json` e `simulator-full-suite.log`. As duas falhas históricas de branding/release assinado não são ocultadas.

Preview seguro: `PORT=4179 REVIEW_START_PATH=/simulador/ node scripts/preview-visual-review.mjs`. Somente demo fictícia. Próxima aba: **Inteligência artificial**, mantendo comparação com o original e implantação oficial para depois.
