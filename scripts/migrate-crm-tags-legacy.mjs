// Migração local de dados antigos (painel anterior) para a nova biblioteca de etiquetas/cores.
// Lê customTags do storage legado, converte para saved_tag_library_v1 e prepara aplicação aos contatos.
// Não escreve no banco remoto nem envia mensagens. Gera um JSON de migração para revisão estática.
import {readFileSync, existsSync} from 'fs';
import {crmUuid} from '../public/v2/assets/crm-metadata-contract.js';

const STORAGE_CANDIDATES = [
  'data/database.json',
  'data/contacts.json',
];

function safeJson(text){
  try{return JSON.parse(text);}catch{return null;}
}

function legacyId(rawId, fallback){
  try{return crmUuid(String(rawId));}catch{return fallback || `legacy_${String(rawId).replace(/[^a-z0-9]/gi,'_').slice(0,40)}`;}
}
function normalizeLegacyTag(raw){
  const name = String(raw.name || '').trim().slice(0,32);
  if(!name)return null;
  const colorRaw = String(raw.color || '#10b981').trim();
  const color = /^#[0-9a-fA-F]{6}$/i.test(colorRaw) ? colorRaw.toLowerCase() : '#10b981';
  const id = raw.id && /^[0-9a-fA-F-]{8,}$/.test(String(raw.id)) ? crmUuid(String(raw.id)) : legacyId(`tag_${name}`, `tag_${name.toLowerCase().replace(/[^a-z0-9]+/g,'_').slice(0,40)}`);
  return {id, name, color};
}

export function migrateLegacyTags(storageData){
  const biz = storageData?.business || storageData?.biz || {};
  const rawTags = Array.isArray(biz.customTags) ? biz.customTags : [];
  const items = [];
  const seen = new Set();
  const warnings = [];
  for(const raw of rawTags){
    const n = normalizeLegacyTag(raw);
    if(!n){warnings.push({reason:'sem_nome', raw});continue;}
    const key = n.name.toLowerCase();
    if(seen.has(key)){warnings.push({reason:'duplicado', name:n.name});continue;}
    seen.add(key);
    items.push(n);
  }
  return {
    format:'ienvia-tag-migration-v1',
    source:'painel_legado_customTags',
    items,
    total: items.length,
    warnings,
    migratedAt: new Date().toISOString(),
  };
}

export function migrateLegacyContacts(storageData){
  const contacts = storageData?.contacts || storageData?.data?.contacts || {};
  const rows = [];
  const warnings = [];
  const byId = typeof contacts === 'object' && !Array.isArray(contacts) ? contacts : {};
  for(const [chatId, c] of Object.entries(byId)){
    if(!c || typeof c !== 'object')continue;
    const name = String(c.name || c.chatName || '').trim();
    const phone = String(c.phone || c.jid || c.peerJid || chatId || '').trim();
    if(!name){warnings.push({reason:'sem_nome', chatId});continue;}
    rows.push({
      id: c.id || legacyId(chatId),
      chatId,
      name,
      phone,
      company: c.company || '',
      city: c.city || '',
      stage: c.stage || 'novo',
      dealValue: Number(c.dealValue || 0) || 0,
      tags: Array.isArray(c.tags) ? c.tags.filter(t=>typeof t==='string'&&t.trim()).slice(0,8) : [],
      saved: Boolean(c.saved),
      unread: Number(c.unread || 0),
      assignee: c.assignee || '',
      note: c.note || '',
      source: 'legado',
      migratedAt: new Date().toISOString(),
    });
  }
  return {contacts: rows, total: rows.length, warnings};
}

function findStorageFile(){
  for(const cand of STORAGE_CANDIDATES){
    if(existsSync(cand))return cand;
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = findStorageFile();
  if (file) {
    const data = safeJson(readFileSync(file, 'utf8'));
    const tags = migrateLegacyTags(data);
    const contacts = migrateLegacyContacts(data);
    console.log(JSON.stringify({ tags, contacts, sourceFile: file }, null, 2));
  } else {
    console.log(JSON.stringify({ error: 'nenhum_arquivo_de_storage_encontrado', candidates: STORAGE_CANDIDATES }, null, 2));
  }
}
