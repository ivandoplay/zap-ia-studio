import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const WHATSAPP_VOICE_MIMETYPE = 'audio/ogg; codecs=opus';

// Tabela CRC-32 oficial do container Ogg (RFC 3533: polinômio direto 0x04C11DB7, MSB-first, init 0, sem reflexão)
const OGG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = (i << 24) >>> 0;
    for (let j = 0; j < 8; j++) {
      if (r & 0x80000000) {
        r = (((r << 1) >>> 0) ^ 0x04c11db7) >>> 0;
      } else {
        r = (r << 1) >>> 0;
      }
    }
    table[i] = r >>> 0;
  }
  return table;
})();

export function computeOggCrc32(buf) {
  let crc = 0;
  for (let i = 0; i < buf.length; i++) {
    const idx = ((crc >>> 24) ^ buf[i]) & 0xff;
    crc = (((crc << 8) >>> 0) ^ OGG_CRC_TABLE[idx]) >>> 0;
  }
  return crc >>> 0;
}

/**
 * Verifica em JS puro se o buffer já é um container Ogg (OggS) contendo codec Opus (OpusHead).
 */
export function isNativeOggOpus(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 47) return false;
  if (buf.subarray(0, 4).toString('ascii') !== 'OggS') return false;
  const headWindow = buf.subarray(0, Math.min(buf.length, 256));
  return headWindow.includes(Buffer.from('OpusHead', 'ascii'));
}

/**
 * Reescreve a página OpusTags para ter vendor = "WhatsApp" e zero tags/capítulos extras
 * (previne falha de download no iPhone #2867 e remove assinatura Lavf/ffmpeg #144502),
 * recalculando o checksum CRC-32 oficial da página Ogg.
 */
export function patchOggOpusVendorTag(oggBuf, vendor = 'WhatsApp') {
  try {
    if (!isNativeOggOpus(oggBuf)) return oggBuf;
    const pages = [];
    let offset = 0;
    let patched = false;

    while (offset + 27 <= oggBuf.length) {
      if (oggBuf.subarray(offset, offset + 4).toString('ascii') !== 'OggS') {
        return oggBuf; // layout inesperado, mantém original intacto
      }
      const numSegments = oggBuf[offset + 26];
      const headerLen = 27 + numSegments;
      if (offset + headerLen > oggBuf.length) return oggBuf;

      let bodyLen = 0;
      for (let s = 0; s < numSegments; s++) {
        bodyLen += oggBuf[offset + 27 + s];
      }
      const pageEnd = offset + headerLen + bodyLen;
      if (pageEnd > oggBuf.length) return oggBuf;

      const body = oggBuf.subarray(offset + headerLen, pageEnd);
      if (!patched && body.length >= 16 && body.subarray(0, 8).toString('ascii') === 'OpusTags') {
        const vendorBytes = Buffer.from(vendor, 'utf8');
        // OpusTags (8) + vendor_len (4) + vendorBytes + user_comment_list_len=0 (4)
        const newBody = Buffer.alloc(8 + 4 + vendorBytes.length + 4);
        newBody.write('OpusTags', 0, 'ascii');
        newBody.writeUInt32LE(vendorBytes.length, 8);
        vendorBytes.copy(newBody, 12);
        newBody.writeUInt32LE(0, 12 + vendorBytes.length);

        if (newBody.length < 255) {
          const newPage = Buffer.alloc(27 + 1 + newBody.length);
          // Copia cabeçalho fixo (bytes 0..25), zera CRC (22..25), 1 segmento
          oggBuf.copy(newPage, 0, offset, offset + 26);
          newPage.writeUInt32LE(0, 22);
          newPage[26] = 1;
          newPage[27] = newBody.length;
          newBody.copy(newPage, 28);
          const crc = computeOggCrc32(newPage);
          newPage.writeUInt32LE(crc, 22);
          pages.push(newPage);
          patched = true;
          offset = pageEnd;
          continue;
        }
      }

      pages.push(oggBuf.subarray(offset, pageEnd));
      offset = pageEnd;
    }

    return patched ? Buffer.concat(pages) : oggBuf;
  } catch {
    return oggBuf;
  }
}

/**
 * Inspetor JS puro de Ogg/Opus: extrai duração exata (granule_position / 48000)
 * e gera waveform de 64 barras baseada na densidade energética dos pacotes Opus VBR.
 */
export function inspectOggOpusPureJs(oggBuf) {
  let preSkip = 312;
  let maxGranule = 0n;
  const packetSizes = [];
  let offset = 0;

  while (offset + 27 <= oggBuf.length) {
    if (oggBuf.subarray(offset, offset + 4).toString('ascii') !== 'OggS') break;
    const granule = oggBuf.readBigInt64LE(offset + 6);
    if (granule > maxGranule) maxGranule = granule;

    const numSegments = oggBuf[offset + 26];
    const headerLen = 27 + numSegments;
    if (offset + headerLen > oggBuf.length) break;

    let bodyLen = 0;
    let curPacket = 0;
    for (let s = 0; s < numSegments; s++) {
      const seg = oggBuf[offset + 27 + s];
      bodyLen += seg;
      curPacket += seg;
      if (seg < 255) {
        packetSizes.push(curPacket);
        curPacket = 0;
      }
    }
    const body = oggBuf.subarray(offset + headerLen, offset + headerLen + bodyLen);
    if (body.length >= 19 && body.subarray(0, 8).toString('ascii') === 'OpusHead') {
      preSkip = body.readUInt16LE(10);
    }
    offset += headerLen + bodyLen;
  }

  const totalSamples48k = maxGranule > BigInt(preSkip) ? Number(maxGranule - BigInt(preSkip)) : 0;
  const durationSec = Math.max(1, Math.round(totalSamples48k / 48000) || Math.round(oggBuf.length / 4000) || 1);

  // Ignora os 2 pacotes de cabeçalho (OpusHead e OpusTags)
  const audioPackets = packetSizes.slice(2);
  const waveform = new Array(64).fill(0);
  if (audioPackets.length > 0) {
    const minPkt = Math.min(...audioPackets);
    const maxPkt = Math.max(...audioPackets);
    const span = Math.max(1, maxPkt - minPkt);
    for (let i = 0; i < 64; i++) {
      const start = Math.floor((i * audioPackets.length) / 64);
      const end = Math.max(start + 1, Math.floor(((i + 1) * audioPackets.length) / 64));
      let sum = 0;
      for (let j = start; j < end && j < audioPackets.length; j++) {
        sum += (audioPackets[j] - minPkt) / span;
      }
      const norm = sum / (end - start);
      waveform[i] = Math.max(4, Math.min(100, Math.round(Math.pow(norm, 0.75) * 96)));
    }
  } else {
    for (let i = 0; i < 64; i++) waveform[i] = 18 + ((i * 13) % 55);
  }

  return { durationSec, waveform };
}

let cachedFfmpegPath = undefined;

// Semáforo leve (máx. 2 conversões FFmpeg simultâneas) para proteger RAM em celulares Android/Termux
let activeFfmpegJobs = 0;
const ffmpegWaitQueue = [];
async function withFfmpegSemaphore(fn) {
  if (activeFfmpegJobs >= 2) {
    await new Promise((resolve) => ffmpegWaitQueue.push(resolve));
  }
  activeFfmpegJobs += 1;
  try {
    return await fn();
  } finally {
    activeFfmpegJobs -= 1;
    const next = ffmpegWaitQueue.shift();
    if (next) next();
  }
}

/**
 * Localiza binário FFmpeg disponível (Windows, Termux Android ou Linux/VPS).
 */
export async function resolveFfmpegPath() {
  if (cachedFfmpegPath !== undefined) return cachedFfmpegPath;

  const candidates = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  candidates.push('ffmpeg');
  if (process.platform === 'android') {
    candidates.push('/data/data/com.termux/files/usr/bin/ffmpeg');
  }

  try {
    const mod = await import('ffmpeg-static');
    const staticBin = mod?.default || mod;
    if (typeof staticBin === 'string' && fs.existsSync(staticBin)) {
      candidates.push(staticBin);
    }
  } catch {
    // ffmpeg-static opcional
  }

  for (const bin of candidates) {
    try {
      await execFileAsync(bin, ['-version'], { timeout: 4000 });
      cachedFfmpegPath = bin;
      return bin;
    } catch {
      // tenta próximo
    }
  }

  cachedFfmpegPath = null;
  return null;
}

/**
 * Extrai a duração exata e as 64 barras reais de onda sonora (0..100) a partir do PCM mono 8kHz,
 * exatamente no padrão visual das Notas de Voz gravadas no WhatsApp celular.
 */
async function extractPcmWaveformAndDuration(ffmpegBin, oggFilePath) {
  const { stdout } = await execFileAsync(
    ffmpegBin,
    ['-v', 'error', '-i', oggFilePath, '-f', 's16le', '-ac', '1', '-ar', '8000', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: 48 * 1024 * 1024, timeout: 25000 }
  );

  const sampleCount = Math.floor(stdout.length / 2);
  if (sampleCount < 64) {
    return { durationSec: 1, waveform: new Array(64).fill(15) };
  }

  const durationSec = Math.max(1, Math.round(sampleCount / 8000));
  const blockSize = Math.max(1, Math.floor(sampleCount / 64));
  const rmsBlocks = new Float64Array(64);
  let maxRms = 0;

  for (let i = 0; i < 64; i++) {
    const startSample = i * blockSize;
    const endSample = i === 63 ? sampleCount : Math.min(sampleCount, (i + 1) * blockSize);
    const count = Math.max(1, endSample - startSample);
    let sumSq = 0;
    for (let s = startSample; s < endSample; s++) {
      const val = stdout.readInt16LE(s * 2) / 32768;
      sumSq += val * val;
    }
    const rms = Math.sqrt(sumSq / count);
    rmsBlocks[i] = rms;
    if (rms > maxRms) maxRms = rms;
  }

  const waveform = new Array(64);
  for (let i = 0; i < 64; i++) {
    if (maxRms <= 0.0005) {
      waveform[i] = 0;
      continue;
    }
    const norm = rmsBlocks[i] / maxRms;
    // Silêncio real fica baixo (0..3), fala ativa ganha curva perceptiva orgânica (0..100)
    const scaled = norm < 0.02 ? 0 : Math.round(Math.min(100, Math.pow(norm, 0.72) * 100));
    waveform[i] = scaled;
  }

  return { durationSec, waveform };
}

/**
 * Converte QUALQUER arquivo/gravação (.mp3, .m4a, .wav, .webm, .aac, .ogg, .opus)
 * para o formato ÚNICO nativo de Nota de Voz gravada na hora do WhatsApp:
 *   - Container: Ogg (OggS)
 *   - Codec: Opus Mono 16 kHz VoIP VBR 32 kbps (sem tags/capítulos, vendor="WhatsApp")
 *   - Mimetype exato: "audio/ogg; codecs=opus"
 *   - Metadados: seconds (inteiro) + waveform (64 barras 0..100)
 */
export async function convertToCanonicalWhatsAppVoice(inputBuffer, originalName = 'audio.ogg') {
  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length < 16) {
    throw new Error('Arquivo de áudio vazio ou inválido.');
  }

  const ffmpegBin = await resolveFfmpegPath();

  if (ffmpegBin) {
    return withFfmpegSemaphore(async () => {
      const tmpId = crypto.randomBytes(6).toString('hex');
      const safeExt = path.extname(originalName || '').replace(/[^a-zA-Z0-9.]/g, '') || '.bin';
      const tmpIn = path.join(os.tmpdir(), `zapia_in_${tmpId}${safeExt}`);
      const tmpOut = path.join(os.tmpdir(), `zapia_out_${tmpId}.ogg`);

      try {
        await fs.promises.writeFile(tmpIn, inputBuffer);
        await execFileAsync(
          ffmpegBin,
          [
            '-y',
            '-loglevel', 'error',
            '-err_detect', 'ignore_err',
            '-fflags', '+discardcorrupt',
            '-i', tmpIn,
            '-vn',
            '-map_metadata', '-1',
            '-map_chapters', '-1',
            '-ac', '1',
            '-ar', '16000',
            '-c:a', 'libopus',
            '-b:a', '32k',
            '-vbr', 'on',
            '-compression_level', '10',
            '-frame_duration', '20',
            '-application', 'voip',
            '-avoid_negative_ts', 'make_zero',
            '-f', 'ogg',
            tmpOut
          ],
          { timeout: 30000 }
        );

        const rawOgg = await fs.promises.readFile(tmpOut);
        const patchedOgg = patchOggOpusVendorTag(rawOgg, 'WhatsApp');

        let durationSec = 1;
        let waveform = new Array(64).fill(25);
        try {
          const meta = await extractPcmWaveformAndDuration(ffmpegBin, tmpOut);
          durationSec = meta.durationSec;
          waveform = meta.waveform;
        } catch {
          const fallbackMeta = inspectOggOpusPureJs(patchedOgg);
          durationSec = fallbackMeta.durationSec;
          waveform = fallbackMeta.waveform;
        }

        return {
          buffer: patchedOgg,
          mimeType: WHATSAPP_VOICE_MIMETYPE,
          extension: '.ogg',
          durationSec,
          waveform,
          sizeBytes: patchedOgg.length,
          transcoded: true
        };
      } finally {
        await fs.promises.unlink(tmpIn).catch(() => {});
        await fs.promises.unlink(tmpOut).catch(() => {});
      }
    });
  }

  // Fallback JS puro: aceita APENAS Ogg/Opus autêntico (nunca envia MP3/WebM disfarçado de PTT!)
  if (isNativeOggOpus(inputBuffer)) {
    const patchedOgg = patchOggOpusVendorTag(inputBuffer, 'WhatsApp');
    const { durationSec, waveform } = inspectOggOpusPureJs(patchedOgg);
    return {
      buffer: patchedOgg,
      mimeType: WHATSAPP_VOICE_MIMETYPE,
      extension: '.ogg',
      durationSec,
      waveform,
      sizeBytes: patchedOgg.length,
      transcoded: false
    };
  }

  throw new Error(
    'Conversor FFmpeg não encontrado para converter este formato em OGG/Opus nativo do WhatsApp. Envie um arquivo .ogg (Opus) ou rode o instalador (1_Instalar_No_Windows.bat / 4_Instalar_No_Termux.sh).'
  );
}
