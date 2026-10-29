import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Salva cópia técnica da pasta de sessão ANTES de um novo pareamento.
// Logout no WhatsApp invalida a sessão antiga; esta cópia não garante reconexão.
export function backupSlotAuth({ authRoot, recoveryRoot, userId, slotId, authDir }) {
  if (!path.isAbsolute(authRoot) || !path.isAbsolute(recoveryRoot) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(String(userId || '')) || !['slot_2','slot_3'].includes(slotId)) {
    throw new Error('Conta ou chip inválido para cópia de segurança.');
  }
  const expected = path.resolve(authRoot, userId, slotId);
  if (path.resolve(authDir || '') !== expected || !fs.existsSync(expected) || fs.realpathSync(expected) !== expected) {
    throw new Error('Pasta de autenticação não corresponde ao chip selecionado.');
  }
  const creds = path.join(expected, 'creds.json');
  if (!fs.existsSync(creds) || !fs.lstatSync(creds).isFile() || fs.lstatSync(creds).isSymbolicLink()) {
    throw new Error('Sessão do chip não encontrada para cópia de segurança.');
  }
  const userHash = crypto.createHash('sha256').update(userId).digest('hex');
  const folder = path.join(recoveryRoot, userHash);
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const target = path.join(folder, `${slotId}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`);
  let copiedFiles = 0;
  fs.cpSync(expected, target, {
    recursive: true, force: false, errorOnExist: true,
    filter: (src) => {
      const stat = fs.lstatSync(src);
      if (stat.isSymbolicLink()) throw new Error('Link simbólico não permitido no backup de sessão.');
      if (stat.isDirectory()) return true;
      if (!stat.isFile()) throw new Error('Arquivo especial não permitido no backup de sessão.');
      if (src.endsWith('.tmp')) return false;
      copiedFiles++;
      return true;
    }
  });
  const original = fs.readFileSync(creds);
  const snapshot = fs.readFileSync(path.join(target, 'creds.json'));
  if (!snapshot.length || !original.equals(snapshot)) throw new Error('Cópia da sessão não pôde ser verificada. Tente novamente.');
  return { copiedFiles };
}
