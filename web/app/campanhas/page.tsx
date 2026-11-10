'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';

type Draft = {
  campanha_id: string;
  nome?: string;
  status: string;
  revisao?: number;
  criada_em?: string;
  atualizada_em?: string;
  total_destinatarios?: number;
};
type List = {
  ok: boolean;
  items: Draft[];
  hasMore: boolean;
  nextCursor: string | null;
  permissions?: { canEditDrafts: boolean };
  features?: Record<string, unknown>;
};
type Channel = { id: string; name: string; campaignsEnabled?: boolean };
type Recipient = { telefone: string; nome: string; campos?: Record<string, string> };
type ImportPreview = { ok: boolean; destinatarios: Recipient[]; problemas?: { linha: number; tipo: string }[] };
type CampaignEditor = { plano: Record<string, unknown>; opcoes: Record<string, unknown> };
type MediaFolder = { pasta_id: string; nome: string; tipo: 'audio' | 'imagem' };
type MediaFile = { arquivo_id: string; nome_original: string; mime: string; tamanho: number; ordem: number };
type FoldersResponse = { ok: boolean; pastas: MediaFolder[] };
type FilesResponse = { ok: boolean; arquivos: MediaFile[] };
type UploadInit = { ok: boolean; arquivoId: string; signedUrl: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function editorFrom(value: unknown): CampaignEditor | null {
  if (!isRecord(value)) return null;
  const document = isRecord(value.document) ? value.document : value;
  const plano = document.plano ?? document.plan;
  const opcoes = document.opcoes ?? document.options;
  return isRecord(plano) && isRecord(opcoes) ? { plano, opcoes } : null;
}

function parseManualRecipients(value: string): Recipient[] {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [telefone, ...rest] = line.split(';');
      return { telefone: telefone.trim(), nome: rest.join(';').trim(), campos: {} };
    });
}

const defaultOptions = {
  intervalo_min_ms: 20000,
  intervalo_max_ms: 40000,
  lote_min: 8,
  lote_max: 12,
  pausa_lote_min_ms: 300000,
  pausa_lote_max_ms: 600000,
  intervalo_etapas_ms: 0,
  restricao_horaria: false,
  fuso: 'America/Fortaleza',
  dias: [0, 1, 2, 3, 4, 5, 6],
  inicio: '09:00',
  fim: '18:00',
};

export default function CampaignsPage() {
  const [data, setData] = useState<List | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [channelId, setChannelId] = useState('');
  const [message, setMessage] = useState('');
  const [recipientText, setRecipientText] = useState('');
  const [importedRecipients, setImportedRecipients] = useState<Recipient[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<unknown>(null);
  const [recipients, setRecipients] = useState<unknown>(null);
  const [progress, setProgress] = useState<unknown>(null);
  const [editorJson, setEditorJson] = useState('');
  const [editorAvailable, setEditorAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mediaFolders, setMediaFolders] = useState<MediaFolder[]>([]);
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [mediaFolderName, setMediaFolderName] = useState('');
  const [mediaFolderType, setMediaFolderType] = useState<'imagem' | 'audio'>('imagem');
  const [selectedMediaFolder, setSelectedMediaFolder] = useState('');
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaNotice, setMediaNotice] = useState('');
  const [mediaError, setMediaError] = useState('');

  const canEdit = data?.permissions?.canEditDrafts === true;
  const selectedDraft = useMemo(
    () => data?.items.find(item => item.campanha_id === selected) ?? null,
    [data, selected],
  );

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await api<List>('campaigns-v2/drafts?limit=50');
      setData(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível consultar os rascunhos.');
    } finally {
      setLoading(false);
    }
  }

  async function loadMediaFolders() {
    try {
      const result = await api<FoldersResponse>('campaigns-v2/folders');
      const folders = Array.isArray(result.pastas) ? result.pastas : [];
      setMediaFolders(folders);
      setSelectedMediaFolder(current => current || folders[0]?.pasta_id || '');
    } catch (cause) {
      setMediaError(cause instanceof Error ? cause.message : 'Não foi possível consultar as pastas de mídia.');
    }
  }

  async function loadMediaFiles(folderId: string) {
    try {
      const result = await api<FilesResponse>('campaigns-v2/folders/' + folderId + '/files?inicio=0');
      setMediaFiles(Array.isArray(result.arquivos) ? result.arquivos : []);
    } catch (cause) {
      setMediaFiles([]);
      setMediaError(cause instanceof Error ? cause.message : 'Não foi possível consultar os arquivos da pasta.');
    }
  }

  useEffect(() => {
    void load();
    void loadMediaFolders();
    api<{ items: Channel[] }>('channels?limit=50&visibility=all')
      .then(result => setChannels((result.items || []).filter(channel => channel.campaignsEnabled === true)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedMediaFolder) void loadMediaFiles(selectedMediaFolder);
    else setMediaFiles([]);
  }, [selectedMediaFolder]);

  async function importRecipients(file: File) {
    if (file.size > 4 * 1024 * 1024) {
      setError('O arquivo precisa ter até 4 MB.');
      return;
    }
    setImporting(true);
    setError('');
    setNotice('');
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await api<ImportPreview>('campaigns-v2/import-preview', {
        method: 'POST',
        body: form,
      });
      if (!Array.isArray(result.destinatarios)) {
        throw new Error('A prévia não retornou uma lista válida de destinatários.');
      }
      setImportedRecipients(result.destinatarios);
      setRecipientText(result.destinatarios.map(item => [item.telefone, item.nome].filter(Boolean).join(';')).join('\n'));
      const rejected = result.problemas?.length ?? 0;
      setNotice(
        `Prévia concluída: ${result.destinatarios.length} destinatários válidos e ${rejected} linha(s) com problema. Nada foi salvo ou enviado.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível importar a lista.');
    } finally {
      setImporting(false);
    }
  }

  async function createDraft() {
    if (creating) return;
    const destinationList = importedRecipients ?? parseManualRecipients(recipientText);
    if (!campaignName.trim() || !channelId || !message.trim() || !destinationList.length) {
      setError('Informe nome, canal, mensagem e ao menos um destinatário válido.');
      return;
    }
    setCreating(true);
    setError('');
    setNotice('');
    try {
      await api('campaigns-v2/drafts', {
        method: 'POST',
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          plano: {
            nome: campaignName.trim(),
            instanceIds: [channelId],
            distribution: 'fixo',
            retomada: 'manual',
            blocos: [{ id: crypto.randomUUID(), tipo: 'texto', modo: 'fixo', textos: [message] }],
          },
          opcoes: defaultOptions,
          destinatarios: destinationList,
        }),
      });
      setShowCreate(false);
      setCampaignName('');
      setMessage('');
      setRecipientText('');
      setImportedRecipients(null);
      setNotice('Rascunho criado. Nenhuma mensagem foi enviada.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar o rascunho.');
    } finally {
      setCreating(false);
    }
  }

  async function createMediaFolder() {
    if (!canEdit || !mediaFolderName.trim() || mediaBusy) return;
    setMediaBusy(true);
    setMediaError('');
    setMediaNotice('');
    try {
      const result = await api<{ pasta: MediaFolder }>('campaigns-v2/folders', {
        method: 'POST',
        body: JSON.stringify({ nome: mediaFolderName.trim(), tipo: mediaFolderType }),
      });
      if (!result.pasta?.pasta_id) throw new Error('O backend não confirmou a pasta criada.');
      setMediaFolderName('');
      await loadMediaFolders();
      setSelectedMediaFolder(result.pasta.pasta_id);
      setMediaNotice('Pasta privada criada. Ela ainda não foi vinculada a nenhuma campanha.');
    } catch (cause) {
      setMediaError(cause instanceof Error ? cause.message : 'Não foi possível criar a pasta.');
    } finally {
      setMediaBusy(false);
    }
  }

  async function uploadMedia(file: File) {
    const folder = mediaFolders.find(item => item.pasta_id === selectedMediaFolder);
    if (!canEdit || !folder || mediaBusy) return;
    if (file.size < 1 || file.size > 35 * 1024 * 1024) {
      setMediaError('O arquivo precisa ter entre 1 byte e 35 MB.');
      return;
    }
    setMediaBusy(true);
    setMediaError('');
    setMediaNotice('');
    try {
      const initialized = await api<UploadInit>('campaigns-v2/folders/' + folder.pasta_id + '/uploads', {
        method: 'POST',
        body: JSON.stringify({ tamanho: file.size }),
      });
      const signed = new URL(initialized.signedUrl);
      if (signed.protocol !== 'https:') throw new Error('O backend não retornou uma URL HTTPS de upload.');
      const uploaded = await fetch(initialized.signedUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'x-upsert': 'false',
        },
        body: file,
      });
      if (!uploaded.ok) {
        throw new Error('O armazenamento recusou o upload (' + uploaded.status + '). A reserva pode expirar; atualize a pasta antes de tentar novamente.');
      }
      await api('campaigns-v2/folders/' + folder.pasta_id + '/uploads/' + initialized.arquivoId + '/finish', {
        method: 'POST',
        body: JSON.stringify({ nome: file.name }),
      });
      await loadMediaFiles(folder.pasta_id);
      setMediaNotice('Arquivo enviado, validado por assinatura e registrado na pasta privada.');
    } catch (cause) {
      setMediaError(cause instanceof Error ? cause.message : 'Não foi possível concluir o upload.');
    } finally {
      setMediaBusy(false);
    }
  }

  function insertMediaBlock() {
    const folder = mediaFolders.find(item => item.pasta_id === selectedMediaFolder);
    if (!folder || !editorAvailable) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(editorJson);
    } catch {
      setError('O editor do plano contém JSON inválido.');
      return;
    }
    if (!isRecord(parsed) || !isRecord(parsed.plano) || !Array.isArray(parsed.plano.blocos)) {
      setError('O plano aberto não contém uma lista de blocos válida.');
      return;
    }
    const block = {
      id: crypto.randomUUID(),
      tipo: folder.tipo,
      pastaId: folder.pasta_id,
      selecao: 'sequencial',
      ...(folder.tipo === 'audio' ? { notaVoz: false } : {}),
    };
    setEditorJson(JSON.stringify({
      ...parsed,
      plano: { ...parsed.plano, blocos: [...parsed.plano.blocos, block] },
    }, null, 2));
    setNotice('Bloco de ' + folder.tipo + ' inserido no plano. Salve o rascunho para persistir a revisão.');
  }

  async function openDraft(id: string) {
    setSelected(id);
    setDetail(null);
    setRecipients(null);
    setProgress(null);
    setEditorJson('');
    setEditorAvailable(false);
    setBusy(true);
    setError('');
    try {
      const [draft, destinationList, currentProgress] = await Promise.all([
        api<unknown>('campaigns-v2/drafts/' + id),
        api<unknown>('campaigns-v2/drafts/' + id + '/recipients?inicio=0'),
        api<unknown>('campaigns-v2/drafts/' + id + '/progress'),
      ]);
      setDetail(draft);
      setRecipients(destinationList);
      setProgress(currentProgress);
      const editor = editorFrom(draft);
      if (editor) {
        setEditorJson(JSON.stringify(editor, null, 2));
        setEditorAvailable(true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível consultar a campanha.');
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!canEdit || !selected || !selectedDraft || !editorAvailable || busy) return;
    if (!Number.isSafeInteger(selectedDraft.revisao) || (selectedDraft.revisao ?? 0) < 1) {
      setError('A revisão atual do rascunho não permite edição segura. Atualize a lista antes de tentar novamente.');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(editorJson);
    } catch {
      setError('O editor contém JSON inválido.');
      return;
    }
    if (!isRecord(parsed) || !isRecord(parsed.plano) || !isRecord(parsed.opcoes)) {
      setError('O editor precisa conter os objetos plano e opcoes.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('campaigns-v2/drafts/' + selected, {
        method: 'PUT',
        body: JSON.stringify({
          expectedRevision: selectedDraft.revisao,
          plano: parsed.plano,
          opcoes: parsed.opcoes,
        }),
      });
      setNotice('Rascunho atualizado com controle de revisão. Nenhuma mensagem foi enviada.');
      await load();
      await openDraft(selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o rascunho.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="heading">
        <div>
          <p className="eyebrow">COMUNICAÇÃO E RELACIONAMENTO</p>
          <h1>Campanhas</h1>
          <p className="description">Prepare e revise campanhas sem disparar mensagens.</p>
        </div>
        <div className="heading-actions">
          <button className="secondary-button" onClick={() => void load()}>Atualizar</button>
          {canEdit && <button className="primary" onClick={() => setShowCreate(value => !value)}>Novo rascunho</button>}
        </div>
      </div>

      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="notice" role="status">{notice}</div>}

      {showCreate && (
        <section className="surface panel campaign-create">
          <div className="editor-heading">
            <div>
              <h2>Novo rascunho</h2>
              <p>Cria apenas o documento. Não agenda nem envia.</p>
            </div>
            <button className="secondary-button" onClick={() => setShowCreate(false)}>Fechar</button>
          </div>
          <div className="crm-fields">
            <label>Nome da campanha
              <input value={campaignName} onChange={event => setCampaignName(event.target.value)} maxLength={120} />
            </label>
            <label>Canal
              <select value={channelId} onChange={event => setChannelId(event.target.value)}>
                <option value="">Selecione um canal</option>
                {channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </select>
            </label>
            <label className="wide">Mensagem
              <textarea rows={4} value={message} onChange={event => setMessage(event.target.value)} maxLength={5000} placeholder="Use {{nome}} para personalizar…" />
            </label>
            <label className="wide">Destinatários (um por linha: telefone;nome)
              <textarea
                rows={6}
                value={recipientText}
                onChange={event => { setRecipientText(event.target.value); setImportedRecipients(null); }}
                placeholder="+5511999999999;Maria"
              />
            </label>
          </div>
          <div className="settings-actions">
            <label className="secondary-button">
              {importing ? 'Importando…' : 'Importar CSV, TXT ou XLSX'}
              <input
                type="file"
                hidden
                accept=".csv,.txt,.xlsx"
                disabled={importing || creating}
                onChange={event => {
                  const file = event.target.files?.[0];
                  if (file) void importRecipients(file);
                  event.currentTarget.value = '';
                }}
              />
            </label>
            {importedRecipients && <span className="user-chip">{importedRecipients.length} destinatários validados</span>}
            <button className="primary" disabled={creating || importing} onClick={() => void createDraft()}>
              {creating ? 'Criando…' : 'Criar rascunho'}
            </button>
          </div>
        </section>
      )}

      {canEdit && (
        <section className="surface panel campaign-media">
          <div className="editor-heading">
            <div>
              <h2>Biblioteca privada de mídia</h2>
              <p>Pastas e arquivos isolados por conta. O upload usa URL assinada do armazenamento.</p>
            </div>
            <span className="user-chip">{mediaFolders.length} pastas</span>
          </div>
          {mediaError && <div className="error" role="alert">{mediaError}</div>}
          {mediaNotice && <div className="notice" role="status">{mediaNotice}</div>}
          <div className="crm-fields">
            <label>Nome da nova pasta
              <input value={mediaFolderName} onChange={event => setMediaFolderName(event.target.value)} maxLength={120} placeholder="Ex.: Imagens de lançamento" />
            </label>
            <label>Tipo da pasta
              <select value={mediaFolderType} onChange={event => setMediaFolderType(event.target.value as 'imagem' | 'audio')}>
                <option value="imagem">Imagens</option>
                <option value="audio">Áudios</option>
              </select>
            </label>
          </div>
          <button className="secondary-button" disabled={mediaBusy || !mediaFolderName.trim()} onClick={() => void createMediaFolder()}>
            {mediaBusy ? 'Processando…' : 'Criar pasta'}
          </button>
          <div className="crm-fields" style={{ marginTop: 16 }}>
            <label>Pasta selecionada
              <select value={selectedMediaFolder} onChange={event => setSelectedMediaFolder(event.target.value)}>
                <option value="">Selecione uma pasta</option>
                {mediaFolders.map(folder => <option key={folder.pasta_id} value={folder.pasta_id}>{folder.nome} · {folder.tipo}</option>)}
              </select>
            </label>
            <label>Enviar arquivo (até 35 MB)
              <input
                type="file"
                accept={mediaFolders.find(folder => folder.pasta_id === selectedMediaFolder)?.tipo === 'audio' ? 'audio/*,.ogg,.mp3,.wav,.m4a,.webm,.mp4' : 'image/*,.png,.jpg,.jpeg,.webp'}
                disabled={mediaBusy || !selectedMediaFolder}
                onChange={event => {
                  const file = event.target.files?.[0];
                  if (file) void uploadMedia(file);
                  event.currentTarget.value = '';
                }}
              />
            </label>
          </div>
          {selectedMediaFolder && (
            <div className="media-file-list">
              <div className="editor-heading">
                <div><h3>Arquivos da pasta</h3><p>{mediaFiles.length} arquivo(s) nesta página</p></div>
                {editorAvailable && <button className="secondary-button" disabled={mediaBusy} onClick={insertMediaBlock}>Inserir bloco no plano</button>}
              </div>
              {mediaFiles.map(file => (
                <article className="channel-row" key={file.arquivo_id}>
                  <div>
                    <strong>{file.nome_original}</strong>
                    <small>{file.mime} · {(file.tamanho / 1024).toFixed(0)} KB · ordem {file.ordem}</small>
                    <small>ID: {file.arquivo_id}</small>
                  </div>
                  <span className="user-chip">Privado</span>
                </article>
              ))}
              {!mediaFiles.length && <div className="empty-state">Nenhum arquivo nesta pasta.</div>}
            </div>
          )}
        </section>
      )}

      {loading ? (
        <div className="surface loading">Consultando campanhas…</div>
      ) : (
        <section className="surface panel">
          <div className="editor-heading">
            <div>
              <h2>Rascunhos de campanha</h2>
              <p>Somente documentos em estado de rascunho são listados por este contrato.</p>
            </div>
            <span className="user-chip">{data?.items?.length ?? 0} rascunhos</span>
          </div>
          {!data?.items?.length ? (
            <div className="empty-state">Nenhum rascunho encontrado ou integração indisponível.</div>
          ) : (
            <div className="crm-table">
              {data.items.map(draft => (
                <button
                  className={'crm-row ' + (selected === draft.campanha_id ? 'active' : '')}
                  key={draft.campanha_id}
                  onClick={() => void openDraft(draft.campanha_id)}
                >
                  <div>
                    <strong>{draft.nome || 'Campanha sem nome'}</strong>
                    <small>{draft.campanha_id}</small>
                  </div>
                  <span>Revisão {draft.revisao ?? '—'}</span>
                  <span>{draft.status}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {selected && (
        <section className="surface panel">
          <div className="editor-heading">
            <div>
              <h2>Detalhes do rascunho</h2>
              <p>{selected} · revisão {selectedDraft?.revisao ?? '—'}</p>
            </div>
            <button className="secondary-button" onClick={() => setSelected(null)}>Fechar</button>
          </div>
          {busy ? (
            <div className="loading">Consultando detalhes…</div>
          ) : (
            <>
              {canEdit && editorAvailable && (
                <div className="campaign-editor">
                  <div className="editor-heading">
                    <div>
                      <h3>Plano e opções</h3>
                      <p>O servidor valida estrutura, limites e revisão antes de salvar.</p>
                    </div>
                    <button className="primary" disabled={busy} onClick={() => void saveDraft()}>Salvar rascunho</button>
                  </div>
                  <textarea className="json-editor" rows={16} spellCheck={false} value={editorJson} onChange={event => setEditorJson(event.target.value)} />
                </div>
              )}
              {!editorAvailable && <div className="notice">O backend não retornou plano e opções editáveis nesta resposta. Os dados abaixo permanecem em modo leitura.</div>}
              <div className="settings-actions"><span className="user-chip">Destinatários e progresso em modo leitura</span></div>
              <h3 className="json-title">Campanha</h3>
              <pre className="validation-output">{JSON.stringify(detail, null, 2)}</pre>
              <h3 className="json-title">Destinatários</h3>
              <pre className="validation-output">{JSON.stringify(recipients, null, 2)}</pre>
              <h3 className="json-title">Progresso</h3>
              <pre className="validation-output">{JSON.stringify(progress, null, 2)}</pre>
            </>
          )}
        </section>
      )}

      <div className="notice">
        {canEdit ? 'Você pode preparar e revisar rascunhos.' : 'A criação e edição de rascunhos estão desabilitadas para esta conta.'}
        {' '}Execução, agendamento e envio em massa permanecem bloqueados nesta tela até homologação.
      </div>
    </div>
  );
}
