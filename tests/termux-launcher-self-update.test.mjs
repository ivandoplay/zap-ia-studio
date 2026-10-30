import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launcher = path.join(root, 'dist_kit', 'INICIAR_NO_TERMUX.sh');

test('launcher Termux passa no parser Bash e se protege de auto-substituição durante o update', () => {
  const script = fs.readFileSync(launcher, 'utf8');
  const syntax = spawnSync('bash', ['-n', launcher], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout || 'bash -n falhou');
  assert.ok(script.includes('ZAPIA_TERMUX_BOOT_SNAPSHOT'), 'deve executar uma cópia imutável do launcher');
  assert.ok(script.indexOf('exec bash "$SNAPSHOT_FILE"') < script.indexOf('scripts/auto_update_boot.mjs'), 'o snapshot deve acontecer antes do auto-update');
  assert.ok(script.includes('ZAPIA_TERMUX_BOOT_ORIGINAL'), 'deve manter o diretório da instalação original após o exec');
  assert.ok(!/^stall\s/m.test(script), 'não pode haver fragmento "stall" separado como comando');
});

test('scripts Termux incluídos no kit passam no parser Bash', () => {
  for (const rel of ['4_Instalar_No_Termux.sh', '5_Iniciar_No_Termux.sh']) {
    const file = path.join(root, rel);
    const syntax = spawnSync('bash', ['-n', file], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, `${rel}: ${syntax.stderr || syntax.stdout}`);
  }
});
