import fs from 'node:fs';
import path from 'node:path';
import { BUNDLED_DATA_DIR, DATA_DIR, UPLOADS_DIR, storage, uid } from './storage.js';
import { extractZipBuffer, createZipBuffer } from './zipReader.js';

export const BUNDLED_PACKS_DIR = path.join(BUNDLED_DATA_DIR, 'training_packs');
export const PACKS_DIR = path.join(DATA_DIR, 'training_packs');
try {
  if (!fs.existsSync(PACKS_DIR)) {
    fs.mkdirSync(PACKS_DIR, { recursive: true });
  }
} catch {}

const memoryCache = new Map();

export function foldPt(str = '') {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const STOPWORDS_PT = new Set([
  'de', 'da', 'do', 'das', 'dos', 'em', 'na', 'no', 'nas', 'nos', 'um', 'uma',
  'uns', 'umas', 'para', 'pra', 'por', 'com', 'sem', 'que', 'se', 'ou', 'e',
  'o', 'a', 'os', 'as', 'ao', 'aos', 'ele', 'ela', 'eles', 'elas', 'isso',
  'isto', 'esse', 'essa', 'este', 'esta', 'como', 'mais', 'muito', 'ja', 'foi',
  'ser', 'sao', 'tem', 'ter', 'vai', 'vou', 'meu', 'minha', 'seu', 'sua', 'nosso'
]);

// Clusters semânticos em PT-BR para conectar sinônimos reais de clientes às skills certas
const INTENT_CLUSTERS = [
  {
    name: 'comercial_preco',
    triggers: ['valor', 'valores', 'preco', 'precos', 'quanto custa', 'mensalidade', 'investimento', 'pacote', 'orcamento', 'desconto', 'parcela', 'comissao', 'gratis', 'gratuito', 'teste gratis', 'cobram', 'verba'],
    boostTerms: ['comercial', 'valores', 'condicoes', 'encaminhar-questao-comercial', 's15', 'r015']
  },
  {
    name: 'trafego_anuncio',
    triggers: ['trafego', 'anuncio', 'anuncios', 'impulsionar', 'ads', 'meta ads', 'google ads', 'campanha', 'patrocinado'],
    boostTerms: ['trafego', 'responder-trafego-pago', 'anuncio', 's03', 'r003', 'o001', 'o002']
  },
  {
    name: 'conteudo_redes',
    triggers: ['post', 'posts', 'postagem', 'conteudo', 'instagram', 'rede social', 'redes sociais', 'perfil', 'reels', 'video', 'story', 'stories', 'feed'],
    boostTerms: ['conteudo', 'redes', 'explicar-conteudo-e-gestao', 's04', 'r004', 'o003']
  },
  {
    name: 'escopo_especifico',
    triggers: ['quantos posts', 'quantas postagens', 'frequencia', 'presencial', 'filmar', 'gravar na loja', 'visita', 'crm', 'integracao', 'rd station', 'prazo', 'contrato'],
    boostTerms: ['delimitar-escopo', 'escopo', 'integracoes', 's29', 'r029', 'o004', 'o005']
  },
  {
    name: 'agencia_atual',
    triggers: ['agencia', 'gestor', 'ja tenho quem faca', 'marketing interno', 'equipe interna', 'social media'],
    boostTerms: ['agencia', 'responder-agencia-existente', 's11', 'o006', 'o007', 'p09']
  },
  {
    name: 'curiosos_fechamento',
    triggers: ['curioso', 'curiosos', 'so pergunta preco', 'nao fecha', 'lead frio', 'conversao', 'atendimento morre', 'vendedor demora'],
    boostTerms: ['curiosos', 'fechamento', 'social selling', 'conversar-sobre-curiosos-e-fechamento', 'p07']
  },
  {
    name: 'parar_optout',
    triggers: ['me remove', 'remove meu numero', 'pare de mandar', 'para de mandar', 'nao mande mais', 'sair da lista', 'bloquear', 'spam', 'apaga meu contato'],
    boostTerms: ['respeitar-pedido-de-parar', 'nao contatar', 'parar', 'r021']
  },
  {
    name: 'recusa_cordial',
    triggers: ['nao tenho interesse', 'sem interesse', 'nao quero', 'no momento nao', 'agora nao', 'estamos atendidos', 'obrigado mas nao'],
    boostTerms: ['encerrar-recusa-sem-insistir', 'recusa', 'r020']
  },
  {
    name: 'canal_texto_ligacao',
    triggers: ['nao liga', 'nao me liga', 'prefiro mensagem', 'prefiro texto', 'por aqui mesmo', 'explica por aqui', 'sem ligacao', 'sem reuniao', 'audio nao'],
    boostTerms: ['respeitar-texto-e-ligacao', 'canal', 'texto', 'm08', 'p11']
  },
  {
    name: 'agenda_horario',
    triggers: ['amanha as', 'hoje as', '15h', '14h', '10h', '16h', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'pode ligar', 'vamos marcar', '15 minutos', 'reuniao'],
    boostTerms: ['receber-preferencia-de-agenda', 'agenda', 'r018', 'm07']
  },
  {
    name: 'engano_compra_carro',
    triggers: ['qual o valor do carro', 'aceita troca', 'financia', 'tabela fipe', 'tem hilux', 'tem civic', 'tem corolla', 'quero comprar um carro', 'entrada de'],
    boostTerms: ['esclarecer-engano-com-compra-de-carro', 'compra de carro', 'veiculo']
  },
  {
    name: 'garantia_prova',
    triggers: ['garantia', 'garante', 'quantas vendas', 'resultado garantido', 'case', 'cases', 'depoimento', 'clientes que atendem', 'prova'],
    boostTerms: ['explicar-garantia-e-provas', 'garantia', 'provas', 'h13', 'p10']
  },
  {
    name: 'identidade_robo',
    triggers: ['robo', 'ia', 'inteligencia artificial', 'automatico', 'bot', 'quem ta falando', 'onde achou meu numero', 'como conseguiu meu contato'],
    boostTerms: ['identidade-e-origem-verificadas', 'h14', 'automacao']
  },
  {
    name: 'vendedor_consultor_autonomo',
    triggers: ['sou vendedor', 'sou consultor', 'trabalho na loja', 'vendo por conta', 'autonomo', 'independente', 'repasse', 'sem loja fisica', 'comissionado'],
    boostTerms: ['atender-consultor-de-vendas', 'atender-vendedor-independente', 's07', 's08', 'p03', 'p04']
  }
];

function tokenizePt(str = '') {
  const folded = foldPt(str);
  return folded
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOPWORDS_PT.has(w));
}

function isBlockedHistoricalPath(relPath = '') {
  const lower = relPath.toLowerCase();
  return (
    lower.startsWith('16-fontes-e-rastreabilidade/') ||
    lower.startsWith('17-revisao/') ||
    lower.includes('nao-enviar') ||
    lower.includes('biblioteca-r4-original') ||
    lower.endsWith('manifesto-de-arquivos.json')
  );
}

function safeParseJson(buf) {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Compila qualquer pacote .ZIP de treinamento (padrão v.turbo ou pacote customizado de outro nicho)
 * em um índice JSON autocontido em data/training_packs/<packId>.json.
 */
export function importTrainingZipBuffer(zipBuffer, originalFilename = 'treinamento.zip', customPackId = null) {
  const extracted = extractZipBuffer(zipBuffer);
  if (!extracted.files.length) {
    throw new Error('O arquivo ZIP não contém documentos válidos.');
  }

  const fileMap = new Map();
  for (const f of extracted.files) {
    fileMap.set(f.relPath, f);
  }

  const readText = (relPath) => fileMap.get(relPath)?.buffer.toString('utf8').trim() || '';
  const findFile = (predicate) => extracted.files.find((f) => !isBlockedHistoricalPath(f.relPath) && predicate(f.relPath));

  // Caso 0: Backup completo exportado pelo próprio ZAP-IA Studio (restauração 100% sem perda!)
  const exportedProfileFile = findFile((p) => p.toLowerCase().endsWith('perfil-zapia-studio.json'));
  const exportedProfileJson = exportedProfileFile ? safeParseJson(exportedProfileFile.buffer) : null;
  const compiledPackFile = findFile((p) => p.toLowerCase().endsWith('zapia-pack-compilado.json'));
  const compiledPackJson = compiledPackFile ? safeParseJson(compiledPackFile.buffer) : null;

  if (compiledPackJson && compiledPackJson.canonicalCore) {
    const restoredPackId =
      customPackId ||
      compiledPackJson.id ||
      foldPt(extracted.rootFolderName || path.basename(originalFilename, '.zip'))
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') ||
      uid('pack');

    const restoredPack = {
      ...compiledPackJson,
      id: restoredPackId,
      importedAt: new Date().toISOString()
    };
    persistTrainingPack(restoredPack);

    const baseSuggested = buildSuggestedProfileFromPack(restoredPack);
    const mergedSuggested = exportedProfileJson
      ? {
          ...baseSuggested,
          ...exportedProfileJson,
          trainingPackId: restoredPackId
        }
      : baseSuggested;

    // Restaura eventuais áudios estratégicos (.ogg) incluídos no pacote .ZIP
    for (const f of extracted.files) {
      if (f.relPath.toLowerCase().includes('05-audios-estrategicos/') && f.relPath.toLowerCase().endsWith('.ogg')) {
        const safeFn = path.basename(f.relPath);
        if (safeFn) {
          try { fs.writeFileSync(path.join(UPLOADS_DIR, safeFn), f.buffer); } catch {}
        }
      }
    }

    return {
      packSummary: summarizePack(restoredPack),
      suggestedProfile: mergedSuggested
    };
  }

  // Metadados base
  const resumoJsonFile = findFile((p) => p.toLowerCase().endsWith('resumo-do-treinamento.json'));
  const resumoMeta = resumoJsonFile ? safeParseJson(resumoJsonFile.buffer) : null;

  const fatosJsonFile = findFile((p) => p.toLowerCase().endsWith('fatos-do-negocio.json'));
  const businessFacts = fatosJsonFile ? safeParseJson(fatosJsonFile.buffer) : null;

  // Documentos canônicos principais
  const canonicalRulesFile = findFile((p) => /^00-regras-canonicas/i.test(path.basename(p)));
  const mainPromptFile = findFile((p) => /^prompt-principal/i.test(path.basename(p)));
  const playbookFile = findFile((p) => /^playbook-central/i.test(path.basename(p)));
  const howToDeliverFile = findFile((p) => /^como-entregar-a-outra-ia/i.test(path.basename(p)));

  const businessDocs = extracted.files
    .filter((f) => /^01-negocio\/.*\.md$/i.test(f.relPath))
    .sort((a, b) => a.relPath.localeCompare(b.relPath))
    .map((f) => ({ path: f.relPath, content: f.buffer.toString('utf8').trim() }));

  const behaviorDocs = extracted.files
    .filter((f) => /^02-comportamento\/.*\.md$/i.test(f.relPath))
    .sort((a, b) => a.relPath.localeCompare(b.relPath))
    .map((f) => ({ path: f.relPath, content: f.buffer.toString('utf8').trim() }));

  const humanizationCoreDocs = extracted.files
    .filter((f) => /^12-humanizacao\/0[123]-.*\.md$/i.test(f.relPath))
    .sort((a, b) => a.relPath.localeCompare(b.relPath))
    .map((f) => ({ path: f.relPath, content: f.buffer.toString('utf8').trim() }));

  // Mensagens aprovadas literais (ex: M01-M13)
  const approvedRulesFile = findFile((p) => p.toLowerCase().endsWith('como-usar-os-originais.md'));
  const approvedJsonFile = findFile((p) => /m01-.*originais\.json$/i.test(p));
  const approvedRaw = approvedJsonFile ? safeParseJson(approvedJsonFile.buffer) : null;
  const approvedMessages = [];
  if (approvedRaw?.textos) {
    for (const [code, text] of Object.entries(approvedRaw.textos)) {
      approvedMessages.push({
        id: code,
        title: approvedRaw.titulos?.[code] || code,
        text
      });
    }
  }

  // Skills operacionais (03-skills/indice-skills.json + SKILL.md)
  const opIndexFile = findFile((p) => p.toLowerCase().endsWith('03-skills/indice-skills.json'));
  const opIndexArr = opIndexFile ? safeParseJson(opIndexFile.buffer) || [] : [];
  const operationalSkills = [];
  const indexedSkillPaths = new Set();

  for (const item of opIndexArr) {
    const bodyMd = item.path ? readText(item.path) : '';
    if (item.path) indexedSkillPaths.add(item.path);
    operationalSkills.push({
      id: item.id || uid('S'),
      name: item.name || 'skill',
      when: item.when || '',
      example_response: item.example_response || '',
      bodyMd,
      searchBlob: foldPt(`${item.id} ${item.name} ${item.when} ${item.example_response} ${bodyMd}`)
    });
  }

  // Captura também qualquer SKILL.md avulsa em pacotes customizados de outros nichos
  for (const f of extracted.files) {
    if (isBlockedHistoricalPath(f.relPath)) continue;
    if (
      f.relPath.toLowerCase().endsWith('/skill.md') &&
      !f.relPath.toLowerCase().startsWith('12-humanizacao/') &&
      !indexedSkillPaths.has(f.relPath)
    ) {
      const bodyMd = f.buffer.toString('utf8').trim();
      const folderName = path.basename(path.dirname(f.relPath));
      operationalSkills.push({
        id: `SK_${operationalSkills.length + 1}`,
        name: folderName,
        when: folderName.replace(/-/g, ' '),
        example_response: '',
        bodyMd,
        searchBlob: foldPt(`${folderName} ${bodyMd}`)
      });
      indexedSkillPaths.add(f.relPath);
    }
  }

  // Skills de humanização (12-humanizacao/indice-skills-humanizacao.json + SKILL.md)
  const humIndexFile = findFile((p) => p.toLowerCase().endsWith('indice-skills-humanizacao.json'));
  const humIndexArr = humIndexFile ? safeParseJson(humIndexFile.buffer) || [] : [];
  const humanizationSkills = humIndexArr.map((h) => {
    const bodyMd = h.path ? readText(h.path) : '';
    return {
      id: h.id || uid('H'),
      name: h.name || '',
      trigger: h.trigger || '',
      goal: h.goal || '',
      avoid: h.avoid || '',
      bad_response: h.bad_response || '',
      better_response: h.better_response || '',
      bodyMd,
      searchBlob: foldPt(`${h.id} ${h.name} ${h.trigger} ${h.goal} ${h.case || ''} ${bodyMd}`)
    };
  });

  // Respostas condicionais de referência (04-respostas/respostas-de-referencia.json)
  const refRespFile = findFile((p) => p.toLowerCase().endsWith('respostas-de-referencia.json'));
  const refRespArr = refRespFile ? safeParseJson(refRespFile.buffer) || [] : [];
  const referenceResponses = refRespArr.map((r) => ({
    id: r.id,
    title: r.title || '',
    when: r.when || '',
    example_input: r.example_input || '',
    customer_messages: Array.isArray(r.customer_messages) ? r.customer_messages : [],
    skill_id: r.skill_id || '',
    caution: r.caution || '',
    recommended_behavior: r.recommended_behavior || 'responder',
    searchBlob: foldPt(`${r.id} ${r.title} ${r.when} ${r.example_input} ${(r.customer_messages || []).join(' ')}`)
  }));

  // Matriz de dúvidas e objeções (04-respostas/matriz-de-duvidas-e-objecoes.json)
  const objFile = findFile((p) => p.toLowerCase().endsWith('matriz-de-duvidas-e-objecoes.json'));
  const objArr = objFile ? safeParseJson(objFile.buffer) || [] : [];
  const objections = objArr.map((o) => ({
    id: o.id,
    input_pattern: o.input_pattern || '',
    nature: o.nature || '',
    skill_id: o.skill_id || '',
    response_strategy: o.response_strategy || '',
    avoid: o.avoid || '',
    searchBlob: foldPt(`${o.id} ${o.input_pattern} ${o.nature} ${o.response_strategy}`)
  }));

  // Personas e filtros de voz (11-personas/indice-personas.json)
  const personasFile = findFile((p) => p.toLowerCase().endsWith('indice-personas.json'));
  const personasJson = personasFile ? safeParseJson(personasFile.buffer) || {} : {};
  const voiceFilters = Array.isArray(personasJson.voice_filters) ? personasJson.voice_filters : [];
  const interlocutorPersonas = (personasJson.interlocutor_profiles || []).map((ip) => {
    const bodyMd = ip.path ? readText(ip.path) : '';
    return {
      id: ip.id,
      name: ip.name || '',
      signals: ip.signals || '',
      bodyMd,
      searchBlob: foldPt(`${ip.id} ${ip.name} ${ip.signals} ${bodyMd}`)
    };
  });

  // Bom vs Ruim (06-treinamento/bom-versus-ruim.json)
  const goodBadFile = findFile((p) => p.toLowerCase().endsWith('bom-versus-ruim.json'));
  const goodBadArr = goodBadFile ? safeParseJson(goodBadFile.buffer) || [] : [];
  const goodBadPairs = goodBadArr.map((b) => ({
    id: b.id,
    title: b.title || '',
    context: b.context || '',
    do_not_use: b.do_not_use || '',
    better_response: b.better_response || '',
    lesson: b.lesson || '',
    searchBlob: foldPt(`${b.title} ${b.context} ${b.lesson}`)
  }));

  // Conversas aplicadas (14-conversas-aplicadas/conversas-aplicadas.json)
  const convFile = findFile((p) => p.toLowerCase().endsWith('conversas-aplicadas.json'));
  const convArr = convFile ? safeParseJson(convFile.buffer) || [] : [];
  const appliedConversations = convArr.slice(0, 50).map((c) => ({
    id: c.id,
    title: c.title || '',
    setup: c.setup || '',
    turns: Array.isArray(c.turns) ? c.turns : [],
    searchBlob: foldPt(`${c.title} ${c.setup} ${(c.turns || []).map((t) => t.text).join(' ')}`)
  }));

  // Suporte universal a ZIPs simples de outros nichos (sem pastas numeradas 01-negocio/02-comportamento)
  const genericDocs = [];
  if (!mainPromptFile && businessDocs.length === 0) {
    for (const f of extracted.files) {
      if (isBlockedHistoricalPath(f.relPath)) continue;
      if (indexedSkillPaths.has(f.relPath)) continue;
      if (/\.(md|txt|csv)$/i.test(f.relPath)) {
        genericDocs.push({
          path: f.relPath,
          content: f.buffer.toString('utf8').slice(0, 12000).trim()
        });
      }
    }
  }

  const packId =
    customPackId ||
    foldPt(extracted.rootFolderName || path.basename(originalFilename, '.zip'))
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') ||
    uid('pack');

  const displayName =
    businessFacts?.commercial_name_from_approved_material && businessFacts?.representative
      ? `${businessFacts.representative} · ${businessFacts.commercial_name_from_approved_material} (${businessFacts.version || 'v.turbo'})`
      : extracted.rootFolderName || path.basename(originalFilename, '.zip');

  const packData = {
    id: packId,
    name: displayName,
    version: businessFacts?.version || resumoMeta?.version || '1.0',
    originalFilename,
    importedAt: new Date().toISOString(),
    stats: {
      totalFilesInZip: extracted.fileCount,
      operationalSkillsCount: operationalSkills.length,
      humanizationSkillsCount: humanizationSkills.length,
      referenceResponsesCount: referenceResponses.length,
      objectionsCount: objections.length,
      approvedMessagesCount: approvedMessages.length,
      personasCount: interlocutorPersonas.length,
      voiceFiltersCount: voiceFilters.length,
      conversationsCount: appliedConversations.length,
      goodBadCount: goodBadPairs.length + humanizationSkills.filter((h) => h.bad_response).length
    },
    businessFacts,
    canonicalCore: {
      canonicalRulesMd: canonicalRulesFile ? readText(canonicalRulesFile.relPath) : '',
      mainPromptMd: mainPromptFile ? readText(mainPromptFile.relPath) : '',
      playbookMd: playbookFile ? readText(playbookFile.relPath) : '',
      howToDeliverMd: howToDeliverFile ? readText(howToDeliverFile.relPath) : '',
      businessDocs,
      behaviorDocs,
      humanizationCoreDocs,
      approvedRulesMd: approvedRulesFile ? readText(approvedRulesFile.relPath) : '',
      approvedMessages,
      voiceFilters,
      genericDocs: genericDocs.slice(0, 12)
    },
    operationalSkills,
    humanizationSkills,
    referenceResponses,
    objections,
    interlocutorPersonas,
    goodBadPairs,
    appliedConversations
  };

  persistTrainingPack(packData);

  // Gera perfil sugerido já pronto para ativar (mesclando backup do Studio se presente)
  const baseSuggested = buildSuggestedProfileFromPack(packData);
  const suggestedProfile = exportedProfileJson
    ? { ...baseSuggested, ...exportedProfileJson, trainingPackId: packId }
    : baseSuggested;

  return {
    packSummary: summarizePack(packData),
    suggestedProfile
  };
}

export function buildSuggestedProfileFromPack(packData) {
  const bf = packData.businessFacts || {};
  const isLizandroPack = Boolean(bf.representative && bf.representative.includes('Lizandro'));

  if (isLizandroPack) {
    return {
      name: `${bf.commercial_name_from_approved_material || 'Alavancagem de Vendas'} — ${bf.representative}`,
      niche: 'Assessoria Comercial & Marketing p/ Mercado de Veículos',
      assistantName: 'Equipe do Lizandro',
      tone: 'consultivo',
      lockUntilManualResume: true,
      silentOnUnknownIntent: true,
      trainingPackId: packData.id,
      companySummary:
        'Assessoria de Lizandro Celestino (Alavancagem de Vendas) especializada no mercado de veículos (lojas, revendas, concessionárias, vendedores independentes e consultores). O trabalho reúne gestão da presença nas redes sociais, produção e publicação de conteúdo, divulgação dos veículos, tráfego pago com campanhas personalizadas por veículo, técnicas de vendas/social selling e acompanhamento/suporte.',
      deliveryAndPayment:
        'Valores, verba de anúncios, mensalidade e condições comerciais são respondidos pessoalmente por Lizandro (a IA nunca informa estimativa, faixa, comissão ou gratuidade). Conhecer por mensagem aqui no WhatsApp ou conversar cerca de 15 minutos por ligação são caminhos igualmente válidos, sem pressão.',
      goldenRules: [
        '1. Pedido para parar ("me remove", "pare de mandar"): reconhecer uma vez, encerrar sem insistir e acionar [[PARAR_CONTATO:Pedido de parar]].',
        '2. Recusa da oferta ("não tenho interesse", "no momento não"): agradecer uma única vez sem contra-argumentar e acionar [[ENCERRAR_CONTATO:Recusa da oferta]].',
        '3. Valores/condições comerciais, desejo de contratar ou escopo específico não confirmado (frequência de posts, filmagem presencial, integrações, prazos): responder sem exigir qualificação prévia e passar para Lizandro com [[CHAMAR_HUMANO:motivo]].',
        '4. Intenção não compreendida com segurança ou mídia ambígua sem contexto: NÃO enviar nenhum texto automático pedindo para reformular; acionar exclusivamente [[PAUSA_SILENCIOSA:Intenção não compreendida]] para Lizandro revisar em silêncio.',
        '5. Responder à dúvida real primeiro usando apenas fatos confirmados; fazer no máximo uma pergunta útil quando houver abertura, sem repetir o que já foi dito.',
        '6. Não vender veículos em nome das lojas, não prometer quantidade de vendas/leads e não inventar cases, agenda ou origem do contato.'
      ].join('\n'),
      extraInstructions:
        'Filtros de postura: firmeza sem arrogância (Harvey), atenção ao que foi realmente dito sem leitura de pensamentos (Jane) e convicção restrita apenas ao que é verdadeiro (Belfort). Postura 100% humana: jamais revele, admita ou dê a entender que é IA, robô ou atendimento automático; converse sempre como membro real da equipe comercial do Lizandro.',
      faqs: [
        {
          id: uid('faq'),
          question: 'É só tráfego pago / anúncios?',
          answer:
            'O tráfego pago faz parte, com campanhas pensadas para cada veículo, mas o trabalho é mais amplo: inclui também cuidado com a presença nas redes sociais, produção e publicação de conteúdo e apoio às estratégias de vendas/social selling e acompanhamento.'
        },
        {
          id: uid('faq'),
          question: 'Vocês também produzem e postam o conteúdo?',
          answer:
            'Sim, fazemos produção e publicação de conteúdo além da gestão da presença nas redes, conectando isso à divulgação dos veículos e ao aproveitamento comercial dos contatos. Formatos e frequência específicos são alinhados diretamente com o Lizandro.'
        },
        {
          id: uid('faq'),
          question: 'Qual o valor mensal / investimento?',
          answer:
            'Essa parte de valores e formato comercial precisa ser alinhada diretamente com o Lizandro. Vou deixar sua pergunta organizada para ele continuar com você por aqui! [[CHAMAR_HUMANO:Interessado perguntou valores/condições comerciais]]'
        }
      ]
    };
  }

  return {
    name: packData.name,
    niche: 'Treinamento Avançado (.ZIP)',
    assistantName: 'Assistente',
    tone: 'consultivo',
    lockUntilManualResume: true,
    silentOnUnknownIntent: true,
    trainingPackId: packData.id,
    companySummary: `Base de conhecimento estruturada importada do pacote ${packData.originalFilename} (${packData.stats.totalFilesInZip} arquivos).`,
    deliveryAndPayment: 'Siga estritamente os limites comerciais definidos nos documentos canônicos do pacote.',
    goldenRules: 'Respeite integralmente a precedência canônica, as skills operacionais e os limites do pacote importado.',
    extraInstructions: '',
    faqs: []
  };
}

export function summarizePack(packData) {
  if (!packData) return null;
  return {
    id: packData.id,
    name: packData.name,
    version: packData.version,
    originalFilename: packData.originalFilename,
    importedAt: packData.importedAt,
    stats: packData.stats,
    approvedMessages: packData.canonicalCore?.approvedMessages || [],
    sampleSkills: (packData.operationalSkills || []).slice(0, 16).map((s) => ({
      id: s.id,
      name: s.name,
      when: s.when
    })),
    sampleHumanizationSkills: (packData.humanizationSkills || []).slice(0, 12).map((h) => ({
      id: h.id,
      name: h.name,
      trigger: h.trigger
    }))
  };
}

function sanitizePackId(rawId = '') {
  return path.basename(String(rawId || '')).replace(/[^a-zA-Z0-9._-]/g, '');
}

export function getTrainingPack(packId) {
  const safeId = sanitizePackId(packId);
  if (!safeId) return null;

  // 1. Pacote isolado por conta na nuvem (Supabase custom_pack / storage.data.customPacks)
  const tenantPacks = storage?.data?.customPacks;
  if (tenantPacks && typeof tenantPacks === 'object' && tenantPacks[safeId]) {
    return tenantPacks[safeId];
  }

  // 2. Contas secundárias na nuvem NUNCA acessam pacotes privados embutidos da conta Master
  if (storage?.isCloudTenant && storage?.userRole !== 'master') {
    return null;
  }

  if (memoryCache.has(safeId)) return memoryCache.get(safeId);
  for (const dir of [PACKS_DIR, BUNDLED_PACKS_DIR]) {
    const filePath = path.join(dir, `${safeId}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        memoryCache.set(safeId, parsed);
        return parsed;
      } catch {}
    }
  }
  return null;
}

export function listTrainingPacks() {
  const seen = new Set();
  const summaries = [];

  const tenantPacks = storage?.data?.customPacks;
  if (tenantPacks && typeof tenantPacks === 'object') {
    for (const [id, pack] of Object.entries(tenantPacks)) {
      if (pack && !seen.has(id)) {
        seen.add(id);
        summaries.push(summarizePack(pack));
      }
    }
  }

  if (!storage?.isCloudTenant || storage?.userRole === 'master') {
    for (const dir of [PACKS_DIR, BUNDLED_PACKS_DIR]) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
      for (const f of files) {
        const id = path.basename(f, '.json');
        if (seen.has(id)) continue;
        const pack = getTrainingPack(id);
        if (pack) {
          seen.add(id);
          summaries.push(summarizePack(pack));
        }
      }
    }
  }

  return summaries;
}

function persistTrainingPack(packData) {
  const safeId = sanitizePackId(packData?.id);
  if (!packData || !safeId) return null;
  packData.id = safeId;
  packData.stats = {
    ...(packData.stats || {}),
    approvedMessagesCount: (packData.canonicalCore?.approvedMessages || []).length,
    operationalSkillsCount: (packData.operationalSkills || []).length,
    humanizationSkillsCount: (packData.humanizationSkills || []).length
  };

  if (storage?.data) {
    storage.data.customPacks = storage.data.customPacks || {};
    storage.data.customPacks[safeId] = packData;
    storage.writeNow();
  }

  if (!storage?.isCloudTenant) {
    try {
      const outPath = path.join(PACKS_DIR, `${safeId}.json`);
      fs.writeFileSync(outPath, JSON.stringify(packData, null, 2), 'utf8');
      memoryCache.set(safeId, packData);
    } catch {}
  }

  return packData;
}

export function getFullTrainingPackDetails(packId) {
  const pack = getTrainingPack(packId);
  if (!pack) return null;
  return {
    id: pack.id,
    name: pack.name,
    version: pack.version,
    originalFilename: pack.originalFilename,
    stats: pack.stats,
    approvedMessages: pack.canonicalCore?.approvedMessages || [],
    operationalSkills: (pack.operationalSkills || []).map((s) => ({
      id: s.id,
      name: s.name,
      when: s.when || '',
      example_response: s.example_response || '',
      bodyMd: s.bodyMd || ''
    })),
    humanizationSkills: (pack.humanizationSkills || []).map((h) => ({
      id: h.id,
      name: h.name,
      trigger: h.trigger || '',
      goal: h.goal || '',
      avoid: h.avoid || '',
      bad_response: h.bad_response || '',
      better_response: h.better_response || ''
    })),
    objectionsCount: (pack.objections || []).length,
    personasCount: (pack.interlocutorPersonas || []).length,
    goodBadCount: (pack.goodBadPairs || []).length
  };
}

export function saveApprovedMessage(packId, payload = {}) {
  const pack = getTrainingPack(packId);
  if (!pack) throw new Error('Pacote de treinamento não encontrado.');
  pack.canonicalCore = pack.canonicalCore || {};
  pack.canonicalCore.approvedMessages = pack.canonicalCore.approvedMessages || [];

  const list = pack.canonicalCore.approvedMessages;
  const cleanId = String(payload.id || `M${String(list.length + 1).padStart(2, '0')}`).trim().toUpperCase();
  const entry = {
    id: cleanId,
    title: String(payload.title || 'Mensagem Aprovada').trim(),
    text: String(payload.text || '').trim(),
    usage: String(payload.usage || 'Uso condicional aprovado').trim()
  };
  if (!entry.text) throw new Error('Digite o texto da mensagem aprovada.');

  const idx = list.findIndex((m) => m.id === cleanId);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...entry };
  } else {
    list.push(entry);
  }
  persistTrainingPack(pack);
  return getFullTrainingPackDetails(packId);
}

export function deleteApprovedMessage(packId, msgId) {
  const pack = getTrainingPack(packId);
  if (!pack) throw new Error('Pacote de treinamento não encontrado.');
  if (pack.canonicalCore?.approvedMessages) {
    pack.canonicalCore.approvedMessages = pack.canonicalCore.approvedMessages.filter((m) => m.id !== msgId);
    persistTrainingPack(pack);
  }
  return getFullTrainingPackDetails(packId);
}

export function savePackSkill(packId, payload = {}) {
  const pack = getTrainingPack(packId);
  if (!pack) throw new Error('Pacote de treinamento não encontrado.');
  const skillType = payload.type === 'humanization' ? 'humanization' : 'operational';

  if (skillType === 'humanization') {
    pack.humanizationSkills = pack.humanizationSkills || [];
    const cleanId = String(payload.id || `H${String(pack.humanizationSkills.length + 1).padStart(2, '0')}`).trim().toUpperCase();
    const item = {
      id: cleanId,
      name: String(payload.name || 'nova-skill-humanizacao').trim(),
      trigger: String(payload.trigger || payload.when || '').trim(),
      goal: String(payload.goal || '').trim(),
      avoid: String(payload.avoid || '').trim(),
      bad_response: String(payload.bad_response || '').trim(),
      better_response: String(payload.better_response || payload.example_response || '').trim()
    };
    item.searchBlob = foldPt(`${item.id} ${item.name} ${item.trigger} ${item.goal} ${item.avoid} ${item.better_response}`);
    const idx = pack.humanizationSkills.findIndex((h) => h.id === cleanId);
    if (idx >= 0) pack.humanizationSkills[idx] = { ...pack.humanizationSkills[idx], ...item };
    else pack.humanizationSkills.push(item);
  } else {
    pack.operationalSkills = pack.operationalSkills || [];
    const cleanId = String(payload.id || `S${String(pack.operationalSkills.length + 1).padStart(2, '0')}`).trim().toUpperCase();
    const cleanName = String(payload.name || 'nova-skill-operacional').trim();
    const when = String(payload.when || '').trim();
    const example = String(payload.example_response || '').trim();
    const bodyMd = String(payload.bodyMd || '').trim() || [
      `# ${cleanId} — ${cleanName}`,
      when ? `\n## Quando acionar\n${when}` : '',
      example ? `\n## Exemplo de conduta\n${example}` : ''
    ].filter(Boolean).join('\n');

    const item = {
      id: cleanId,
      name: cleanName,
      when,
      example_response: example,
      bodyMd,
      searchBlob: foldPt(`${cleanId} ${cleanName} ${when} ${example} ${bodyMd}`)
    };
    const idx = pack.operationalSkills.findIndex((s) => s.id === cleanId);
    if (idx >= 0) pack.operationalSkills[idx] = { ...pack.operationalSkills[idx], ...item };
    else pack.operationalSkills.push(item);
  }

  persistTrainingPack(pack);
  return getFullTrainingPackDetails(packId);
}

export function deletePackSkill(packId, skillId, skillType = 'operational') {
  const pack = getTrainingPack(packId);
  if (!pack) throw new Error('Pacote de treinamento não encontrado.');
  if (skillType === 'humanization') {
    pack.humanizationSkills = (pack.humanizationSkills || []).filter((h) => h.id !== skillId);
  } else {
    pack.operationalSkills = (pack.operationalSkills || []).filter((s) => s.id !== skillId);
  }
  persistTrainingPack(pack);
  return getFullTrainingPackDetails(packId);
}

export function exportProfileBundleZip(profile) {
  const slug = foldPt(profile.name || 'perfil-zapia').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'perfil-zapia';
  const root = `PACOTE-${slug.toUpperCase()}`;
  const entries = [];

  entries.push({
    path: `${root}/manifest.json`,
    content: JSON.stringify(
      {
        name: profile.name,
        version: 'v.studio-export',
        exportedAt: new Date().toISOString(),
        niche: profile.niche,
        assistantName: profile.assistantName
      },
      null,
      2
    )
  });

  entries.push({
    path: `${root}/perfil-zapia-studio.json`,
    content: JSON.stringify(profile, null, 2)
  });

  entries.push({
    path: `${root}/00-nucleo/prompt-principal.md`,
    content: [
      `# ${profile.name} (${profile.niche})`,
      `\n## Sobre o Negócio\n${profile.companySummary || ''}`,
      `\n## Regras de Ouro\n${profile.goldenRules || ''}`,
      `\n## Condições Comerciais & Funcionamento\n${profile.deliveryAndPayment || ''}`,
      profile.extraInstructions ? `\n## Instruções Extras\n${profile.extraInstructions}` : ''
    ].filter(Boolean).join('\n')
  });

  if (profile.faqs?.length) {
    entries.push({
      path: `${root}/01-negocio/perguntas-frequentes.md`,
      content: profile.faqs.map((f, i) => `### ${i + 1}. ${f.question}\n${f.answer}`).join('\n\n')
    });
  }

  for (const doc of profile.knowledgeDocs || []) {
    const safeTitle = foldPt(doc.title || 'doc').replace(/[^a-z0-9._-]+/g, '-') || 'documento.md';
    entries.push({
      path: `${root}/01-negocio/anexos/${safeTitle.endsWith('.md') || safeTitle.endsWith('.txt') ? safeTitle : `${safeTitle}.md`}`,
      content: doc.content || ''
    });
  }

  for (const v of profile.voiceLibrary || []) {
    const safeFn = path.basename(String(v?.filename || ''));
    if (!safeFn) continue;
    const fp = path.join(UPLOADS_DIR, safeFn);
    if (fs.existsSync(fp)) {
      try {
        entries.push({
          path: `${root}/05-audios-estrategicos/${safeFn}`,
          content: fs.readFileSync(fp)
        });
      } catch {}
    }
  }

  const pack = profile.trainingPackId ? getTrainingPack(profile.trainingPackId) : null;
  if (pack) {
    entries.push({
      path: `${root}/zapia-pack-compilado.json`,
      content: JSON.stringify(pack, null, 2)
    });
    if (pack.canonicalCore?.approvedMessages?.length) {
      entries.push({
        path: `${root}/03-mensagens-aprovadas/mensagens-originais.json`,
        content: JSON.stringify({ messages: pack.canonicalCore.approvedMessages }, null, 2)
      });
    }
    for (const s of pack.operationalSkills || []) {
      const safeName = foldPt(`${s.id}-${s.name}`).replace(/[^a-z0-9-]+/g, '-');
      entries.push({
        path: `${root}/04-skills/${safeName}/SKILL.md`,
        content: s.bodyMd || `# ${s.id} — ${s.name}\n\nQuando: ${s.when || ''}\n\nExemplo: ${s.example_response || ''}`
      });
    }
    if (pack.humanizationSkills?.length) {
      entries.push({
        path: `${root}/12-humanizacao/skills-humanizacao.json`,
        content: JSON.stringify({ skills: pack.humanizationSkills }, null, 2)
      });
    }
    if (pack.objections?.length) {
      entries.push({
        path: `${root}/07-objecoes/matriz-objecoes.json`,
        content: JSON.stringify({ items: pack.objections }, null, 2)
      });
    }
  }

  return {
    filename: `${root}.zip`,
    buffer: createZipBuffer(entries)
  };
}

function scoreItem(searchBlob, tokens, fullFoldedQuery, boostedTerms) {
  if (!searchBlob) return 0;
  let score = 0;
  for (const tok of tokens) {
    if (searchBlob.includes(tok)) {
      score += tok.length >= 5 ? 3 : 1.5;
    }
  }
  // Bônus por bigramas exatos
  for (let i = 0; i < tokens.length - 1; i++) {
    const bi = `${tokens[i]} ${tokens[i + 1]}`;
    if (searchBlob.includes(bi)) score += 5;
  }
  // Bônus por clusters de intenção semântica
  for (const bt of boostedTerms) {
    if (searchBlob.includes(bt)) score += 6;
  }
  if (fullFoldedQuery.length >= 4 && searchBlob.includes(fullFoldedQuery)) {
    score += 10;
  }
  return score;
}

/**
 * Seleciona cirurgicamente o núcleo canônico + as Skills Operacionais, Skills de Humanização,
 * Personas, Matriz de Objeções e Respostas de Referência mais relevantes para a mensagem atual.
 */
export function selectTurnPackContext(packId, { userText = '', history = [], hasAudio = false, hasImage = false } = {}) {
  const pack = getTrainingPack(packId);
  if (!pack) return null;

  const recentText = [
    ...history.slice(-3).map((m) => m.text || ''),
    userText || ''
  ].join(' ');

  const foldedCurrent = foldPt(userText);
  const foldedContext = foldPt(recentText);
  const tokens = tokenizePt(`${userText} ${userText} ${recentText}`); // Peso duplo na fala atual

  const boostedTerms = new Set();
  for (const cluster of INTENT_CLUSTERS) {
    if (cluster.triggers.some((t) => foldedCurrent.includes(t) || foldedContext.includes(t))) {
      for (const bt of cluster.boostTerms) boostedTerms.add(bt);
    }
  }

  if (hasAudio) {
    boostedTerms.add('audio');
    boostedTerms.add('continuar-depois-de-audio-explicativo');
    boostedTerms.add('tratar-midia-com-seguranca');
  }
  if (hasImage) {
    boostedTerms.add('midia');
    boostedTerms.add('tratar-midia-com-seguranca');
  }
  if (tokens.length <= 2 && /^(sim|pode|ok|beleza|claro|nao|os dois|ambos|uhum|bora)\b/.test(foldedCurrent)) {
    boostedTerms.add('interpretar-sim-com-contexto');
    boostedTerms.add('s05');
    boostedTerms.add('h03');
  }

  const boostList = Array.from(boostedTerms);

  const topOpSkills = [...(pack.operationalSkills || [])]
    .map((s) => ({ item: s, score: scoreItem(s.searchBlob, tokens, foldedCurrent, boostList) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .filter((x, idx) => x.score > 0 || idx < 2)
    .map((x) => x.item);

  const topHumSkills = [...(pack.humanizationSkills || [])]
    .map((h) => ({ item: h, score: scoreItem(h.searchBlob, tokens, foldedCurrent, boostList) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .filter((x, idx) => x.score > 0 || idx < 2)
    .map((x) => x.item);

  const topRefs = [...(pack.referenceResponses || [])]
    .map((r) => ({ item: r, score: scoreItem(r.searchBlob, tokens, foldedCurrent, boostList) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .filter((x) => x.score > 0)
    .map((x) => x.item);

  const topObjections = [...(pack.objections || [])]
    .map((o) => ({ item: o, score: scoreItem(o.searchBlob, tokens, foldedCurrent, boostList) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .filter((x) => x.score > 0)
    .map((x) => x.item);

  const topPersonas = [...(pack.interlocutorPersonas || [])]
    .map((p) => ({ item: p, score: scoreItem(p.searchBlob, tokens, foldedCurrent, boostList) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .filter((x) => x.score > 0)
    .map((x) => x.item);

  const topGoodBad = [...(pack.goodBadPairs || [])]
    .map((g) => ({ item: g, score: scoreItem(g.searchBlob, tokens, foldedCurrent, boostList) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .filter((x) => x.score > 0)
    .map((x) => x.item);

  const topConv = [...(pack.appliedConversations || [])]
    .map((c) => ({ item: c, score: scoreItem(c.searchBlob, tokens, foldedCurrent, boostList) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 1)
    .filter((x) => x.score > 2)
    .map((x) => x.item);

  const cc = pack.canonicalCore || {};

  // Monta Bloco Canônico (Camada 1 — Sempre ativa)
  const canonicalSections = [];
  if (cc.mainPromptMd) canonicalSections.push(cc.mainPromptMd);
  if (cc.playbookMd) canonicalSections.push(cc.playbookMd);
  if (cc.businessDocs?.length) {
    canonicalSections.push(
      '## FATOS E LIMITES CONFIRMADOS DO NEGÓCIO (01-negocio)\n' +
        cc.businessDocs.map((d) => d.content).join('\n\n')
    );
  }
  if (cc.behaviorDocs?.length) {
    canonicalSections.push(
      '## REGRAS DE COMPORTAMENTO E PAUSA SILENCIOSA (02-comportamento)\n' +
        cc.behaviorDocs.map((d) => d.content).join('\n\n')
    );
  }
  if (cc.humanizationCoreDocs?.length) {
    canonicalSections.push(
      '## DIRETRIZES DE VOZ NATURAL E REVISÃO (12-humanizacao)\n' +
        cc.humanizationCoreDocs.map((d) => d.content).join('\n\n')
    );
  }
  if (cc.voiceFilters?.length) {
    canonicalSections.push(
      '## FILTROS DE COMPORTAMENTO DE VOZ (NÃO SÃO IDENTIDADES)\n' +
        cc.voiceFilters
          .map((v) => `- ${v.name}: ${v.purpose} Limite: ${v.boundary || ''}`)
          .join('\n')
    );
  }
  if (cc.approvedMessages?.length) {
    canonicalSections.push(
      '## TEXTOS ORIGINAIS APROVADOS (M01–M13 — USO CONDICIONAL ESTRITO)\n' +
        (cc.approvedRulesMd ? `${cc.approvedRulesMd}\n\n` : '') +
        cc.approvedMessages
          .map((m) => `• ${m.id} (${m.title}): "${m.text}"`)
          .join('\n')
    );
  }
  if (cc.genericDocs?.length) {
    canonicalSections.push(
      '## DOCUMENTOS DO PACOTE DE TREINAMENTO\n' +
        cc.genericDocs.map((d) => `### ${d.path}\n${d.content}`).join('\n\n')
    );
  }

  // Monta Bloco Dinâmico da Rodada (Camada 2 — Skills e Referências ativadas para esta fala)
  const dynamicSections = [];

  if (topOpSkills.length) {
    dynamicSections.push(
      '## SKILLS OPERACIONAIS ATIVADAS PARA ESTA MENSAGEM\n' +
        topOpSkills.map((s) => s.bodyMd || `### ${s.id} — ${s.name}\nQuando: ${s.when}\nExemplo: ${s.example_response}`).join('\n\n---\n\n')
    );
  }

  if (topHumSkills.length) {
    dynamicSections.push(
      '## SKILLS DE HUMANIZAÇÃO ATIVADAS\n' +
        topHumSkills
          .map(
            (h) =>
              `• ${h.id} (${h.name}) — Gatilho: ${h.trigger}\n  Objetivo: ${h.goal}\n  Evitar: ${h.avoid}\n  Ruim: "${h.bad_response}"\n  Melhor: "${h.better_response}"`
          )
          .join('\n\n')
    );
  }

  if (topObjections.length) {
    dynamicSections.push(
      '## MATRIZ DE DÚVIDAS/OBJEÇÕES DETECTADAS\n' +
        topObjections
          .map(
            (o) =>
              `• [${o.id}] Padrão: "${o.input_pattern}" (${o.nature}) -> Estratégia: ${o.response_strategy} | Evitar: ${o.avoid}`
          )
          .join('\n')
    );
  }

  if (topRefs.length) {
    dynamicSections.push(
      '## RESPOSTAS CONDICIONAIS DE REFERÊNCIA (ADAPTE AO CONTEXTO REAL, NÃO COPIE CEGAMENTE)\n' +
        topRefs
          .map(
            (r) =>
              `• [${r.id} — ${r.title}] Quando: ${r.when}\n  Conduta recomendada: ${r.recommended_behavior}\n  Exemplo de fala: ${
                r.customer_messages?.length ? `"${r.customer_messages.join(' ')}"` : '(SILÊNCIO — nenhum texto enviado ao contato)'
              }\n  Cuidado: ${r.caution}`
          )
          .join('\n\n')
    );
  }

  if (topPersonas.length) {
    dynamicSections.push(
      '## PERFIL PROVÁVEL DO INTERLOCUTOR\n' +
        topPersonas.map((p) => p.bodyMd || `${p.id} - ${p.name}: ${p.signals}`).join('\n\n')
    );
  }

  if (topGoodBad.length) {
    dynamicSections.push(
      '## CALIBRAGEM BOM VS RUIM\n' +
        topGoodBad
          .map((g) => `• ${g.title} (${g.context})\n  NÃO USAR: "${g.do_not_use}"\n  MELHOR: "${g.better_response}"`)
          .join('\n')
    );
  }

  if (topConv.length) {
    const c = topConv[0];
    dynamicSections.push(
      `## EXEMPLO DE DIÁLOGO APLICADO (${c.id} — ${c.title})\nCenário: ${c.setup}\n` +
        c.turns.map((t) => `${t.speaker.toUpperCase()}: ${t.text}`).join('\n')
    );
  }

  return {
    packMeta: {
      id: pack.id,
      name: pack.name,
      version: pack.version
    },
    canonicalBlock: canonicalSections.join('\n\n'),
    dynamicBlock: dynamicSections.join('\n\n'),
    activatedSkills: [
      ...topOpSkills.map((s) => `${s.id} · ${s.name}`),
      ...topHumSkills.map((h) => `${h.id} · ${h.name}`)
    ],
    matchedReferences: topRefs.map((r) => `${r.id} (${r.recommended_behavior})`),
    diagnostics: {
      operationalSkills: topOpSkills.map((s) => ({ id: s.id, name: s.name, when: s.when || '' })),
      humanizationSkills: topHumSkills.map((h) => ({ id: h.id, name: h.name, trigger: h.trigger || '' })),
      objections: topObjections.map((o) => ({ id: o.id, pattern: o.input_pattern || '', nature: o.nature || '' })),
      personas: topPersonas.map((p) => ({ id: p.id, name: p.name || '' })),
      references: topRefs.map((r) => ({ id: r.id, title: r.title || '', behavior: r.recommended_behavior || '' }))
    }
  };
}

/**
 * Motor demonstrativo fiel ao pacote Turbo para uso imediato no Simulador mesmo antes de configurar API Key!
 */
export function generatePackDemoReply(packId, { userText = '', history = [], media = null } = {}) {
  const pack = getTrainingPack(packId);
  if (!pack) return null;

  const folded = foldPt(userText).trim();
  const ctx = selectTurnPackContext(packId, {
    userText,
    history,
    hasAudio: Boolean(media?.mimeType?.startsWith('audio/')),
    hasImage: Boolean(media?.mimeType?.startsWith('image/'))
  });

  // 1. Mídia sem chave de IA configurada -> segue regra canônica R024: Pausa Silenciosa (não fingir que ouviu/leu!)
  if (media && (!userText || userText.trim().length < 3)) {
    return {
      rawText: '[[PAUSA_SILENCIOSA:Mídia recebida sem interpretação segura no modo offline — aguardando revisão de Lizandro]]',
      activatedSkills: ['S24 · tratar-midia-com-seguranca', 'H23 · nao-simular-acoes-e-vivencias']
    };
  }

  // 2. Pedido explícito para parar / opt-out (Prioridade #1)
  if (/\b(me remove|remove meu|pare de mandar|para de mandar|nao mande mais|sair da lista|apaga meu)\b/.test(folded)) {
    return {
      rawText:
        'Entendido. Não vou continuar com mensagens comerciais por aqui. Desculpa pelo incômodo. [[PARAR_CONTATO:Contato pediu explicitamente para encerrar mensagens]]',
      activatedSkills: ['S21 · respeitar-pedido-de-parar', 'R021']
    };
  }

  // 3. Recusa cordial da oferta (Prioridade #3)
  if (
    /\b(nao tenho interesse|sem interesse|nao quero esse servico|no momento nao|estamos atendidos|ja tenho agencia obrigado|ja tenho agencia e estamos bem)\b/.test(
      folded
    )
  ) {
    return {
      rawText:
        'Sem problema. Obrigado pelo retorno e sucesso para vocês. [[ENCERRAR_CONTATO:Recusa cordial da oferta — encerrado sem insistir]]',
      activatedSkills: ['S20 · encerrar-recusa-sem-insistir', 'H16 · respeitar-cautela-e-autonomia']
    };
  }

  // 4. Cortesia pura de fechamento ("ok obrigado", "valeu") após explicação/encerramento -> Silêncio de cortesia
  if (/^(ok obrigado|ok obrigada|valeu obrigado|beleza obrigado|show obrigado)[.!]*$/.test(folded) && history.length >= 2) {
    return {
      rawText: '[[SILENCIO_CORTESIA]]',
      activatedSkills: ['H03 · ler-cortesia-sem-transforma-la-em-aceite', 'S22 · nao-responder-a-visualizacao']
    };
  }

  // 5. Valores, condições comerciais, mensalidade, verba ou desejo de contratar (Prioridade #4)
  if (
    /\b(valor|valores|preco|quanto custa|mensalidade|investimento|pacote|orcamento|condicao comercial|quero contratar|fechar contrato|verba)\b/.test(
      folded
    )
  ) {
    return {
      rawText:
        'Essa parte de valores e condições comerciais o Lizandro responde pessoalmente. Já deixei sua pergunta organizada aqui para ele continuar com você na sequência. [[CHAMAR_HUMANO:Interessado perguntou sobre valores / condições comerciais]]',
      activatedSkills: ['S15 · encaminhar-questao-comercial', 'H15 · passar-ao-humano-sem-cerimonia-falsa']
    };
  }

  // 6. Escopo específico não confirmado (frequência de posts, gravação presencial, CRM, prazo)
  if (/\b(quantos posts|quantas postagens|filmar|gravacao presencial|visita presencial|integracao|rd station|crm)\b/.test(folded)) {
    return {
      rawText:
        'A produção e publicação de conteúdo fazem parte do nosso trabalho, mas detalhes específicos de formato, rotina ou execução presencial precisam ser alinhados direto com o Lizandro. Vou deixar registrado para ele te responder por aqui. [[CHAMAR_HUMANO:Dúvida sobre escopo operacional específico]]',
      activatedSkills: ['S29 · delimitar-escopo-e-integracoes', 'H22 · reconhecer-limites-com-linguagem-comum']
    };
  }

  // 7. Preferência por texto ("não me liga, explica por aqui")
  if (/\b(nao liga|nao me liga|prefiro mensagem|prefiro texto|explica por aqui|por mensagem|sem ligacao)\b/.test(folded)) {
    return {
      rawText:
        'Combinado, seguimos por mensagem aqui mesmo. A gente ajuda lojas e vendedores de veículos com presença nas redes sociais, produção e publicação de conteúdo, campanhas pensadas para cada veículo e apoio nas estratégias de vendas para aproveitar os contatos que chegam. Hoje, como vocês fazem a divulgação do estoque?',
      activatedSkills: ['S23 · respeitar-texto-e-ligacao', 'S02 · explicar-oferta-completa']
    };
  }

  // 8. Preferência de agenda / horário
  if (/\b(amanha as|hoje as|pode ligar|15 minutos|14h|15h|16h|10h|11h|melhor horario)\b/.test(folded)) {
    return {
      rawText:
        'Perfeito, anotei essa preferência de horário para o Lizandro conferir a agenda e confirmar certinho com você por aqui. [[CHAMAR_HUMANO:Lead informou preferência de dia/horário para conversa]]',
      activatedSkills: ['S18 · receber-preferencia-de-agenda', 'H19 · resumir-para-encaminhamento']
    };
  }

  // 9. Engano achando que é loja vendendo carro
  if (/\b(qual o valor do carro|aceita troca|tabela fipe|quero comprar um carro|tem hilux|financia)\b/.test(folded)) {
    return {
      rawText:
        'Acho que houve um engano rápido: nós não somos uma loja de veículos e não vendemos carros diretamente. Trabalhamos com assessoria de marketing, conteúdo e vendas para lojas e vendedores de veículos.',
      activatedSkills: ['S13 · esclarecer-engano-com-compra-de-carro', 'H10 · corrigir-sem-defesa-longa']
    };
  }

  // 10. Pergunta sobre tráfego pago / anúncios
  if (/\b(trafego|anuncio|anuncios|impulsionar|ads)\b/.test(folded)) {
    return {
      rawText:
        'Sim, o tráfego pago faz parte! Além das campanhas pensadas para cada veículo, a gente também cuida da presença nas redes sociais, da produção e publicação de conteúdo e apoia nas técnicas de vendas para aproveitar os contatos que chegam. Vocês já anunciam hoje?',
      activatedSkills: ['S03 · responder-trafego-pago', 'H02 · responder-antes-de-preparar-o-terreno']
    };
  }

  // 11. Pergunta sobre conteúdo / redes sociais / posts
  if (/\b(post|posts|conteudo|redes sociais|instagram|reels)\b/.test(folded)) {
    return {
      rawText:
        'Sim, também fazemos produção e publicação de conteúdo, além do cuidado com a presença nas redes sociais. A proposta é conectar isso à divulgação de cada veículo e ao aproveitamento comercial no atendimento.',
      activatedSkills: ['S04 · explicar-conteudo-e-gestao', 'H04 · tornar-o-servico-concreto']
    };
  }

  // 12. Já tem agência mas perguntou como funciona
  if (/\b(agencia|gestor)\b/.test(folded)) {
    return {
      rawText:
        'Entendi que vocês já contam com agência hoje. Nosso trabalho olha para o mercado de veículos juntando presença nas redes, produção de conteúdo, campanhas pensadas por veículo e também apoio em técnicas de vendas/social selling para converter quem chama. Hoje vocês sentem mais gargalo na atração ou no fechamento dos contatos?',
      activatedSkills: ['S11 · responder-agencia-existente', 'H06 · acolher-sem-adivinhar-emocoes']
    };
  }

  // 13. Pergunta se é robô / IA — Postura 100% Humana (jamais entregar IA/automação)
  if (/\b(robo|inteligencia artificial|automatico|bot)\b/.test(folded)) {
    return {
      rawText:
        'Que nada, tô falando contigo por aqui mesmo! Faço parte da equipe comercial do Lizandro. Se preferir falar direto com o próprio Lizandro também, já deixo alinhado pra ele continuar contigo por aqui.',
      activatedSkills: ['S14 · identidade-e-origem-verificadas', 'H14 · manter-postura-humana-identidade']
    };
  }

  // 14. Saudação ou pedido geral de explicação ("oi", "como funciona?", "o que vocês fazem?", "pode explicar")
  if (
    /\b(oi|ola|bom dia|boa tarde|boa noite|tudo bem|como funciona|o que voces fazem|pode explicar|explica|me conta|assessoria)\b/.test(
      folded
    )
  ) {
    return {
      rawText:
        'Olá! Tudo bem? A gente atua com assessoria voltada para quem vende veículos: cuidamos da presença nas redes sociais, produzimos e publicamos conteúdo, estruturamos campanhas pensadas por veículo e apoiamos nas estratégias de vendas e acompanhamento. Hoje você fala de uma loja/revenda ou trabalha de forma independente?',
      activatedSkills: ['S02 · explicar-oferta-completa', 'H02 · responder-antes-de-preparar-o-terreno']
    };
  }

  // 15. Busca melhor resposta condicional se tiver score alto
  const tokens = tokenizePt(userText);
  if (tokens.length > 0 && pack.referenceResponses?.length) {
    const scored = pack.referenceResponses
      .map((r) => ({ r, score: scoreItem(r.searchBlob, tokens, folded, []) }))
      .sort((a, b) => b.score - a.score);

    if (scored[0] && scored[0].score >= 6) {
      const best = scored[0].r;
      if (best.recommended_behavior === 'pausa silenciosa para Lizandro') {
        return {
          rawText: `[[PAUSA_SILENCIOSA:${best.title}]]`,
          activatedSkills: ctx?.activatedSkills || [best.id]
        };
      }
      if (best.recommended_behavior === 'não enviar nova mensagem') {
        return {
          rawText: '[[SILENCIO_CORTESIA]]',
          activatedSkills: ctx?.activatedSkills || [best.id]
        };
      }
      const msg = best.customer_messages?.[0] || '';
      if (best.recommended_behavior === 'deixar Lizandro continuar') {
        return {
          rawText: `${msg} [[CHAMAR_HUMANO:${best.title}]]`.trim(),
          activatedSkills: ctx?.activatedSkills || [best.id]
        };
      }
      if (best.recommended_behavior === 'encerrar a abordagem') {
        return {
          rawText: `${msg} [[ENCERRAR_CONTATO:${best.title}]]`.trim(),
          activatedSkills: ctx?.activatedSkills || [best.id]
        };
      }
      if (best.recommended_behavior === 'encerrar e não retomar') {
        return {
          rawText: `${msg} [[PARAR_CONTATO:${best.title}]]`.trim(),
          activatedSkills: ctx?.activatedSkills || [best.id]
        };
      }
      if (msg) {
        return {
          rawText: msg,
          activatedSkills: ctx?.activatedSkills || [best.id]
        };
      }
    }
  }

  // 16. Intenção não compreendida com segurança -> REGRA DE OURO DA v.turbo: PAUSA SILENCIOSA!
  return {
    rawText:
      '[[PAUSA_SILENCIOSA:Intenção não compreendida com segurança — conversa pausada silenciosamente para revisão pessoal de Lizandro]]',
    activatedSkills: ['02.13 · intencao-nao-compreendida-e-pausa-silenciosa', 'R024']
  };
}
