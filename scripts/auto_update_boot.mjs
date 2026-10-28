#!/usr/bin/env node
/**
 * Ienvia — Auto-Updater Universal de Inicialização (Windows + Linux + Android Termux)
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
import { extractZipBuffer } from '../src/zipReader.js';
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
  'data/history-journal/',
  'data/recovery-before-pairing/',
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
    // Valida todos os arquivos (CRC e tamanho) antes de gravar qualquer atualização.
    const archive = extractZipBuffer(Buffer.from(arrayBuf), { maxFiles: 1500, maxTotalBytes: 50 * 1024 * 1024 });
    const entries = archive.files.map((file) => ({ zipPath: file.path, content: file.buffer }));
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
