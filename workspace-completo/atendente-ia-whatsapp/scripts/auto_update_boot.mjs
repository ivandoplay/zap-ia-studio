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
import { applyUpdateTransaction, recoverInterruptedUpdate } from '../src/updateTransaction.js';
import { isNewerRelease, verifySignedManifest } from '../src/updateSignature.js';
import { UPDATE_PUBLIC_KEY } from '../src/updatePublicKey.js';
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
const IS_TERMUX = fs.existsSync('/data/data/com.termux/files/usr');

const BASE_URL = (process.env.ZAPIA_BASE_URL || 'https://zap-ia-studio.vercel.app').replace(/\/+$/, '');

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}


async function runAutoUpdateCheck() {
  if (process.env.VERCEL) return;
  const recovered = recoverInterruptedUpdate(ROOT_DIR);
  if (recovered) console.warn('⚠️ [Auto-Update] Uma atualização interrompida foi desfeita com segurança.');
  if (process.env.ZAPIA_SKIP_AUTO_UPDATE === '1') {
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
  if (!isNewerRelease(localVersion, remoteVersion)) {
    console.warn('⚠️ [Auto-Update] Versão remota inválida ou anterior; atualização ignorada.');
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
    const allEntries = archive.files.map((file) => ({ zipPath: file.path, content: file.buffer }));
    const manifestFiles = allEntries.filter(e => e.zipPath === 'ZAP-IA-Studio/sistema/release/update-manifest.json');
    const signatureFiles = allEntries.filter(e => e.zipPath === 'ZAP-IA-Studio/sistema/release/update-manifest.sig');
    if (manifestFiles.length !== 1 || signatureFiles.length !== 1) throw new Error('Assinatura digital da atualização ausente ou duplicada.');
    const entries = allEntries.filter(e => !['ZAP-IA-Studio/sistema/release/update-manifest.json','ZAP-IA-Studio/sistema/release/update-manifest.sig'].includes(e.zipPath));
    verifySignedManifest(entries, manifestFiles[0].content, signatureFiles[0].content, UPDATE_PUBLIC_KEY, remoteVersion);
    if (entries.length < 10) {
      throw new Error('Pacote de atualização incompleto.');
    }

    // Cada arquivo anterior é salvo antes de qualquer troca; em caso de falha,
    // o conjunto anterior é restaurado. Se o processo cair, a próxima abertura recupera.
    const updatedCount = applyUpdateTransaction({ rootDir: ROOT_DIR, entries: allEntries });

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
