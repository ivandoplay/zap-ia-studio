// Gerador Oficial de PIX Copia e Cola (Padrão EMV / Banco Central) + Imagem QR Code PNG
import QRCode from 'qrcode';

function stripAccents(str = '') {
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim();
}

function emvField(id, value) {
  const val = String(value ?? '');
  const len = String(val.length).padStart(2, '0');
  return `${id}${len}${val}`;
}

function crc16CCITT(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function normalizePixKey(key = '', keyType = 'aleatoria') {
  const trimmed = String(key).trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/\D/g, '');
  if (keyType === 'cpf' || keyType === 'cnpj') {
    return digits;
  }
  if (keyType === 'celular') {
    if (trimmed.startsWith('+')) return '+' + digits;
    if (digits.length === 11 || digits.length === 10) return `+55${digits}`;
    if (digits.startsWith('55') && digits.length >= 12) return `+${digits}`;
    return '+' + digits;
  }
  return trimmed;
}

export function generatePixBrCode({ key, keyType = 'aleatoria', receiverName = 'LOJA', city = 'BRASIL', amount = null, txid = '***' }) {
  const normalizedKey = normalizePixKey(key, keyType);
  if (!normalizedKey) return null;

  const cleanName = (stripAccents(receiverName) || 'RECEBEDOR').substring(0, 25).toUpperCase();
  const cleanCity = (stripAccents(city) || 'BRASIL').substring(0, 15).toUpperCase();
  const cleanTxid = (stripAccents(txid).replace(/\s+/g, '') || '***').substring(0, 25);

  const gui = emvField('00', 'br.gov.bcb.pix');
  const keyField = emvField('01', normalizedKey);
  const merchantAccountInfo = emvField('26', `${gui}${keyField}`);

  let payload = '';
  payload += emvField('00', '01'); // Payload Format Indicator
  payload += merchantAccountInfo;
  payload += emvField('52', '0000'); // Merchant Category Code
  payload += emvField('53', '986'); // Currency BRL

  const numAmount = typeof amount === 'string'
    ? parseFloat(amount.replace(/\./g, '').replace(',', '.'))
    : Number(amount);

  if (!Number.isNaN(numAmount) && numAmount > 0) {
    payload += emvField('54', numAmount.toFixed(2));
  }

  payload += emvField('58', 'BR');
  payload += emvField('59', cleanName);
  payload += emvField('60', cleanCity);
  payload += emvField('62', emvField('05', cleanTxid === '***' ? '***' : cleanTxid));
  payload += '6304'; // CRC16 ID + Length

  const crc = crc16CCITT(payload);
  return `${payload}${crc}`;
}

export async function generatePixQrDataUrl(brcode) {
  if (!brcode) return null;
  try {
    return await QRCode.toDataURL(brcode, {
      width: 440,
      margin: 2,
      color: { dark: '#0F172A', light: '#FFFFFF' }
    });
  } catch {
    return null;
  }
}

export async function generatePixQrBuffer(brcode) {
  if (!brcode) return null;
  try {
    return await QRCode.toBuffer(brcode, {
      type: 'png',
      width: 520,
      margin: 2,
      color: { dark: '#0F172A', light: '#FFFFFF' }
    });
  } catch {
    return null;
  }
}

export function formatPixMessage(pixConfig = {}, requestedAmount = null) {
  if (!pixConfig?.enabled || !pixConfig?.key) return null;

  const typeLabels = {
    cpf: 'CPF',
    cnpj: 'CNPJ',
    celular: 'Celular',
    email: 'E-mail',
    aleatoria: 'Chave Aleatória'
  };

  const lines = [
    '*DADOS PARA PAGAMENTO VIA PIX*',
    '',
    `*Tipo:* ${typeLabels[pixConfig.keyType] || 'Chave PIX'}`,
    `*Chave:* ${pixConfig.key}`
  ];

  if (pixConfig.receiverName) {
    lines.push(`*Favorecido:* ${pixConfig.receiverName}`);
  }
  if (pixConfig.bankName) {
    lines.push(`*Instituição:* ${pixConfig.bankName}`);
  }

  const numAmount = requestedAmount
    ? parseFloat(String(requestedAmount).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'))
    : NaN;

  if (!Number.isNaN(numAmount) && numAmount > 0) {
    lines.push(`*Valor:* R$ ${numAmount.toFixed(2).replace('.', ',')}`);
  }

  if (pixConfig.instructions) {
    lines.push('', `${pixConfig.instructions}`);
  } else {
    lines.push('', '_Assim que realizar o pagamento, envie o comprovante por aqui para confirmarmos na hora!_');
  }

  const brcode = generatePixBrCode({
    key: pixConfig.key,
    keyType: pixConfig.keyType,
    receiverName: pixConfig.receiverName || 'ATENDIMENTO',
    city: pixConfig.city || 'BRASIL',
    amount: !Number.isNaN(numAmount) && numAmount > 0 ? numAmount : null
  });

  return {
    summaryText: lines.join('\n'),
    rawKey: pixConfig.key,
    brcode: pixConfig.includeCopyPaste !== false ? brcode : null,
    qrBrcode: brcode,
    sendQrImage: pixConfig.sendQrImage !== false
  };
}

export async function formatPixMessageWithQr(pixConfig = {}, requestedAmount = null) {
  const base = formatPixMessage(pixConfig, requestedAmount);
  if (!base) return null;
  let qrDataUrl = null;
  let qrBuffer = null;
  if (base.qrBrcode && base.sendQrImage) {
    [qrDataUrl, qrBuffer] = await Promise.all([
      generatePixQrDataUrl(base.qrBrcode),
      generatePixQrBuffer(base.qrBrcode)
    ]);
  }
  return {
    ...base,
    qrDataUrl,
    qrBuffer
  };
}
