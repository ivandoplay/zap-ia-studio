'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Channel = {
  id: string;
  name: string;
  transport: string;
  crmVisible: boolean;
  aiEnabled: boolean;
  campaignsEnabled: boolean;
  tags: string[];
  revision: number;
  connection: { status: string; checkedAt: string | null };
  capabilities: { canPair: boolean; reason?: string };
};
type Input = {
  name: string;
  transport: 'evolution_api' | 'local_worker';
  crmVisible: boolean;
  aiEnabled: boolean;
  campaignsEnabled: boolean;
  tags: string[];
};
type Data = {
  ok: boolean;
  items: Channel[];
  total: number;
  summary: Record<string, number>;
  permissions: { canEdit: boolean };
  operationalMigrationPending: boolean;
};
type PairingResult = {
  ok: boolean;
  slotId: string;
  action: 'connect' | 'disconnect';
  engine: string;
  status: string;
  qrDataUrl: string | null;
  pairingCode: string | null;
  qrReady: boolean;
  requiresQrRefresh: boolean;
};

const labels: Record<string, string> = {
  connected: 'Conectado',
  disconnected: 'Desconectado',
  unknown: 'Não confirmado',
  unlinked: 'Sem chip vinculado',
  not_verified: 'Não verificado',
  connecting: 'Conectando',
  qr_ready: 'QR disponível',
};
const blank: Input = {
  name: '',
  transport: 'evolution_api',
  crmVisible: true,
  aiEnabled: false,
  campaignsEnabled: false,
  tags: [],
};

export default function ChannelsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [draft, setDraft] = useState<Input>(blank);
  const [tagText, setTagText] = useState('');
  const [pairingChannel, setPairingChannel] = useState<Channel | null>(null);
  const [pairingPhone, setPairingPhone] = useState('');
  const [pairingConfirmed, setPairingConfirmed] = useState(false);
  const [pairingResult, setPairingResult] = useState<PairingResult | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await api<Data>('channels?limit=50&visibility=all');
      setData(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível consultar canais.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function create() {
    setEditing(null);
    setDraft(blank);
    setTagText('');
    setShowForm(true);
  }

  function edit(channel: Channel) {
    setEditing(channel);
    setDraft({
      name: channel.name,
      transport: channel.transport as Input['transport'],
      crmVisible: channel.crmVisible,
      aiEnabled: channel.aiEnabled,
      campaignsEnabled: channel.campaignsEnabled,
      tags: channel.tags || [],
    });
    setTagText((channel.tags || []).join(', '));
    setShowForm(true);
  }

  async function save() {
    if (!data?.permissions.canEdit || busy || !draft.name.trim()) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = { ...draft, tags: tagText.split(',').map(value => value.trim()).filter(Boolean) };
      if (editing) {
        await api('channels/' + editing.id, {
          method: 'PATCH',
          body: JSON.stringify({
            expectedRevision: editing.revision,
            patch: {
              name: payload.name,
              crmVisible: payload.crmVisible,
              aiEnabled: payload.aiEnabled,
              campaignsEnabled: payload.campaignsEnabled,
              tags: payload.tags,
            },
          }),
        });
      } else {
        await api('channels', { method: 'POST', body: JSON.stringify(payload) });
      }
      setShowForm(false);
      setNotice(editing ? 'Canal atualizado.' : 'Canal cadastrado.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o canal.');
    } finally {
      setBusy(false);
    }
  }

  async function runPairing(action: 'connect' | 'disconnect') {
    if (!pairingChannel?.capabilities?.canPair || !pairingConfirmed || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    setPairingResult(null);
    try {
      const result = await api<PairingResult>('channels/' + pairingChannel.id + '/pairing', {
        method: 'POST',
        body: JSON.stringify({
          action,
          ...(action === 'connect' && pairingPhone.trim() ? { pairingPhone: pairingPhone.trim() } : {}),
          confirmo: true,
        }),
      });
      setPairingResult(result);
      setPairingConfirmed(false);
      setNotice(action === 'connect'
        ? 'Solicitação de conexão recebida. Confira o QR Code ou código retornado pelo provedor.'
        : 'Solicitação de desconexão recebida pelo backend.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível executar o pareamento.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="heading">
        <div>
          <p className="eyebrow">CANAIS DE ATENDIMENTO</p>
          <h1>Canais</h1>
          <p className="description">Cadastro, visibilidade, políticas e pareamento conforme as capacidades liberadas pelo backend.</p>
        </div>
        {data?.permissions.canEdit && (
          <button className="primary" style={{ width: 'auto', margin: 0 }} onClick={create}>Novo canal</button>
        )}
      </div>

      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="notice" role="status">{notice}</div>}

      {loading ? (
        <div className="surface loading">Consultando canais…</div>
      ) : data ? (
        <>
          <div className="metrics">
            {[
              ['Total', data.summary?.total],
              ['Visíveis no CRM', data.summary?.crmVisible],
              ['IA habilitada', data.summary?.aiEnabled],
              ['Campanhas habilitadas', data.summary?.campaignsEnabled],
            ].map(([label, value]) => (
              <article className="surface metric" key={String(label)}>
                <div className="metric-label">{label}</div>
                <div className="metric-value">{value ?? '—'}</div>
              </article>
            ))}
          </div>

          <section className="surface panel">
            <h2>Canais cadastrados</h2>
            <p>O estado da conexão é consultado separadamente do cadastro.</p>
            {data.items.map(channel => (
              <article className="channel-row" key={channel.id}>
                <div>
                  <strong>{channel.name}</strong>
                  <small>{channel.transport} · {channel.id}</small>
                  <small>Revisão {channel.revision} · vínculo: {channel.connection?.status || 'Não confirmado'}</small>
                  <div className="channel-flags">
                    <span>{channel.crmVisible ? 'CRM visível' : 'CRM oculto'}</span>
                    <span>{channel.aiEnabled ? 'IA ligada' : 'IA desligada'}</span>
                    <span>{channel.campaignsEnabled ? 'Campanhas ligadas' : 'Campanhas desligadas'}</span>
                    {channel.tags.map(tag => <span key={tag}>{tag}</span>)}
                  </div>
                  {!channel.capabilities?.canPair && channel.capabilities?.reason && (
                    <small>{channel.capabilities.reason}</small>
                  )}
                </div>
                <div className="channel-row-actions">
                  <span className="user-chip">{labels[channel.connection?.status] || channel.connection?.status || 'Não confirmado'}</span>
                  {data.permissions.canEdit && <button className="secondary-button" onClick={() => edit(channel)}>Editar</button>}
                  {channel.capabilities?.canPair && (
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setPairingChannel(channel);
                        setPairingPhone('');
                        setPairingConfirmed(false);
                        setPairingResult(null);
                      }}
                    >
                      Parear / conectar
                    </button>
                  )}
                </div>
              </article>
            ))}
            {!data.items.length && <div className="empty-state">Nenhum canal cadastrado.</div>}
          </section>

          {showForm && (
            <section className="surface panel">
              <div className="editor-heading">
                <div>
                  <h2>{editing ? 'Editar canal' : 'Novo canal'}</h2>
                  <p>Configura apenas as políticas do canal. Não pareia dispositivo.</p>
                </div>
                <button className="secondary-button" onClick={() => setShowForm(false)}>Fechar</button>
              </div>
              <div className="crm-fields">
                <label>Nome
                  <input value={draft.name} onChange={event => setDraft(value => ({ ...value, name: event.target.value }))} maxLength={64} />
                </label>
                <label>Transporte
                  <select
                    value={draft.transport}
                    disabled={!!editing}
                    onChange={event => setDraft(value => ({ ...value, transport: event.target.value as Input['transport'] }))}
                  >
                    <option value="evolution_api">Evolution API</option>
                    <option value="local_worker">Motor local</option>
                  </select>
                </label>
              </div>
              <div className="crm-toggles">
                <label><input type="checkbox" checked={draft.crmVisible} onChange={event => setDraft(value => ({ ...value, crmVisible: event.target.checked }))} /> Visível no CRM</label>
                <label><input type="checkbox" checked={draft.aiEnabled} onChange={event => setDraft(value => ({ ...value, aiEnabled: event.target.checked }))} /> Permitir IA</label>
                <label><input type="checkbox" checked={draft.campaignsEnabled} onChange={event => setDraft(value => ({ ...value, campaignsEnabled: event.target.checked }))} /> Permitir campanhas</label>
              </div>
              <label className="setting-field">Etiquetas separadas por vírgula
                <input value={tagText} onChange={event => setTagText(event.target.value)} placeholder="Vendas, Suporte, Pós-venda" />
              </label>
              <button className="primary crm-save" disabled={busy || !draft.name.trim()} onClick={() => void save()}>
                {busy ? 'Salvando…' : 'Salvar canal'}
              </button>
            </section>
          )}

          {pairingChannel && (
            <section className="surface panel">
              <div className="editor-heading">
                <div>
                  <h2>Pareamento: {pairingChannel.name}</h2>
                  <p>A conexão só é executada quando o backend informa que este canal pode parear.</p>
                </div>
                <button className="secondary-button" onClick={() => setPairingChannel(null)}>Fechar</button>
              </div>
              <label className="setting-field">Telefone para código de pareamento (opcional)
                <input
                  inputMode="tel"
                  value={pairingPhone}
                  onChange={event => setPairingPhone(event.target.value)}
                  placeholder="DDI + DDD + número"
                />
              </label>
              <label className="crm-toggles">
                <input type="checkbox" checked={pairingConfirmed} onChange={event => setPairingConfirmed(event.target.checked)} />
                Confirmo que quero alterar a conexão deste canal.
              </label>
              <div className="settings-actions">
                <button className="primary" disabled={busy || !pairingConfirmed} onClick={() => void runPairing('connect')}>Conectar / gerar QR</button>
                <button className="secondary-button" disabled={busy || !pairingConfirmed} onClick={() => void runPairing('disconnect')}>Desconectar</button>
              </div>
              {pairingResult && (
                <div className="pairing-result">
                  <p>Motor: {pairingResult.engine} · Estado: {labels[pairingResult.status] || pairingResult.status}</p>
                  {pairingResult.qrDataUrl && <img src={pairingResult.qrDataUrl} alt="QR Code de conexão do WhatsApp" style={{ display: 'block', width: 240, maxWidth: '100%', height: 'auto', margin: '14px auto' }} />}
                  {pairingResult.pairingCode && <div className="notice">Código de pareamento: <strong>{pairingResult.pairingCode}</strong></div>}
                  {!pairingResult.qrDataUrl && !pairingResult.pairingCode && (
                    <div className="notice">{pairingResult.qrReady ? 'A conexão está aguardando o QR Code ou código do dispositivo.' : 'O provedor não retornou QR Code ou código nesta resposta.'}</div>
                  )}
                  {pairingResult.requiresQrRefresh && <div className="notice">O dispositivo solicitou uma nova escolha/atualização do QR. Esta integração ainda não recebeu um endpoint separado para atualização.</div>}
                </div>
              )}
            </section>
          )}

          {data.operationalMigrationPending && (
            <div className="notice">A migração operacional continua pendente. Pareamento e troca de executor só aparecem quando a capacidade correspondente é liberada pelo backend.</div>
          )}
        </>
      ) : null}
    </div>
  );
}
