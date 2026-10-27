#!/usr/bin/env node
/**
 * ZAP-IA Studio — Auto-Updater Universal de Inicialização (Windows + Linux + Android Termux)
 * Executado automaticamente toda vez que o sistema é aberto em qualquer um dos 3 dispositivos:
 * 1. Consulta a versão oficial publicada na nuvem (https://zap-ia-studio.vercel.app/api/public/version) em < 0.4s;
 * 2. Se já estiver na última versão (ou sem internet no momento), segue a abertura imediatamente sem travar;
 * 3. Se houver versão nova, baixa o pacote oficial (~430 KB), atualiza todos os arquivos preservando 100%
 *    do WhatsApp conectado (wa_auth), login (cloud_session.json), banco local e mídias, e já sobe atualizado!
 */

import dns from 'node:dns';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

try {
  dns.setDefaultResultOrder('ipv4first');
  if (typeof net.setDefaultAutoSelectFamily === 'function') {
    net.setDefaultAutoSelectFamily(false);
  }
} catch {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PARENT_DIR = path.dirname(ROOT_DIR);
const IS_SISTEMA_SUBDIR = path.basename(ROOT_DIR).toLowerCase() === 'sistema';
const IS_TERMUX = fs.existsSync('/data/data/com.termux/files/usr');

const BASE_URL = (process.env.ZAPIA_BASE_URL || 'https://zap-ia-studio.vercel.app').replace(/\/+$/, '');
const PROTECTED_SISTEMA_PREFIXES = [
  'data/wa_auth/',
  'data/uploads/',
  'data/tenants/',
  'node_modules/',
  '.runtime/',
  '.git/'
];
const PROTECTED_EXACT_FILES = new Set([
  '.env',
  'data/database.json',
  'data/cloud_session.json',
  'data/.wrapper.pid'
]);

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function extractZipBuffer(buf) {
  if (!buf || buf.length < 22) {
    throw new Error('Pacote de atualização vazio ou incompleto.');
  }
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) {
    throw new Error('Assinatura ZIP (EOCD) não encontrada.');
  }

  const total = Math.min(buf.readUInt16LE(eocd + 10), 1500);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  let ptr = cdOffset;
  let totalBytes = 0;
  const maxUpdateBytes = 50 * 1024 * 1024;
  const files = [];

  for (let i = 0; i < total && ptr < cdOffset + cdSize; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) {
      throw new Error('Cabeçalho Central Directory inválido.');
    }
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const rawName = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    ptr += 46 + nameLen + extraLen + commentLen;

    const cleanRel = rawName
      .replace(/\\/g, '/')
      .split('/')
      .filter((s) => s && s !== '.' && s !== '..')
      .join('/');
    if (!cleanRel || rawName.endsWith('/')) continue;

    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const slice = buf.subarray(dataStart, dataStart + compSize);
    const remaining = maxUpdateBytes - totalBytes;
    if (remaining <= 0) throw new Error('Limite de segurança do pacote excedido.');
    const content = method === 0 ? slice : zlib.inflateRawSync(slice, { maxOutputLength: remaining });
    totalBytes += content.length;
    files.push({ zipPath: cleanRel, content });
  }
  return files;
}

async function runAutoUpdateCheck() {
  if (process.env.ZAPIA_SKIP_AUTO_UPDATE === '1' || process.env.VERCEL) {
    return;
  }

  const pkgPath = path.join(ROOT_DIR, 'package.json');
  const localPkg = readJsonSafe(pkgPath) || {};
  const localVersion = String(localPkg.version || '0.0.0').trim();
  const oldDepsSig = JSON.stringify(localPkg.dependencies || {});

  let remoteVersion = '';
  try {
    const res = await fetch(`${BASE_URL}/api/public/version?t=${Date.now()}`, {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(4500)
    });
    if (!res.ok) return;
    const data = await res.json();
    remoteVersion = String(data?.version || '').trim();
  } catch {
    // Sem internet no momento ou servidor ocupado: segue inicialização local sem atrasar!
    return;
  }

  if (!remoteVersion || remoteVersion === localVersion) {
    console.log(`✅ [Auto-Update] Já está na versão mais recente (v${localVersion}).`);
    return;
  }

  console.log(`🔄 [Auto-Update] Nova atualização encontrada (v${localVersion} -> v${remoteVersion})! Aplicando automaticamente...`);

  try {
    const zipRes = await fetch(`${BASE_URL}/api/public/motor-update.zip?t=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(25000)
    });
    if (!zipRes.ok) {
      throw new Error(`HTTP ${zipRes.status} ao baixar pacote de atualização.`);
    }
    const arrayBuf = await zipRes.arrayBuffer();
    const entries = extractZipBuffer(Buffer.from(arrayBuf));
    if (entries.length < 10) {
      throw new Error('Pacote de atualização incompleto.');
    }

    let updatedCount = 0;
    for (const entry of entries) {
      if (entry.zipPath.startsWith('ZAP-IA-Studio/sistema/')) {
        const rel = entry.zipPath.slice('ZAP-IA-Studio/sistema/'.length);
        if (!rel) continue;
        if (PROTECTED_EXACT_FILES.has(rel)) continue;
        if (PROTECTED_SISTEMA_PREFIXES.some((p) => rel.startsWith(p))) continue;

        const destFile = path.join(ROOT_DIR, ...rel.split('/'));
        fs.mkdirSync(path.dirname(destFile), { recursive: true });
        fs.writeFileSync(destFile, entry.content);
        if (process.platform !== 'win32' && destFile.endsWith('.sh')) {
          try { fs.chmodSync(destFile, 0o755); } catch {}
        }
        updatedCount += 1;
      } else if (IS_SISTEMA_SUBDIR && entry.zipPath.startsWith('ZAP-IA-Studio/')) {
        const outerRel = entry.zipPath.slice('ZAP-IA-Studio/'.length);
        if (!outerRel || outerRel.startsWith('sistema/')) continue;
        const destOuter = path.join(PARENT_DIR, ...outerRel.split('/'));
        fs.mkdirSync(path.dirname(destOuter), { recursive: true });
        fs.writeFileSync(destOuter, entry.content);
        if (process.platform !== 'win32' && destOuter.endsWith('.sh')) {
          try { fs.chmodSync(destOuter, 0o755); } catch {}
        }
      }
    }

    const newPkg = readJsonSafe(pkgPath) || {};
    const newDepsSig = JSON.stringify(newPkg.dependencies || {});
    if (newDepsSig !== oldDepsSig && process.env.ZAPIA_DEFER_NPM !== '1') {
      console.log('📦 [Auto-Update] Novas dependências detectadas — atualizando bibliotecas...');
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const npmArgs = ['install', '--legacy-peer-deps', '--no-audit', '--no-fund', '--maxsockets=4', '--fetch-timeout=300000', '--fetch-retries=6', '--prefer-offline'];
      if (IS_TERMUX) npmArgs.push('--no-bin-links', '--omit=optional');
      const env = { ...process.env, NODE_OPTIONS: '--dns-result-order=ipv4first --no-network-family-autoselection' };
      const r1 = spawnSync(npmCmd, npmArgs, { cwd: ROOT_DIR, stdio: 'inherit', shell: process.platform === 'win32', env });
      if (r1.status !== 0) {
        spawnSync(npmCmd, [...npmArgs, '--registry=https://registry.npmmirror.com', '--omit=optional'], { cwd: ROOT_DIR, stdio: 'inherit', shell: process.platform === 'win32', env });
      }
    }

    const dataDir = path.join(ROOT_DIR, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, '.last_auto_update.json'),
      JSON.stringify({ from: localVersion, to: remoteVersion, updatedAt: new Date().toISOString() }, null, 2)
    );

    console.log(`✅ [Auto-Update] Sistema atualizado automaticamente para v${remoteVersion} (${updatedCount} arquivos)!`);
    if (process.argv.includes('--signal-updated-exit-20')) {
      process.exit(20);
    }
  } catch (err) {
    console.warn(`⚠️  [Auto-Update] Não foi possível concluir a atualização agora (${err.message}). Iniciando v${localVersion} normalmente...`);
  }
}

await runAutoUpdateCheck();
