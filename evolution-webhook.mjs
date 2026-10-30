/**
 * Evolution Go Webhook Server (standalone / VPS)
 * Servidor Express dedicado que usa o router compartilhado src/evolutionGoWebhook.js.
 * Para Vercel, o webhook já está integrado no motor (src/server.js) — não precisa deste arquivo.
 *
 * Roda: node evolution-webhook.mjs   (porta 3001)
 * Rotas: POST /webhook · GET /health · GET /status · POST /send
 */

import express from 'express';
import { evolutionGoWebhookRouter } from './src/evolutionGoWebhook.js';

const app = express();
app.use(evolutionGoWebhookRouter);

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Evolution Go Webhook rodando em :${PORT}`);
  console.log(`   Webhook: http://localhost:${PORT}/webhook`);
  console.log(`   Health:  http://localhost:${PORT}/health`);
  console.log(`   Status:  http://localhost:${PORT}/status`);
});
