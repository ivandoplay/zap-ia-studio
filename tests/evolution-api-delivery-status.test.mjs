import assert from 'node:assert/strict';
import { Storage } from '../src/storage.js';

const storage = new Storage({ inMemory: true, initialData: { contacts: {} } });
const chatId = '5511999999999@s.whatsapp.net';
const contact = storage.appendContactMessage(chatId, {
  role: 'owner', text: 'Teste', waMsgId: 'provider-id', deliveryStatus: 'accepted'
});
assert.equal(contact.messages.at(-1).deliveryStatus, 'accepted');
storage.applyMessageAck(chatId, 'provider-id', 1);
assert.equal(contact.messages.at(-1).ack, 1);
assert.equal(contact.messages.at(-1).deliveryStatus, undefined);
console.log('OK: o status aceito fica pendente até surgir ACK real do WhatsApp.');
