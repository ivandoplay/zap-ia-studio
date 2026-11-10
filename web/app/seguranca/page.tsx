'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Data = {
  ok: boolean;
  revision: number;
  settings: unknown;
  pin: { action: string; configured: boolean; originalConfigured: boolean };
  sourceChanged: boolean;
  active: boolean;
  approvedMessages: { id?: string; name?: string; category?: string; active?: boolean; content?: string }[];
  approvedTotal: number;
  legacyQueue: { storedRows: number | null; executionConsulted: boolean };
  capabilities: {
    writable: boolean;
    canWritePin: boolean;
    canActivate: boolean;
    canOperateQueue: boolean;
    canSendOwnerAlert: boolean;
  };
};
type Queue = {
  ok: boolean;
  available: boolean;
  estado?: {
    total: number;
    pendentes: number;
    reservados: number;
    enviados: number;
    falhas: number;
    pausada: boolean;
  } | null;
};
type Preview = { ok: boolean; kind: string; warnings: string[]; effectsExecuted: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export default function SecurityPage() {
  const [data, setData] = useState<Data | null>(null);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [settingsJson, setSettingsJson] = useState('');
  const [pinAction, setPinAction] = useState<'keep' | 'set' | 'clear' | 'inherit'>('keep');
  const [pinValue, setPinValue] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmActivation, setConfirmActivation] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [settings, queueState] = await Promise.all([
        api<Data>('security-settings-v2'),
        api<Queue>('security-settings-v2/queue'),
      ]);
      setData(settings);
      setQueue(queueState);
      setSettingsJson(JSON.stringify(settings.settings, null, 2));
      setPinAction('keep');
      setPinValue('');
      setConfirmActivation(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível consultar segurança.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function validateSettings() {
    let settings: unknown;
    try {
      settings = JSON.parse(settingsJson);
    } catch {
      setError('O editor contém JSON inválido.');
      return;
    }
    if (!isRecord(settings)) {
      setError('O documento de políticas precisa ser um objeto JSON.');
      return;
    }
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      const result = await api<Preview>('security-settings-v2/validate', {
        method: 'POST',
        body: JSON.stringify({ settings }),
      });
      setPreview(result);
      setNotice('Prévia validada pelo backend. Nenhuma política foi ativada.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível validar as políticas.');
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!data?.capabilities.writable || data.sourceChanged || busy) return;
    let settings: unknown;
    try {
      settings = JSON.parse(settingsJson);
    } catch {
      setError('O editor contém JSON inválido.');
      return;
    }
    if (!isRecord(settings)) {
      setError('O documento de políticas precisa ser um objeto JSON.');
      return;
    }
    if (pinAction === 'set' && !/^\d{4,8}$/.test(pinValue)) {
      setError('O PIN precisa ter de 4 a 8 dígitos.');
      return;
    }
    if (pinAction !== 'keep' && !data.capabilities.canWritePin) {
      setError('A alteração do PIN não está habilitada para esta conta.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const pin = pinAction === 'set' ? { action: 'set', value: pinValue } : { action: pinAction };
      await api('security-settings-v2/draft', {
        method: 'PUT',
        body: JSON.stringify({
          expectedRevision: data.revision,
          requestId: crypto.randomUUID(),
          settings,
          pin,
        }),
      });
      setNotice('Rascunho de segurança salvo. As políticas ainda não foram ativadas.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar as políticas.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActivation() {
    if (!data?.capabilities.canActivate || !confirmActivation || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<Data>('security-settings-v2/activate', {
        method: 'POST',
        body: JSON.stringify({
          active: !data.active,
          confirmo: true,
          expectedRevision: data.revision,
        }),
      });
      setData(result);
      setSettingsJson(JSON.stringify(result.settings, null, 2));
      setConfirmActivation(false);
      setNotice(result.active ? 'Políticas ativadas pelo backend.' : 'Políticas desativadas pelo backend.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível alterar a ativação.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="heading">
        <div>
          <p className="eyebrow">PROTEÇÃO E POLÍTICAS</p>
          <h1>Segurança</h1>
          <p className="description">Revise as políticas, valide alterações e acompanhe os recursos protegidos por permissão.</p>
        </div>
        <button className="secondary-button" onClick={() => void load()}>Atualizar</button>
      </div>

      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="notice" role="status">{notice}</div>}

      {loading ? (
        <div className="surface loading">Consultando configurações de segurança…</div>
      ) : data ? (
        <>
          <div className="metrics">
            <article className="surface metric">
              <div className="metric-label">PIN do painel</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{data.pin.configured ? 'Configurado' : 'Não configurado'}</div>
            </article>
            <article className="surface metric">
              <div className="metric-label">Política ativa</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{data.active ? 'Ativa' : 'Rascunho / inativa'}</div>
            </article>
            <article className="surface metric">
              <div className="metric-label">Mensagens aprovadas</div>
              <div className="metric-value">{data.approvedTotal}</div>
            </article>
            <article className="surface metric">
              <div className="metric-label">Revisão</div>
              <div className="metric-value">{data.revision}</div>
            </article>
          </div>

          {data.sourceChanged && (
            <div className="notice">A origem de segurança mudou desde a última revisão. Atualize antes de qualquer alteração.</div>
          )}

          <section className="surface panel">
            <div className="editor-heading">
              <div>
                <h2>Políticas da conta</h2>
                <p>O backend valida todos os campos e controla a revisão. Segredos existentes não são exibidos.</p>
              </div>
              <span className="user-chip">{data.capabilities.writable ? 'Rascunho editável' : 'Somente leitura'}</span>
            </div>
            <textarea
              className="json-editor"
              rows={22}
              spellCheck={false}
              value={settingsJson}
              readOnly={!data.capabilities.writable || data.sourceChanged}
              onChange={event => { setSettingsJson(event.target.value); setPreview(null); }}
            />

            {data.capabilities.canWritePin && (
              <div className="crm-fields" style={{ marginTop: 16 }}>
                <label>Ação do PIN
                  <select value={pinAction} onChange={event => setPinAction(event.target.value as typeof pinAction)}>
                    <option value="keep">Manter PIN atual</option>
                    <option value="set">Definir novo PIN</option>
                    <option value="clear">Limpar PIN desta camada</option>
                    <option value="inherit">Herdar PIN original</option>
                  </select>
                </label>
                {pinAction === 'set' && (
                  <label>Novo PIN (4 a 8 dígitos)
                    <input
                      inputMode="numeric"
                      autoComplete="new-password"
                      maxLength={8}
                      value={pinValue}
                      onChange={event => setPinValue(event.target.value.replace(/\D/g, '').slice(0, 8))}
                    />
                  </label>
                )}
              </div>
            )}

            <div className="settings-actions">
              {data.capabilities.writable && (
                <>
                  <button className="secondary-button" disabled={busy || data.sourceChanged} onClick={() => void validateSettings()}>
                    Validar políticas
                  </button>
                  <button className="primary" disabled={busy || data.sourceChanged} onClick={() => void saveDraft()}>
                    {busy ? 'Processando…' : 'Salvar rascunho'}
                  </button>
                </>
              )}
            </div>

            {preview && (
              <div className="notice">
                <strong>Prévia: {preview.kind}</strong>
                <p>{preview.effectsExecuted ? 'A operação executou efeitos.' : 'Nenhuma ação operacional foi executada.'}</p>
                {preview.warnings.map((warning, index) => <p key={index}>• {warning}</p>)}
              </div>
            )}
          </section>

          {data.capabilities.canActivate && (
            <section className="surface panel">
              <h2>Ativação das políticas</h2>
              <p>Ativar aplica o rascunho aprovado ao atendimento. A mudança exige confirmação explícita e uma revisão salva.</p>
              <label className="crm-toggles">
                <input type="checkbox" checked={confirmActivation} onChange={event => setConfirmActivation(event.target.checked)} />
                Confirmo que revisei a política e quero {data.active ? 'desativá-la' : 'ativá-la'}.
              </label>
              <button className="primary" style={{ maxWidth: 240 }} disabled={busy || !confirmActivation || data.sourceChanged || data.revision < 1} onClick={() => void toggleActivation()}>
                {data.active ? 'Desativar políticas' : 'Ativar políticas'}
              </button>
            </section>
          )}

          <section className="surface panel">
            <h2>Fila de abordagem</h2>
            {!queue?.available ? (
              <p>Fila não habilitada neste ambiente.</p>
            ) : (
              <div className="metrics">
                {[
                  ['Total', queue.estado?.total],
                  ['Pendentes', queue.estado?.pendentes],
                  ['Reservados', queue.estado?.reservados],
                  ['Enviados', queue.estado?.enviados],
                  ['Falhas', queue.estado?.falhas],
                  ['Pausada', queue.estado?.pausada ? 'Sim' : 'Não'],
                ].map(([label, value]) => (
                  <article className="metric" key={String(label)}>
                    <div className="metric-label">{label}</div>
                    <div className="metric-value" style={{ fontSize: 18 }}>{value ?? '—'}</div>
                  </article>
                ))}
              </div>
            )}
            <p className="metric-note">A fila é apenas consultada nesta tela. Iniciar, pausar ou limpar exige homologação operacional separada.</p>
          </section>

          <section className="surface panel">
            <h2>Mensagens aprovadas</h2>
            {data.approvedMessages?.map((message, index) => (
              <article className="channel-row" key={message.id || index}>
                <div>
                  <strong>{message.name || message.category || 'Mensagem aprovada'}</strong>
                  <small>{message.content || 'Conteúdo não retornado'}</small>
                </div>
                <span className="user-chip">{message.active === false ? 'Inativa' : 'Aprovada'}</span>
              </article>
            ))}
            {!data.approvedMessages?.length && <p>Nenhuma mensagem aprovada retornada.</p>}
          </section>
        </>
      ) : null}
    </div>
  );
}
