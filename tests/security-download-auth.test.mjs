import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');

test('session JWT and panel PIN are not accepted from query strings', () => {
  assert.doesNotMatch(server, /req\.query\??\.token/);
  assert.doesNotMatch(server, /req\.query\??\.pin/);
  assert.match(server, /req\.headers\.authorization/);
  assert.match(server, /x-panel-pin/);
});

test('export downloads authenticate with headers and do not put secrets in URLs', () => {
  assert.doesNotMatch(app, /buildDownloadQuery/);
  assert.doesNotMatch(app, /params\.set\(['"]token['"]/);
  assert.doesNotMatch(app, /params\.set\(['"]pin['"]/);
  assert.match(app, /headers\.Authorization/);
  assert.match(app, /headers\[['"]x-panel-pin['"]\]/);
  assert.match(app, /headers\[['"]x-zapia-act-as['"]\]/);
  for (const endpoint of ['/api/business/export.zip', '/api/system/backup.json', '/api/crm/export.csv']) {
    assert.ok(app.includes(`downloadAuthenticated('${endpoint}'`), `download autenticado ausente: ${endpoint}`);
  }
});
