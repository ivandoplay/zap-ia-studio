# Catálogo, PIX e Áudios — implementação local

Atualizado em 04/11/2026. Próximo bloco autorizado pelo titular após Treinamento. **Criação no workspace; sem implantação oficial ou ativação.** A identidade visual segue Conversas e os menus Catálogo/Áudios continuam separados, como no original.

## Recursos conferidos no original

Referências: `public/painel.html` (abas `tab-catalogo`, `tab-audios` e modais), `public/app.js` (`renderCatalogAndPix`, biblioteca/modal de voz), `src/server.js` (catálogo, PIX e voice-library), normalizadores de `src/storage.js`, `src/pix.js` e `src/audioProcessor.js`.

| Recurso original | Implementação local / limite explícito |
|---|---|
| Produto, serviço, apresentação, categoria, preço textual, descrição e link de compra | Criação/edição, pesquisa, filtro, pausa/ativação e exclusão confirmada no rascunho. Campos futuros e preço não são descartados nem convertidos para valor financeiro inventado. Novos links precisam de HTTPS sem credenciais. |
| Galeria até cinco fotos/PDFs/áudios explicativos | Adição e remoção individual, anexar mantendo os anteriores ou remover todos antes de substituir. Imagens PNG/JPEG/GIF/WebP, PDF e voz OGG/Opus; áudios não canônicos passam pelo conversor original na integração nativa. SVG/HTML não são renderizados como imagem. |
| PIX: tipo/chave, favorecido, banco, cidade, instruções e flags | Todos os controles preservados. Flags `false` continuam falsas. Prévia com QR PNG e código Copia e Cola, sem ativação ou pagamento. |
| PIX EMV/CRC e QR original | Navegador usa cópia gerada de `src/pix.js` e bundle local do mesmo pacote QRCode, com licenças. Backend usa o módulo original. Testes comparam resultados; não existe cálculo financeiro paralelo. |
| Biblioteca de voz: nome, contexto, transcrição, modo IA/manual e vínculo M01… | Editor, filtro, pausa do uso pela IA, exclusão, player dos anexos privados e vínculo com as mensagens aprovadas da própria origem. Vínculos antigos desconhecidos continuam disponíveis para preservar o cadastro. |
| Microfone e arquivo de áudio | Gravação iniciada explicitamente pelo operador, parada/cancelamento liberam tracks; arquivos privados do rascunho podem ser reproduzidos/baixados. Permissão e gravação foram testadas com dispositivo **sintético**, não microfone real. |
| Conversão OGG/Opus e 64 barras | Integração chama `convertToCanonicalWhatsAppVoice` original, valida seu resultado e conserva duração/waveform. Sem FFmpeg, o motor aceita somente OGG/Opus já reconhecido; MP3/WebM não são rotulados como voz convertida. Teste com OGG sintético real exercita o fallback original. Outros formatos e FFmpeg não foram homologados fisicamente aqui. |
| Transcrever automaticamente com IA | Controle preservado, **desabilitado por padrão**. Rota e contrato com porta injetável possuem teste sintético; nenhum provedor/chave real foi consultado. Operador pode digitar a transcrição fiel. |
| Modo puro/híbrido, anti-repetição e texto quando não pode ouvir | Permanecem no motor original, que não foi alterado ou duplicado. A página não envia nada e não fabrica histórico de envio. |
| Backup | JSON de rascunho com metadados, campos futuros e bytes dos anexos novos; ida e volta sem perda. **Não copia arquivos globais/externos instalados no atendimento original**. |

A presença das interfaces e testes locais não é homologação de mensagens, cobrança, envio de PDF/PTT ou IA em produção.

## Arquivos e contratos

- Páginas nativas: `/catalogo/` e `/audios/`, `public/v2/catalog.html` e `audios.html`.
- UI/contrato/adaptadores: `resources-{view,domain,store,app}.js`, `resources.css`.
- PIX gerado: `resources-pix.js`, `resources-qrcode.js` e `RESOURCES-QR-LICENSE.txt`. Sincronizar com `node scripts/build-resources-pix.mjs` se mudar o original ou a dependência; não editar o bundle manualmente.
- Backend: `src/resources/{router,repository}.js`.
- Registro no servidor: **`allowWrites:false`, `allowTranscription:false`**. Não existe rota de ativação ou de envio.
- Origem local explícita por conta. A nuvem sem origem proprietária homologada retorna indisponibilidade; não busca perfil global, não fabrica biblioteca vazia e não usa o cliente administrativo para atalhos de mídia.

O documento `ienvia-resources-draft-v1` contém exclusivamente `catalog`, `pix`, `voiceLibrary` e `assets`. Não inclui ou modifica regras/FAQ/treinamento/provedor. Catálogo/PIX/áudios usam um mesmo documento versionado para que uma aba antiga não sobrescreva mudanças da outra. Revisão/CAS resolve concorrência e alerta quando a origem mudou.

| Método / caminho | Efeito |
|---|---|
| GET `/api/resources-v2` | Origem e rascunho da conta do contexto, revisão, capacidades e mensagens aprovadas disponíveis. |
| PUT `/api/resources-v2/draft` | Salva somente o rascunho privado; exige gate ligado, próprio titular, revisão e UUID de pedido. Gate desligado no registro oficial do código. |
| POST `/api/resources-v2/pix-preview` | QR/código/descrição locais, sem efetuar pagamento ou ativar PIX. |
| POST `/api/resources-v2/prepare-audio` | Conversor original, resposta com bytes canônicos/duração/64 barras, sem instalar áudio no negócio ativo. |
| POST `/api/resources-v2/transcribe` | Bloqueada sem opt-in explícito e transcritor injetado. Teste usa somente função sintética. |

Sessão/PIN/suporte reutilizam o cliente compartilhado. A allowlist é exata; não aceita selecionar `ownerId` por query/body. Mutações não têm refresh/replay automático após 401, offline ou resultado incerto. Master em suporte só lê o alvo autorizado; não grava, prepara áudio ou transcreve. Mudança de sessão/contexto invalida respostas e limpa conteúdo/player/streams.

## Persistência privada e mídia

Repositório local em namespace separado do Treinamento, UUID por arquivo, `0600`, diretório criado `0700`, CAS, último pedido com intenção conferida, lock exclusivo e gravação temporária sincronizada seguida de rename atômico. Locks pendentes não são roubados por tempo; conferência administrativa é manual. Não é uma transação/RLS distribuída homologada.

Anexos ficam como bytes/base64 dentro do documento privado, não em `/uploads` público. São resolvidos por UUID do próprio documento, com assinatura/tamanho/extensão conferidos. Os players usam URLs `blob:` revogadas ao descartar a UI. PDF é download explícito; não é embutido para executar conteúdo. Conferência de formato não é auditoria antivírus nem validação de todo o codec.

**URLs e filenames legados são preservados como metadados, mas não são buscados automaticamente**, nem para thumbnail, reprodução, transcrição ou backup. Isso evita acesso cruzado por filename global e SSRF em URLs importadas. A cópia dos arquivos antigos exige adaptação proprietária da origem na fase oficial; o backup integral original continua no painel existente. Não declarar essa migração binária como concluída nem contornar com leitura do diretório global.

Limites de preparação local: documento JSON até **12 MB**, até 150 anexos novos, cada arquivo até **6 MB**, até cinco mídias por item, profundidade/nós/textos limitados e IDs únicos. O limite agregado inclui base64. Excesso é erro explícito, sem truncar. Textos HTML continuam literais, chaves de protótipo e paths inseguros são recusados.

## Demonstração versus nativo

- **Demo estática:** exemplos fictícios, mudanças apenas em memória e sem API/sessão/banco. O PIX de exemplo usa domínio `.invalid`; não pagar. QR é calculado localmente pelo gerador original. Áudio OGG/Opus pode ser anexado sem inventar duração/onda; outros formatos exigem o conversor nativo. Não há transcrição paga.
- **Nativo sintético:** navegador → sessão → HTTP → arquivo privado descartável, persistência/recarga e conversor original. Prova de integração local, não conexão com conta real.
- **Servidor composto:** escrita e IA desligadas. Backend/SQL remoto, origem proprietária cloud, migração de binários antigos e ativação continuam pendentes para a etapa oficial autorizada posteriormente.

## Evidências

- **26/26 testes novos** em `tests/resources-v2*.test.mjs` (contrato, HTTP, repositório, navegador e gates do servidor real isolado).
- **82/82 selecionados**, incluindo Treinamento, isolamento original, sessão, Campanhas e revisão estática.
- **655/657 suíte geral**: somente as duas falhas históricas `ienvia-branding.test.mjs` e `static-release-package.test.mjs`. Nenhum teste foi alterado para ocultá-las.
- Build/verificador: **78 assets**; pacote estático não contém app autenticado, session-client ou funções.
- Chromium: Catálogo+PIX+PDF privado, OGG sintético real+transcrição manual+M01+64 barras+modo manual+backup binário, recarga, conflito entre abas, perda de sessão, microfone sintético/cancelamento, HTML literal e suporte/falha. Dois temas e 1440/390/320 px, sem sessão/API/erros/overflow na revisão estática. Não é auditoria WCAG completa nem homologação de aparelho físico.

Evidências em `/home/user/auditoria/arquitetura-v2/resources-*`, screenshots `catalogo-1440.png`/`audios-1440.png` e variantes móveis. Preview seguro: `PORT=4178 REVIEW_START_PATH=/catalogo/ node scripts/preview-visual-review.mjs`; serve somente a revisão fictícia e não carrega servidor operacional ou `.env`.

**Próxima aba: Simulador.** Seguir comparando o original, com desenvolvimento local e decisões técnicas delegadas. Sem commit/push, deploy, SQL remoto, plano pago, transcrição real ou envio WhatsApp nesta etapa.

Conferência adicional: CSP publicada permite somente blobs locais para as imagens/áudios anexados (`img-src ... blob:`, `media-src blob:`), mantendo `connect-src 'none'`. Teste Chromium de upload/decodificação de PNG e metadados de OGG foi executado com os headers reais; nenhuma violação de CSP.
