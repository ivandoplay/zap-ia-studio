// Preview LOCAL das telas (dados fictícios). Separado do servidor operacional:
// não importa src/server.js, .env, WhatsApp ou Supabase. A API é um stub sintético.
// Uso: PORT=4185 node scripts/preview-local-menu.mjs
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.disable('x-powered-by');
app.use(express.json());

// Login falso para atravessar a porta de entrada com um usuário de demonstração.
app.post('/api/auth/login', (_req, res) => {
  res.json({
    ok: true,
    mode: 'local_demo',
    session: { access_token: 'DEMO-TOKEN', refresh_token: 'DEMO-REFRESH', token_type: 'bearer', expires_in: 31536000 },
    user: { id: 'demo-preview', username: 'voce', displayName: 'Você (demonstração)', role: 'user' }
  });
});
// Qualquer outra API: resposta controlada (nunca toca nada real).
app.all(/^\/api\/.*/, (_req, res) => res.json({ ok: false, error: 'demo_sem_api' }));

app.use(express.static(path.join(root, 'public')));
const porta = Number(process.env.PORT || 4185);
app.listen(porta, '0.0.0.0', () => {
  console.log(`Demo local do menu novo em http://127.0.0.1:${porta}/ (dados fictícios, sem operação real)`);
});
