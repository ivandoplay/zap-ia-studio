import test from 'node:test';
import assert from 'node:assert/strict';

process.env.EVOLUTION_API_URL = 'https://evolution.test';
process.env.EVOLUTION_API_KEY = 'global-test-key';
process.env.EVOLUTION_DEFAULT_USER_ID = 'tenant-1';
process.env.EVOLUTION_INSTANCE_USERS = '{}';

const requests = [];
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url: String(url), options });
  let body = {};
  if (String(url).endsWith('/instance/fetchInstances')) {
    body = [{ instanceName: 'zap-ia-slot_1', connectionStatus: 'open' }];
  } else if (String(url).includes('/instance/connectionState/')) {
    body = { instance: { instanceName: 'zap-ia-slot_1', state: 'open' } };
  } else if (String(url).includes('/chat/findMessages/')) {
    body = { messages: { records: [] } };
  } else {
    body = { key: { id: 'message-1' }, status: 'PENDING' };
  }
  return { ok: true, status: 201, text: async () => JSON.stringify(body) };
};
const { sendEvolutionApiText, sendEvolutionApiMedia, sendEvolutionApiContact, reactEvolutionApiMessage, editEvolutionApiMessage, deleteEvolutionApiMessage, markEvolutionApiRead, requestEvolutionApiHistory, getEvolutionApiChats, getEvolutionApiContacts } = await import('../src/evolutionApiCloud.js');

test('Evolution API v2 envia texto pela instância do tenant e usa endpoint/payload v2', async () => {
  requests.length = 0;
  const result = await sendEvolutionApiText('tenant-1', '558899999999@s.whatsapp.net', 'Olá');
  assert.deepEqual(result, { key: { id: 'message-1' }, status: 'PENDING' });
  const send = requests.find((r) => r.url.includes('/message/sendText/'));
  assert.ok(send);
  assert.equal(send.options.headers.apikey, 'global-test-key');
  assert.deepEqual(JSON.parse(send.options.body), { number: '558899999999', text: 'Olá' });
});

test('não desvia operação para outro chip quando o chip selecionado está desconectado', async () => {
  requests.length = 0;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    requests.push({ url: href, options });
    let body = {};
    if (href.endsWith('/instance/fetchInstances')) {
      body = [
        { instanceName: 'zap-ia-slot_1', connectionStatus: 'open' },
        { instanceName: 'zap-ia-slot_2', connectionStatus: 'close' },
      ];
    } else if (href.includes('/instance/connectionState/zap-ia-slot_2')) {
      body = { instance: { state: 'close' } };
    } else if (href.includes('/instance/connectionState/zap-ia-slot_1')) {
      body = { instance: { state: 'open' } };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };

  await assert.rejects(
    () => sendEvolutionApiText('tenant-1', 'slot_2::558899999999@s.whatsapp.net', 'Não enviar'),
    (error) => error.statusCode === 503 && /não será encaminhada para outro chip/.test(error.message)
  );
  assert.equal(requests.some((request) => request.url.includes('/message/sendText/')), false);
  assert.equal(requests.some((request) => request.url.includes('/instance/connectionState/zap-ia-slot_1')), false);
});

test('Histórico usa chat/findMessages com JID, paginação e offset limitado', async () => {
  requests.length = 0;
  await requestEvolutionApiHistory('tenant-1', '558899999999@s.whatsapp.net', 35, { id: 'wa-id-1' });
  const history = requests.find((r) => r.url.includes('/chat/findMessages/'));
  assert.ok(history);
  assert.deepEqual(JSON.parse(history.options.body), {
    where: { key: { remoteJid: '558899999999@s.whatsapp.net' } }, page: 1, offset: 35
  });
  requests.length = 0;
  await requestEvolutionApiHistory('tenant-1', '558899999999@s.whatsapp.net', 35, {}, 2);
  const nextPage = requests.find((r) => r.url.includes('/chat/findMessages/'));
  assert.equal(JSON.parse(nextPage.options.body).page, 2);
});

test('resposta HTTP 2xx com rejeição de aplicação não é tratada como envio aceito', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: false, message: 'Instância sem conexão' }) });
  await assert.rejects(() => sendEvolutionApiText('tenant-1', '558899999999@s.whatsapp.net', 'Não enviar'), /Instância sem conexão/);
});



test('findChats importa somente conversas do slot do tenant e respeita a paginação', async () => {
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    requests.push({ url: href, options });
    let body = {};
    if (href.endsWith('/instance/fetchInstances')) body = [{ instanceName: 'zap-ia-slot_1', connectionStatus: 'open' }];
    else if (href.includes('/instance/connectionState/')) body = { instance: { state: 'open' } };
    else if (href.includes('/chat/findChats/')) body = [{ remoteJid: '558899999999@s.whatsapp.net', pushName: 'Ana', updatedAt: '2024-01-01T00:00:00.000Z' }];
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  requests.length = 0;
  const result = await getEvolutionApiChats('tenant-1', { limit: 25, offset: 50 });
  assert.equal(result.chats.length, 1);
  assert.equal(result.chats[0].chatId, '558899999999@s.whatsapp.net');
  assert.equal(result.chats[0].name, 'Ana');
  const query = requests.find((r) => r.url.includes('/chat/findChats/'));
  assert.deepEqual(JSON.parse(query.options.body), { where: {}, take: 25, skip: 50 });
});


test('findChats conserva LID, associa telefone alternativo e descarta o rótulo “Você”', async () => {
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    requests.push({ url: href, options });
    let body = {};
    if (href.endsWith('/instance/fetchInstances')) body = [{ instanceName: 'zap-ia-slot_1', connectionStatus: 'open' }];
    else if (href.includes('/instance/connectionState/')) body = { instance: { state: 'open' } };
    else if (href.includes('/chat/findChats/')) body = [
      { remoteJid: '187359475818564@lid', remoteJidAlt: '5588999991111@s.whatsapp.net', name: 'Maria Costa', pushName: 'Você' },
      { remoteJid: '203869363691598', pushName: '203869363691598' },
    ];
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  requests.length = 0;
  const result = await getEvolutionApiChats('tenant-1', { limit: 25 });
  assert.equal(result.chats.length, 2);
  assert.equal(result.chats[0].chatId, '187359475818564@lid');
  assert.equal(result.chats[0].phone, '5588999991111');
  assert.equal(result.chats[0].name, 'Maria Costa');
  assert.equal(result.chats[1].chatId, '203869363691598@lid');
  assert.equal(result.chats[1].phone, undefined);
  assert.equal(result.chats[1].name, null);
});

test('findContacts lê o contrato documentado, usa number como fallback e mantém escopo por slot', async () => {
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    requests.push({ url: href, options });
    let body = {};
    if (href.endsWith('/instance/fetchInstances')) {
      body = [
        { instanceName: 'zap-ia-slot_1', connectionStatus: 'open' },
        { instanceName: 'zap-ia-slot_2', connectionStatus: 'open' }
      ];
    } else if (href.includes('/instance/connectionState/')) {
      body = { instance: { state: 'open' } };
    } else if (href.includes('/chat/findContacts/zap-ia-slot_1')) {
      body = [{ id: '5586999998888@s.whatsapp.net', pushName: 'Ana', number: '5586999998888', profilePictureUrl: 'https://img.test/ana.jpg' }];
    } else if (href.includes('/chat/findContacts/zap-ia-slot_2')) {
      // A documentação da API também permite resposta contendo apenas number.
      body = [{ pushName: 'Ana (outro chip)', number: '5586999998888' }];
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  requests.length = 0;
  const contacts = await getEvolutionApiContacts('tenant-1');
  assert.equal(contacts.length, 2, 'o mesmo JID em dois chips deve continuar em dois escopos distintos');
  assert.equal(contacts[0].chatId, '5586999998888@s.whatsapp.net');
  assert.equal(contacts[0].name, 'Ana');
  assert.equal(contacts[0].phone, '5586999998888');
  assert.equal(contacts[0].avatarUrl, 'https://img.test/ana.jpg');
  assert.equal(contacts[0].savedContact, false, 'contato da agenda Evolution não é automaticamente salvo no CRM');
  assert.equal(contacts[0].directoryImport, true);
  assert.equal(contacts[1].chatId, 'slot_2::5586999998888@s.whatsapp.net');
  assert.equal(contacts[1].name, 'Ana (outro chip)');
  const calls = requests.filter((r) => r.url.includes('/chat/findContacts/'));
  assert.equal(calls.length, 2);
  for (const call of calls) assert.deepEqual(JSON.parse(call.options.body), { where: {}, take: 1000, skip: 0 });
});

test('findContacts não mostra LID como telefone, ignora “Você” e prioriza o nome salvo', async () => {
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    requests.push({ url: href, options });
    let body = {};
    if (href.endsWith('/instance/fetchInstances')) body = [{ instanceName: 'zap-ia-slot_1', connectionStatus: 'open' }];
    else if (href.includes('/instance/connectionState/')) body = { instance: { state: 'open' } };
    else if (href.includes('/chat/findContacts/')) body = [
      { id: '187359475818564@lid', number: '187359475818564', phoneNumber: '5588999991111', name: '', pushName: 'Você' },
      { id: '203869363691598', number: '203869363691598', pushName: '203869363691598' },
      { id: '5588999992222@s.whatsapp.net', number: '5588999992222', name: 'Ana Salva', pushName: 'Ana WhatsApp' },
    ];
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  requests.length = 0;
  const contacts = await getEvolutionApiContacts('tenant-1');
  assert.equal(contacts.length, 3);
  assert.equal(contacts[0].chatId, '187359475818564@lid');
  assert.equal(contacts[0].phone, '5588999991111');
  assert.equal(contacts[0].name, null, '“Você” não é nome de um contato');
  assert.equal(contacts[1].chatId, '203869363691598@lid', 'identificador longo sem JID não deve virar número @s.whatsapp.net');
  assert.equal(contacts[1].phone, '', 'não apresentar LID como telefone real');
  assert.equal(contacts[1].name, null, 'LID numérico também não deve aparecer como nome');
  assert.equal(contacts[2].name, 'Ana Salva', 'nome da agenda tem prioridade sobre pushName de perfil');
  assert.equal(contacts[2].phone, '5588999992222');
});

test('findContacts percorre páginas de 1000 usando skip até o final', async () => {
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    requests.push({ url: href, options });
    let body = {};
    if (href.endsWith('/instance/fetchInstances')) body = [{ instanceName: 'zap-ia-slot_1', connectionStatus: 'open' }];
    else if (href.includes('/instance/connectionState/')) body = { instance: { state: 'open' } };
    else if (href.includes('/chat/findContacts/')) {
      const { skip } = JSON.parse(options.body);
      const count = skip === 0 ? 1000 : 2;
      body = Array.from({ length: count }, (_, i) => ({
        id: `${5586000000000 + skip + i}@s.whatsapp.net`,
        number: String(5586000000000 + skip + i),
        pushName: `Pessoa ${skip + i}`
      }));
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  requests.length = 0;
  const contacts = await getEvolutionApiContacts('tenant-1');
  assert.equal(contacts.length, 1002);
  const calls = requests.filter((r) => r.url.includes('/chat/findContacts/'));
  assert.deepEqual(calls.map((call) => JSON.parse(call.options.body).skip), [0, 1000]);
});

test('contratos auxiliares usam os payloads definidos no Evolution API v2.3.7', async () => {
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    requests.push({ url: href, options });
    let body = { key: { id: 'message-1' }, status: 'PENDING' };
    if (href.endsWith('/instance/fetchInstances')) body = [{ instanceName: 'zap-ia-slot_1', connectionStatus: 'open' }];
    else if (href.includes('/instance/connectionState/')) body = { instance: { instanceName: 'zap-ia-slot_1', state: 'open' } };
    return { ok: true, status: 201, text: async () => JSON.stringify(body) };
  };
  requests.length = 0;
  await sendEvolutionApiMedia('tenant-1', '558899999999@s.whatsapp.net', { url: 'https://files.test/photo.png', type: 'image', caption: 'Foto', filename: 'foto.png', mimeType: 'image/png' });
  await sendEvolutionApiContact('tenant-1', '558899999999@s.whatsapp.net', { name: 'Contato', phone: '558899999999', company: 'Empresa' });
  await reactEvolutionApiMessage('tenant-1', '558899999999@s.whatsapp.net', 'msg-1', '👍', false);
  await editEvolutionApiMessage('tenant-1', '558899999999@s.whatsapp.net', 'msg-1', 'Corrigida');
  await deleteEvolutionApiMessage('tenant-1', '558899999999@s.whatsapp.net', 'msg-1');
  await markEvolutionApiRead('tenant-1', '558899999999@s.whatsapp.net', ['msg-1']);

  const bodyFor = (path) => JSON.parse(requests.find((r) => r.url.includes(path)).options.body);
  assert.deepEqual(bodyFor('/message/sendMedia/'), { number: '558899999999', mediatype: 'image', media: 'https://files.test/photo.png', caption: 'Foto', fileName: 'foto.png', mimetype: 'image/png' });
  assert.deepEqual(bodyFor('/message/sendContact/'), { number: '558899999999', contact: [{ fullName: 'Contato', wuid: '558899999999', phoneNumber: '+558899999999', organization: 'Empresa' }] });
  assert.deepEqual(bodyFor('/message/sendReaction/'), { key: { remoteJid: '558899999999@s.whatsapp.net', fromMe: false, id: 'msg-1' }, reaction: '👍' });
  assert.deepEqual(bodyFor('/chat/updateMessage/'), { number: '558899999999', key: { remoteJid: '558899999999@s.whatsapp.net', fromMe: true, id: 'msg-1' }, text: 'Corrigida' });
  assert.deepEqual(bodyFor('/chat/deleteMessageForEveryone/'), { id: 'msg-1', remoteJid: '558899999999@s.whatsapp.net', fromMe: true });
  assert.deepEqual(bodyFor('/chat/markMessageAsRead/'), { readMessages: [{ id: 'msg-1', remoteJid: '558899999999@s.whatsapp.net', fromMe: false }] });

  const callsBeforeEmptyRead = requests.length;
  assert.deepEqual(await markEvolutionApiRead('tenant-1', '558899999999@s.whatsapp.net', []), { skipped: true, reason: 'no-message-ids' });
  assert.equal(requests.length, callsBeforeEmptyRead, 'lista vazia não deve chamar a API que rejeita readMessages vazio');
});
