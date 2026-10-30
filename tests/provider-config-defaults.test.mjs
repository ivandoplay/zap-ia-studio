import test from 'node:test';
import assert from 'node:assert/strict';
import { getProviderCredentialsByName, generateSmartReply } from '../src/aiEngine.js';
import { storage } from '../src/storage.js';

test('Groq usa o modelo padrão atual e não o ID antigo que retornava model_not_found', () => {
  const creds = getProviderCredentialsByName('groq', { groqApiKey: 'gsk-test-key' });
  assert.equal(creds.model, 'openai/gpt-oss-20b');
  assert.equal(creds.apiKey, 'gsk-test-key');
});

test('migra o ID antigo llama-3.3-70b-versatile para o modelo padrão atualizado', () => {
  const creds = getProviderCredentialsByName('groq', {
    groqApiKey: 'gsk-test-key',
    groqModel: 'llama-3.3-70b-versatile'
  });
  assert.equal(creds.model, 'openai/gpt-oss-20b');
});

test('OpenRouter usa o roteador gratuito como padrão quando o modelo não foi definido', () => {
  const creds = getProviderCredentialsByName('openrouter', { openrouterApiKey: 'sk-or-test-key' });
  assert.equal(creds.model, 'openrouter/free');
});

test('OpenRouter pode usar chave Groq separada para transcrever áudio recebido', () => {
  const creds = getProviderCredentialsByName('openrouter', {
    openrouterApiKey: 'sk-or-test-key',
    audioTranscriptionApiKey: 'gsk-transcription-test'
  });
  assert.equal(creds.provider, 'openrouter');
  assert.equal(creds.audioTranscriptionApiKey, 'gsk-transcription-test');
  assert.equal(creds.apiKey, 'sk-or-test-key');
});

test('Groq também reutiliza sua chave de provedor para Whisper quando não há chave STT separada', () => {
  const creds = getProviderCredentialsByName('groq', { groqApiKey: 'gsk-test-key' });
  assert.equal(creds.audioTranscriptionApiKey, 'gsk-test-key');
});

test('áudio transcrito uma vez é reutilizado no fallback sem novo upload ao Whisper', async () => {
  const originalFetch = globalThis.fetch;
  let transcriptionCalls = 0;
  let chatCalls = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/audio/transcriptions')) {
      transcriptionCalls++;
      return new Response(JSON.stringify({ text: 'quero saber o preço' }), { status: 200 });
    }
    if (target.includes('openrouter.ai')) {
      chatCalls++;
      return new Response(JSON.stringify({ error: { message: 'falha sintética' } }), { status: 503 });
    }
    if (target.includes('api.groq.com/openai/v1/chat/completions')) {
      chatCalls++;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'O valor depende do plano.' } }] }), { status: 200 });
    }
    throw new Error(`URL inesperada no teste: ${target}`);
  };
  try {
    const reply = await generateSmartReply({
      profile: storage.getBusiness(),
      settings: { ai: {
        provider: 'openrouter', openrouterApiKey: 'sk-or-test', openrouterModel: 'openrouter/free',
        groqApiKey: 'gsk-test', groqModel: 'openai/gpt-oss-20b',
        autoFallbackProvider: 'groq'
      } },
      history: [], userText: '', media: { buffer: Buffer.from('synthetic-audio'), mimeType: 'audio/ogg' },
      contactName: 'Teste', allowDemoFallback: false
    });
    assert.equal(transcriptionCalls, 1);
    assert.equal(chatCalls, 2);
    assert.equal(reply.providerUsed, 'groq');
    assert.equal(reply.usedFallback, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
