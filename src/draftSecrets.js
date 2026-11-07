// Segredos das abas novas na nuvem: chave de IA e PIN.
//
// O cofre local recebe uma chave de 32 bytes por composição explícita. Na Vercel não há
// arquivo de chave, então a raiz vem de `AI_DRAFT_VAULT_KEY` (32 bytes em hex ou base64).
// Sem essa variável, as abas continuam funcionando para configuração, mas trocar chave ou
// PIN responde 503 — nunca gravamos segredo em claro no banco.
import { createHash } from 'node:crypto';
import { createAiDraftVault } from './ai-settings/vault.js';
import { createSecurityPinProtector } from './security-settings/pin.js';

const fail = message => Object.assign(new Error(message), { status: 503 });

export function vaultKeyFromEnv(env = process.env) {
  const raw = String(env.AI_DRAFT_VAULT_KEY || '').trim();
  if (!raw) return null;
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  try {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length === 32) return buf;
  } catch { /* cai no erro abaixo */ }
  return null;
}

// A mesma raiz deriva subchaves diferentes para IA e para PIN (não compartilham segredo).
function derive(key, purpose) {
  return createHash('sha256').update(Buffer.concat([key, Buffer.from(`ienvia-vault-v1:${purpose}`)])).digest();
}

export function createDraftSecrets(env = process.env) {
  const key = vaultKeyFromEnv(env);
  const vault = key ? createAiDraftVault({ key: derive(key, 'ai') }) : null;
  const pinProtector = key ? createSecurityPinProtector({ key: derive(key, 'pin') }) : null;
  return {
    available: Boolean(key),
    vault,
    pinProtector,
    requireVault() {
      if (!vault) throw fail('Cofre de chaves indisponível: defina AI_DRAFT_VAULT_KEY (32 bytes) na Vercel.');
      return vault;
    },
    requirePin() {
      if (!pinProtector) throw fail('Cofre do PIN indisponível: defina AI_DRAFT_VAULT_KEY (32 bytes) na Vercel.');
      return pinProtector;
    }
  };
}
