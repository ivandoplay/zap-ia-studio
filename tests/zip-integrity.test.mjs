import assert from 'node:assert/strict';
import { createZipBuffer, extractZipBuffer } from '../src/zipReader.js';

function offsets(zip) {
  const eocd = zip.length - 22;
  const central = zip.readUInt32LE(eocd + 16);
  const local = zip.readUInt32LE(central + 42);
  return { central, data: local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28) };
}

const archive = createZipBuffer([{ path: 'pacote/perfil.json', content: '{"ok":true}' }]);
const intact = extractZipBuffer(archive);
assert.equal(intact.files[0].buffer.toString(), '{"ok":true}');
assert.equal(archive.readUInt16LE(offsets(archive).central + 10), 0, 'Usar arquivo armazenado sem compressão para o teste');

const damaged = Buffer.from(archive);
damaged[offsets(damaged).data] ^= 1;
assert.throws(() => extractZipBuffer(damaged), /integridade|corrompido|CRC/i, 'ZIP modificado não deve ser importado silenciosamente');

const wrongLength = Buffer.from(archive);
wrongLength.writeUInt32LE(123, offsets(wrongLength).central + 24);
assert.throws(() => extractZipBuffer(wrongLength), /tamanho|corrompido/i, 'Tamanho informado deve corresponder ao conteúdo');

const truncatedDirectory = Buffer.from(archive);
truncatedDirectory.writeUInt16LE(2, truncatedDirectory.length - 22 + 10);
assert.throws(() => extractZipBuffer(truncatedDirectory), /incompleto|corrompido/i);
const unsupported = Buffer.from(archive);
unsupported.writeUInt16LE(99, offsets(unsupported).central + 10);
assert.throws(() => extractZipBuffer(unsupported), /não suportado/i);
const compressed = createZipBuffer([{ path: 'pasta/longo.txt', content: 'abc'.repeat(1000) }]);
assert.equal(compressed.readUInt16LE(offsets(compressed).central + 10), 8);
assert.equal(extractZipBuffer(compressed).files[0].buffer.toString(), 'abc'.repeat(1000));
console.log('OK: ZIPs íntegros aceitos; dados, tamanho, diretório e método inválidos rejeitados.');
