import test from 'node:test';
import assert from 'node:assert/strict';
import { getProviderCredentialsByName, generateSmartReply, transcribeVoiceBufferWithAi } from '../src/aiEngine.js';

// Chaves de teste com ≥16 chars (parseGeminiKeyPool filtra chaves curtas)
const GEMINI_KEY = 'AIzaSyD-test-key-0123456789ab';
const GEMINI_KEY2 = 'AIzaSyD-test-key-bcdef0123456';
const OPENROUTER_KEY = 'sk-or-test-key-abcdefghijklmnop';

test('Gemini usa o modelo padrão gemini-3.5-flash-lite quando não definido', () => {
  const creds = getProviderCredentialsByName('gemini', {});
  assert.equal(creds.provider, 'gemini');
  assert.equal(creds.model, 'gemini-3.5-flash-lite');
  assert.deepEqual(creds.apiKeys, []);
});

test('Gemini aceita modelo personalizado e chave configurada', () => {
  const creds = getProviderCredentialsByName('gemini', { geminiModel: 'gemini-2.5-pro', geminiApiKey: GEMINI_KEY });
  assert.equal(creds.provider, 'gemini');
  assert.equal(creds.model, 'gemini-2.5-pro');
  assert.equal(creds.apiKey, GEMINI_KEY);
});

test('Gemini parsea pool de chaves (GEMINI_KEY_POOL)', () => {
  const creds = getProviderCredentialsByName('gemini', {
    geminiKeyPool: `${GEMINI_KEY}\n${GEMINI_KEY2}`,
    geminiApiKey: GEMINI_KEY
  });
  assert.equal(creds.apiKeys.length, 2);
  assert.equal(creds.apiKey, GEMINI_KEY);
});

test('OpenRouter usa deepseek/deepseek-chat como padrão quando o modelo não foi definido', () => {
  const creds = getProviderCredentialsByName('openrouter', { openrouterApiKey: OPENROUTER_KEY });
  assert.equal(creds.provider, 'openrouter');
  assert.equal(creds.model, 'deepseek/deepseek-chat');
  assert.equal(creds.apiKey, OPENROUTER_KEY);
  assert.equal(creds.baseUrl, 'https://openrouter.ai/api/v1');
});

test('OpenRouter aceita modelo personalizado', () => {
  const creds = getProviderCredentialsByName('openrouter', {
    openrouterApiKey: OPENROUTER_KEY,
    openrouterModel: 'anthropic/claude-sonnet-4.5'
  });
  assert.equal(creds.model, 'anthropic/claude-sonnet-4.5');
});

test('provedor desconhecido retorna fallback para Gemini', () => {
  const creds = getProviderCredentialsByName('groq', { groqApiKey: 'gsk-test' });
  assert.equal(creds.provider, 'gemini');
  assert.equal(creds.apiKey, '');
});

test('providerMode auto: áudio vai para Gemini, texto vai para OpenRouter', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.includes('generativelanguage')) {
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'transcrito' }] } }]
      }), { status: 200 });
    }
    if (target.includes('openrouter.ai')) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'resposta do openrouter' } }]
      }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
  try {
    // Texto → OpenRouter
    const textReply = await generateSmartReply({
      profile: { summary: 'teste', services: [] },
      settings: { ai: {
        provider: 'gemini', providerMode: 'auto',
        geminiApiKey: GEMINI_KEY, openrouterApiKey: OPENROUTER_KEY
      } },
      history: [], userText: 'ola', media: null,
      contactName: 'Teste', allowDemoFallback: false
    });
    assert.equal(textReply.providerUsed, 'openrouter');
    assert.equal(textReply.usedFallback, false);

    // Áudio → Gemini
    const audioReply = await generateSmartReply({
      profile: { summary: 'teste', services: [] },
      settings: { ai: {
        provider: 'openrouter', providerMode: 'auto',
        geminiApiKey: GEMINI_KEY, openrouterApiKey: OPENROUTER_KEY
      } },
      history: [], userText: '',
      media: { buffer: Buffer.from('audio'), mimeType: 'audio/ogg' },
      contactName: 'Teste', allowDemoFallback: false
    });
    assert.equal(audioReply.providerUsed, 'gemini');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('providerMode fallback: reserva é acionada quando o provedor principal falha', async () => {
  const originalFetch = globalThis.fetch;
  let primaryCalls = 0;
  let fallbackCalls = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('openrouter.ai')) {
      primaryCalls++;
      return new Response(JSON.stringify({ error: { message: 'falha' } }), { status: 503 });
    }
    if (target.includes('generativelanguage')) {
      fallbackCalls++;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'resposta do gemini' }] } }]
      }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
  try {
    const reply = await generateSmartReply({
      profile: { summary: 'teste', services: [] },
      settings: { ai: {
        provider: 'openrouter', providerMode: 'fallback',
        autoFallbackProvider: 'gemini',
        openrouterApiKey: OPENROUTER_KEY,
        geminiApiKey: GEMINI_KEY
      } },
      history: [], userText: 'ola', media: null,
      contactName: 'Teste', allowDemoFallback: false
    });
    assert.equal(primaryCalls, 1);
    assert.equal(fallbackCalls, 1);
    assert.equal(reply.providerUsed, 'gemini');
    assert.equal(reply.usedFallback, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('transcrição de áudio usa Gemini quando a chave está configurada', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'o texto do audio' }] } }]
    }), { status: 200 });
  };
  try {
    const text = await transcribeVoiceBufferWithAi(
      Buffer.from('audio'),
      'audio/ogg',
      { geminiApiKey: GEMINI_KEY }
    );
    assert.equal(text, 'o texto do audio');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('transcrição de áudio falha sem chave de Gemini', async () => {
  await assert.rejects(
    transcribeVoiceBufferWithAi(Buffer.from('audio'), 'audio/ogg', {}),
    /Configure sua chave gratuita do Google Gemini/
  );
});
