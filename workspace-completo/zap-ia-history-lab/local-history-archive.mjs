// Protótipo isolado: não conectado ao motor nem à nuvem de produção.
// Esta implementação não deve ser ativada sem integração de exclusão, edição,
// sincronização entre aparelhos, migração e revisão de durabilidade/performance.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const hash = s => crypto.createHash('sha256').update(s).digest('hex');
function validKey(s) { return typeof s === 'string' && s.trim().length > 0 && s.length <= 512; }
function messageId(m) { return String(m?.waMsgId || m?.id || ''); }
function time(m) { const n = Date.parse(m?.timestamp || ''); return Number.isFinite(n) ? n : 0; }

export class ExperimentalLocalHistoryArchive {
  constructor(root) {
    if (!validKey(root) || !path.isAbsolute(root)) throw new Error('A pasta do arquivo precisa ser absoluta.');
    this.root = root;
  }
  filename(userId, chatId) {
    if (!validKey(userId) || !validKey(chatId)) throw new Error('Conta e conversa são obrigatórias.');
    return path.join(this.root, hash(userId), hash(chatId) + '.jsonl');
  }
  writeEvents(userId, chatId, events) {
    const file = this.filename(userId, chatId);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n';
    const fd = fs.openSync(file, 'a', 0o600);
    try { fs.writeFileSync(fd, lines, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  append(userId, chatId, messages) {
    if (!Array.isArray(messages)) throw new Error('Mensagens inválidas.');
    const events = messages.map(m => {
      if (!messageId(m) || !time(m)) throw new Error('Mensagem precisa de identificador e data válidos.');
      return { kind:'message', message:m };
    });
    if (events.length) this.writeEvents(userId,chatId,events);
  }
  clear(userId, chatId, clearedAt) {
    const ts = Date.parse(clearedAt);
    if (!Number.isFinite(ts)) throw new Error('Data de limpeza inválida.');
    this.writeEvents(userId,chatId,[{kind:'clear',timestamp:new Date(ts).toISOString()}]);
  }
  readAll(userId, chatId) {
    const file = this.filename(userId, chatId);
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file,'utf8');
    if (raw && !raw.endsWith('\n')) throw new Error('Arquivo incompleto; não ignorar dados danificados.');
    const lines = raw.split('\n').filter(Boolean);
    const messages = new Map();
    let clearedMs = 0;
    for (const line of lines) {
      let e;
      try { e=JSON.parse(line); } catch { throw new Error('Arquivo de histórico inválido.'); }
      if (e.kind === 'clear') {
        const v=Date.parse(e.timestamp);
        if (!Number.isFinite(v)) throw new Error('Data de limpeza inválida no arquivo.');
        clearedMs=Math.max(clearedMs,v);
      } else if (e.kind === 'message' && messageId(e.message) && time(e.message)) {
        const key=messageId(e.message);
        messages.set(key, { ...(messages.get(key)||{}), ...e.message });
      } else throw new Error('Evento inválido no arquivo.');
    }
    return [...messages.values()].filter(m => time(m)>clearedMs)
      .sort((a,b)=>time(a)-time(b)||messageId(a).localeCompare(messageId(b)));
  }
  page(userId, chatId, { before=null, limit=50 }={}) {
    const all=this.readAll(userId,chatId);
    const n=Math.max(1,Math.min(200,Number(limit)||50));
    let end=all.length;
    if (before) {
      if (!validKey(before.id) || !Number.isFinite(before.timestamp)) throw new Error('Cursor inválido.');
      end=all.findIndex(m=>time(m)>before.timestamp || (time(m)===before.timestamp && messageId(m)>=before.id));
      if(end<0)end=all.length;
    }
    const start=Math.max(0,end-n), messages=all.slice(start,end);
    return {messages,hasMore:start>0,nextBefore:start>0?{timestamp:time(messages[0]),id:messageId(messages[0])}:null};
  }
}
