// EXPERIMENTO ISOLADO. NÃO INTEGRAR A SESSÕES REAIS SEM REVISÃO.
// Arquivo SQLite local; não compartilhe o arquivo entre processos que usem
// implementações diferentes de VFS/locking.
import fs from 'node:fs';
import path from 'node:path';
import sqlite from 'node-sqlite3-wasm';
const { Database } = sqlite;

const identity = (msg) => String(msg?.waMsgId || msg?.id || '');
const requireKey = (value) => {
  if (typeof value !== 'string' || !value || value.length > 512) throw new Error('Chave inválida.');
};
const msgTime = (msg) => {
  const ts = Date.parse(msg?.timestamp || '');
  if (!Number.isFinite(ts)) throw new Error('Mensagem sem data válida.');
  return ts;
};
function merge(existing, incoming) {
  if (!existing) return incoming;
  const out = { ...existing, ...incoming };
  // Atualização antiga ou repetida não pode desfazer uma exclusão de protocolo.
  if (existing.deletedForEveryone || incoming.deletedForEveryone) {
    out.deletedForEveryone = true;
    out.text = '🚫 Mensagem apagada';
    delete out.mediaUrl;
  } else if (existing.editedAt && (!incoming.editedAt || incoming.editedAt < existing.editedAt)) {
    out.text = existing.text;
    out.editedAt = existing.editedAt;
  }
  out.ack = Math.max(Number(existing.ack)||0,Number(incoming.ack)||0) || undefined;
  if (existing.reactions || incoming.reactions) out.reactions = { ...(existing.reactions||{}), ...(incoming.reactions||{}) };
  return out;
}
export class SqliteHistoryLab {
  constructor(filename) {
    if (!path.isAbsolute(filename)) throw new Error('Pasta absoluta obrigatória.');
    fs.mkdirSync(path.dirname(filename), {recursive:true,mode:0o700});
    const wasExisting=fs.existsSync(filename);
    this.db = new Database(filename);
    if (!wasExisting) { try { fs.chmodSync(filename,0o600); } catch {} }
    this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS messages (
        user_id TEXT NOT NULL, chat_id TEXT NOT NULL, msg_id TEXT NOT NULL,
        ts INTEGER NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY (user_id, chat_id, msg_id)
      );
      CREATE INDEX IF NOT EXISTS messages_page ON messages(user_id,chat_id,ts,msg_id);
      CREATE TABLE IF NOT EXISTS cutoffs (
        user_id TEXT NOT NULL, chat_id TEXT NOT NULL, ts INTEGER NOT NULL,
        PRIMARY KEY (user_id,chat_id)
      );`);
  }
  close(){ this.db.close(); }
  add(user,chat,messages) {
    requireKey(user);requireKey(chat);
    if(!Array.isArray(messages)) throw new Error('Lista inválida.');
    const rows=messages.map(m=>{
      const id=identity(m);requireKey(id);return {id,ts:msgTime(m),msg:m};
    });
    let added=0, ignored=0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const cutoff=this.db.get('SELECT ts FROM cutoffs WHERE user_id=? AND chat_id=?',[user,chat])?.ts || 0;
      for(const {id,ts,msg} of rows) {
        if(ts<=cutoff) { ignored++;continue; }
        const old=this.db.get('SELECT data FROM messages WHERE user_id=? AND chat_id=? AND msg_id=?',[user,chat,id]);
        const data=JSON.stringify(merge(old ? JSON.parse(old.data) : null,msg));
        this.db.run(`INSERT INTO messages(user_id,chat_id,msg_id,ts,data) VALUES (?,?,?,?,?)
          ON CONFLICT(user_id,chat_id,msg_id) DO UPDATE SET ts=excluded.ts,data=excluded.data`,[user,chat,id,ts,data]);
        if(!old) added++;
      }
      this.db.exec('COMMIT');return {added,ignored};
    } catch(err) { try{this.db.exec('ROLLBACK');}catch{} throw err; }
  }
  clear(user,chat,clearedAt) {
    requireKey(user);requireKey(chat);
    const ts=Date.parse(clearedAt);
    if(!Number.isFinite(ts)) throw new Error('Data inválida.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.run(`INSERT INTO cutoffs(user_id,chat_id,ts) VALUES(?,?,?)
        ON CONFLICT(user_id,chat_id) DO UPDATE SET ts=max(ts,excluded.ts)`,[user,chat,ts]);
      const cutoff=this.db.get('SELECT ts FROM cutoffs WHERE user_id=? AND chat_id=?',[user,chat]).ts;
      this.db.run('DELETE FROM messages WHERE user_id=? AND chat_id=? AND ts<=?',[user,chat,cutoff]);
      this.db.exec('COMMIT');
    } catch(err) {try{this.db.exec('ROLLBACK');}catch{} throw err;}
  }
  count(user,chat) {
    requireKey(user);requireKey(chat);
    return this.db.get('SELECT count(*) AS n FROM messages WHERE user_id=? AND chat_id=?',[user,chat]).n;
  }
  page(user,chat,{before=null,limit=50}={}) {
    requireKey(user);requireKey(chat);
    limit=Math.max(1,Math.min(200,Math.trunc(Number(limit))||50));
    let where='user_id=? AND chat_id=?', params=[user,chat];
    if(before) {
      if(!Number.isFinite(before.timestamp)) throw new Error('Cursor inválido.');
      requireKey(before.id);
      where+=' AND (ts<? OR (ts=? AND msg_id<?))';
      params.push(before.timestamp,before.timestamp,before.id);
    }
    const rows=this.db.all(`SELECT msg_id,ts,data FROM messages WHERE ${where} ORDER BY ts DESC,msg_id DESC LIMIT ?`,[...params,limit+1]);
    const hasMore=rows.length>limit;const page=rows.slice(0,limit).reverse();
    return {messages:page.map(r=>JSON.parse(r.data)),hasMore,
      nextBefore:hasMore?{timestamp:page[0].ts,id:page[0].msg_id}:null};
  }
}
