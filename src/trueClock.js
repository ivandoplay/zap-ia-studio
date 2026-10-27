/**
 * ZAP-IA Studio — Sincronizador Automático de Relógio UTC Real (TrueClock)
 * Resolve 100% o clássico problema de PCs Dual-Boot (Windows + Linux/antiX) ou baterias CMOS
 * onde o relógio do sistema operacional está defasado em horas (ex: UTC-3 gravado como UTC na BIOS),
 * impedindo que mensagens enviadas sumam atrás de historyClearedAt ou que o heartbeat na nuvem pareça offline.
 */

import { SUPABASE_URL } from './cloudConfig.js';

let clockOffsetMs = 0;
let calibratedOnce = false;
let calibrationPromise = null;

export function getClockOffsetMs() {
  return clockOffsetMs;
}

export function trueNowMs() {
  return Date.now() + clockOffsetMs;
}

export function trueNowIso() {
  return new Date(trueNowMs()).toISOString();
}

export function observeServerTimestamp(isoOrDateHeader) {
  if (!isoOrDateHeader) return;
  const serverMs = new Date(isoOrDateHeader).getTime();
  if (!Number.isFinite(serverMs) || serverMs < 1_700_000_000_000) return;
  const diff = serverMs - Date.now();
  const prevOffset = clockOffsetMs;
  clockOffsetMs = diff;
  if (!calibratedOnce || Math.abs(diff - prevOffset) > 30_000) {
    calibratedOnce = true;
    if (Math.abs(diff) > 10_000) {
      const mins = Math.round(diff / 60_000);
      console.log(
        `⏱️  [TrueClock] Diferença no relógio local detectada (${mins > 0 ? '+' : ''}${mins} min) — corrigida automaticamente para UTC real!`
      );
    }
  }
}

export async function calibrateTrueClock() {
  if (process.env.VERCEL) return 0;
  if (calibrationPromise) return calibrationPromise;

  calibrationPromise = (async () => {
    const endpoints = [
      'https://zap-ia-studio.vercel.app/api/public/version',
      `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/`
    ];

    for (const url of endpoints) {
      try {
        const t0 = Date.now();
        const res = await fetch(url, {
          method: url.endsWith('/version') ? 'GET' : 'HEAD',
          headers: { 'Cache-Control': 'no-cache' },
          signal: AbortSignal.timeout(4000)
        });
        const rttHalf = Math.round((Date.now() - t0) / 2);

        const dateHdr = res.headers.get('date');
        if (dateHdr) {
          const parsedHdr = new Date(dateHdr).getTime();
          if (Number.isFinite(parsedHdr) && parsedHdr > 1_700_000_000_000) {
            observeServerTimestamp(parsedHdr + rttHalf);
            return clockOffsetMs;
          }
        }

        if (url.endsWith('/version') && res.ok) {
          const body = await res.json().catch(() => null);
          if (body?.timestamp) {
            const parsedBody = new Date(body.timestamp).getTime();
            if (Number.isFinite(parsedBody) && parsedBody > 1_700_000_000_000) {
              observeServerTimestamp(parsedBody + rttHalf);
              return clockOffsetMs;
            }
          }
        }
      } catch {}
    }
    return clockOffsetMs;
  })().finally(() => {
    calibrationPromise = null;
  });

  return calibrationPromise;
}

if (!process.env.VERCEL) {
  calibrateTrueClock().catch(() => {});
  const timer = setInterval(() => {
    calibrateTrueClock().catch(() => {});
  }, 10 * 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
}
