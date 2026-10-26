import zlib from 'node:zlib';

// Tabela CRC32 IEEE 802.3 pré-computada para geração rápida de arquivos .ZIP puros
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32Buffer(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Gerador de arquivos .ZIP 100% JavaScript puro (usando apenas node:zlib nativo).
 * Permite exportar qualquer Perfil + Skills + Mensagens Aprovadas pelo painel sem binários C++.
 * @param {Array<{path: string, content: Buffer|string}>} entries
 * @returns {Buffer}
 */
export function createZipBuffer(entries = []) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  for (const entry of entries) {
    const cleanPath = String(entry.path || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    if (!cleanPath) continue;

    const nameBuf = Buffer.from(cleanPath, 'utf8');
    const rawBuf = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(String(entry.content ?? ''), 'utf8');

    const crc = crc32Buffer(rawBuf);
    const compressedBuf = zlib.deflateRawSync(rawBuf, { level: 9 });
    const useDeflate = compressedBuf.length < rawBuf.length;
    const dataBuf = useDeflate ? compressedBuf : rawBuf;
    const method = useDeflate ? 8 : 0;
    const flags = 0x0800; // Bit 11 = UTF-8 filename

    // Local File Header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(rawBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra len

    localParts.push(localHeader, nameBuf, dataBuf);

    // Central Directory Header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(rawBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra
    centralHeader.writeUInt16LE(0, 32); // comment
    centralHeader.writeUInt16LE(0, 34); // disk start
    centralHeader.writeUInt16LE(0, 36); // internal attr
    centralHeader.writeUInt32LE(((0o100644 & 0xffff) << 16) >>> 0, 38); // external attr
    centralHeader.writeUInt32LE(offset, 42); // local header offset

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + dataBuf.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const count = centralParts.length / 2;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

/**
 * Leitor de arquivos .ZIP 100% JavaScript puro (usando apenas node:zlib nativo).
 * Zero dependências C++ nativas — compatível com Windows, Linux VPS e Android Termux (ARM64).
 * Suporta métodos Store (0) e Deflate (8), nomes UTF-8 e proteção contra Zip Slip.
 */
export function extractZipBuffer(buffer, options = {}) {
  const maxTotalUncompressedBytes = options.maxTotalBytes || 60 * 1024 * 1024; // 60 MB limite seguro
  const maxFiles = options.maxFiles || 2000;

  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    throw new Error('Arquivo ZIP inválido ou vazio.');
  }

  let eocdOffset = -1;
  const minEocdOffset = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= minEocdOffset; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Estrutura Central Directory do ZIP não encontrada.');
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (totalEntries > maxFiles) {
    throw new Error(`O pacote ZIP excede o limite de segurança (${totalEntries} arquivos > ${maxFiles}).`);
  }
  if (cdOffset + cdSize > buffer.length) {
    throw new Error('Central Directory do ZIP truncado ou corrompido.');
  }

  const files = [];
  let totalUncompressed = 0;
  let ptr = cdOffset;

  for (let idx = 0; idx < totalEntries && ptr < cdOffset + cdSize; idx++) {
    const sig = buffer.readUInt32LE(ptr);
    if (sig !== 0x02014b50) {
      throw new Error('Assinatura inválida no cabeçalho do Central Directory.');
    }

    const flags = buffer.readUInt16LE(ptr + 8);
    const compressionMethod = buffer.readUInt16LE(ptr + 10);
    const compressedSize = buffer.readUInt32LE(ptr + 20);
    const uncompressedSize = buffer.readUInt32LE(ptr + 24);
    const fileNameLen = buffer.readUInt16LE(ptr + 28);
    const extraLen = buffer.readUInt16LE(ptr + 30);
    const commentLen = buffer.readUInt16LE(ptr + 32);
    const externalAttr = buffer.readUInt32LE(ptr + 38);
    const localHeaderOffset = buffer.readUInt32LE(ptr + 42);

    const nameStart = ptr + 46;
    const rawNameBuf = buffer.subarray(nameStart, nameStart + fileNameLen);
    const rawName = rawNameBuf.toString('utf8');
    ptr = nameStart + fileNameLen + extraLen + commentLen;

    const normalizedPath = rawName
      .replace(/\\/g, '/')
      .split('/')
      .filter((seg) => seg && seg !== '.' && seg !== '..')
      .join('/');

    if (!normalizedPath) continue;

    const isDirectory = rawName.endsWith('/') || ((externalAttr >> 16) & 0o170000) === 0o040000;
    if (isDirectory) continue;

    if (
      normalizedPath.startsWith('__MACOSX/') ||
      normalizedPath.endsWith('/.DS_Store') ||
      normalizedPath === '.DS_Store' ||
      normalizedPath.endsWith('/Thumbs.db')
    ) {
      continue;
    }

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > maxTotalUncompressedBytes) {
      throw new Error('Tamanho descompactado do ZIP excede o limite permitido (60 MB).');
    }

    if (localHeaderOffset + 30 > buffer.length) {
      throw new Error(`Cabeçalho local inválido para ${normalizedPath}`);
    }
    const localSig = buffer.readUInt32LE(localHeaderOffset);
    if (localSig !== 0x04034b50) {
      throw new Error(`Assinatura local inválida para ${normalizedPath}`);
    }

    const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > buffer.length) {
      throw new Error(`Dados comprimidos truncados em ${normalizedPath}`);
    }

    if ((flags & 0x0001) !== 0) {
      throw new Error(`O arquivo ${normalizedPath} está protegido por senha.`);
    }

    const compSlice = buffer.subarray(dataStart, dataEnd);
    let contentBuf;
    if (compressionMethod === 0) {
      contentBuf = Buffer.from(compSlice);
    } else if (compressionMethod === 8) {
      contentBuf = zlib.inflateRawSync(compSlice);
    } else {
      continue;
    }

    files.push({
      path: normalizedPath,
      size: contentBuf.length,
      buffer: contentBuf,
    });
  }

  let rootPrefix = '';
  if (files.length > 0) {
    const firstSlash = files[0].path.indexOf('/');
    if (firstSlash > 0) {
      const candidate = files[0].path.slice(0, firstSlash + 1);
      if (files.every((f) => f.path.startsWith(candidate))) {
        rootPrefix = candidate.slice(0, -1);
      }
    }
  }

  return {
    rootFolderName: rootPrefix || null,
    fileCount: files.length,
    totalBytes: totalUncompressed,
    files: files.map((f) => ({
      ...f,
      relPath: rootPrefix ? f.path.slice(rootPrefix.length + 1) : f.path,
    })),
  };
}
