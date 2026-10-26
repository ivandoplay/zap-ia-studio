import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { proto, initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';

// Ordenado do prefixo mais longo para o mais curto para evitar colisão (ex: sender-key-memory vs sender-key)
const KNOWN_SIGNAL_CATEGORIES = [
  'sender-key-memory',
  'app-state-sync-version',
  'app-state-sync-key',
  'identity-key',
  'device-list',
  'lid-mapping',
  'sender-key',
  'pre-key',
  'tctoken',
  'session'
];

const lockQueues = new Map();

function withLock(lockKey, fn) {
  const prev = lockQueues.get(lockKey) || Promise.resolve();
  const next = prev.then(fn, fn);
  lockQueues.set(
    lockKey,
    next.catch(() => {}).finally(() => {
      if (lockQueues.get(lockKey) === next) {
        lockQueues.delete(lockKey);
      }
    })
  );
  return next;
}

export function fixWaAuthKeyName(file) {
  return String(file || '')
    .replace(/\//g, '__')
    .replace(/:/g, '-');
}

function storeFilePath(folder, category) {
  const safeCat = fixWaAuthKeyName(category);
  return path.join(folder, `store_${safeCat}.json`);
}

async function atomicWriteJson(filePath, value) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const serialized = JSON.stringify(value, BufferJSON.replacer);
  await fsp.writeFile(tmpPath, serialized, 'utf8');
  await fsp.rename(tmpPath, filePath);
}

async function readJsonSafe(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(raw, BufferJSON.reviver);
  } catch {
    return null;
  }
}

function detectLegacyCategory(fileName) {
  if (!fileName.endsWith('.json') || fileName === 'creds.json' || fileName.startsWith('store_')) {
    return null;
  }
  for (const cat of KNOWN_SIGNAL_CATEGORIES) {
    if (fileName.startsWith(`${cat}-`)) {
      return cat;
    }
  }
  return null;
}

/**
 * Cofre Compacto Atômico do WhatsApp (ZAP-IA Studio):
 * Agrupa milhares de micro-arquivos do Baileys (ex: 7.000+ lid-mapping-*.json e pre-key-*.json)
 * em apenas ~9 arquivos atômicos por categoria (`store_<categoria>.json` + `creds.json`),
 * migrando sessões antigas automaticamente sem perder a conexão do WhatsApp.
 */
export async function useCompactWaAuthState(folder) {
  await fsp.mkdir(folder, { recursive: true });

  const bucketCache = new Map();

  const loadBucketUnlocked = async (category) => {
    if (bucketCache.has(category)) {
      return bucketCache.get(category);
    }
    const target = storeFilePath(folder, category);
    const loaded = await readJsonSafe(target);
    const bucket = loaded && typeof loaded === 'object' && !Array.isArray(loaded) ? loaded : {};
    bucketCache.set(category, bucket);
    return bucket;
  };

  // Migração automática 100% sem perdas de pastas legadas do useMultiFileAuthState
  await withLock(`migrate:${folder}`, async () => {
    let entries = [];
    try {
      entries = await fsp.readdir(folder, { withFileTypes: true });
    } catch {
      entries = [];
    }
    const legacyByCategory = new Map();
    for (const dirent of entries) {
      if (!dirent.isFile()) continue;
      const cat = detectLegacyCategory(dirent.name);
      if (!cat) continue;
      if (!legacyByCategory.has(cat)) legacyByCategory.set(cat, []);
      legacyByCategory.get(cat).push(dirent.name);
    }
    if (legacyByCategory.size === 0) return;

    let migratedCount = 0;
    for (const [cat, fileNames] of legacyByCategory.entries()) {
      const bucket = await loadBucketUnlocked(cat);
      const migratedFiles = [];
      for (const fileName of fileNames) {
        const fullPath = path.join(folder, fileName);
        const parsed = await readJsonSafe(fullPath);
        if (parsed !== null) {
          bucket[fileName] = parsed;
        }
        migratedFiles.push(fullPath);
      }
      const outPath = storeFilePath(folder, cat);
      await atomicWriteJson(outPath, bucket);
      const verified = await readJsonSafe(outPath);
      if (verified && typeof verified === 'object') {
        for (const fullPath of migratedFiles) {
          try {
            await fsp.unlink(fullPath);
            migratedCount += 1;
          } catch {
            // Ignora se já removido
          }
        }
      }
    }
    if (migratedCount > 0) {
      console.log(`[WaCompactAuth] Cofre otimizado: ${migratedCount} micro-arquivos consolidados em arquivos atômicos.`);
    }
  });

  const credsPath = path.join(folder, 'creds.json');
  const creds = (await withLock(credsPath, () => readJsonSafe(credsPath))) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const outPath = storeFilePath(folder, type);
          return withLock(outPath, async () => {
            const bucket = await loadBucketUnlocked(type);
            const result = {};
            for (const id of ids) {
              const entryKey = fixWaAuthKeyName(`${type}-${id}.json`);
              let value = Object.prototype.hasOwnProperty.call(bucket, entryKey) ? bucket[entryKey] : null;
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              result[id] = value ?? null;
            }
            return result;
          });
        },
        set: async (data) => {
          const categories = Object.keys(data || {});
          await Promise.all(
            categories.map(async (category) => {
              const entries = data[category];
              if (!entries || typeof entries !== 'object') return;
              const outPath = storeFilePath(folder, category);
              await withLock(outPath, async () => {
                const bucket = await loadBucketUnlocked(category);
                let changed = false;
                for (const id of Object.keys(entries)) {
                  const value = entries[id];
                  const entryKey = fixWaAuthKeyName(`${category}-${id}.json`);
                  if (value !== null && value !== undefined) {
                    bucket[entryKey] = value;
                    changed = true;
                  } else if (Object.prototype.hasOwnProperty.call(bucket, entryKey)) {
                    delete bucket[entryKey];
                    changed = true;
                  }
                }
                if (changed) {
                  await atomicWriteJson(outPath, bucket);
                }
              });
            })
          );
        },
        clear: async () => {
          bucketCache.clear();
          if (!fs.existsSync(folder)) return;
          for (const entry of fs.readdirSync(folder)) {
            if (entry.startsWith('store_') && entry.endsWith('.json')) {
              try {
                fs.unlinkSync(path.join(folder, entry));
              } catch {
                // Ignora erro
              }
            }
          }
        }
      }
    },
    saveCreds: async () => {
      await withLock(credsPath, () => atomicWriteJson(credsPath, creds));
    }
  };
}
