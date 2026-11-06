// Rascunhos das abas novas na nuvem (Vercel).
//
// O motor local grava cada rascunho num arquivo privado. Na Vercel não há disco
// persistente, então as mesmas abas gravam em `ienvia_workspace_drafts`, uma linha
// por (conta, namespace). O contrato é idêntico ao dos repositórios de arquivo —
// `read(ownerId)` e `save({ownerId, expectedRevision, requestId, document,
// sourceFingerprint, intentDigest})` — para que os routers não saibam onde o dado mora.
//
// Regras que não mudam: CAS por revisão, `requestId` idempotente (mesmo pedido devolve
// o mesmo registro; pedido repetido com outra intenção é 409), nada é gravado sem
// `sourceFingerprint` válido e a tabela só é acessível pelo servidor (RLS sem policy).
import { createHash } from 'node:crypto';

const error = (status, message) => Object.assign(new Error(message), { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;

export const NAMESPACES = Object.freeze(['training', 'resources', 'ai', 'security', 'accounts', 'simulator']);

export const workspaceDraftFingerprint = value =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

// `client` é o cliente service_role: essas tabelas não têm policy para o usuário final.
export function createWorkspaceDraftCloudRepository({ client, namespace, table = 'ienvia_workspace_drafts' } = {}) {
  if (!client || typeof client.from !== 'function') throw new TypeError('Cliente Supabase obrigatório.');
  if (!NAMESPACES.includes(namespace)) throw new TypeError('Namespace de rascunho inválido.');
  const hash = String(table);
  if (!/^[a-z_][a-z0-9_]{2,60}$/.test(hash)) throw new TypeError('Tabela de rascunho inválida.');

  const name = ownerId => {
    if (!UUID.test(String(ownerId || ''))) throw error(400, 'Conta inválida.');
    return ownerId;
  };

  async function read(ownerId) {
    const owner = name(ownerId);
    const { data, error: dbError } = await client
      .from(hash)
      .select('owner_id, namespace, revision, document, source_fingerprint, last_request_id, last_digest, last_intent_digest, updated_at')
      .eq('owner_id', owner)
      .eq('namespace', namespace)
      .maybeSingle();
    if (dbError) throw error(503, 'Rascunho indisponível.');
    if (!data) return null;
    if (data.owner_id !== owner || data.namespace !== namespace) throw error(503, 'Rascunho inválido.');
    if (!Number.isSafeInteger(data.revision) || data.revision < 1) throw error(503, 'Rascunho inválido.');
    if (!UUID.test(String(data.last_request_id || '')) || !SHA.test(String(data.last_digest || ''))) {
      throw error(503, 'Rascunho inválido.');
    }
    if (!SHA.test(String(data.source_fingerprint || ''))) throw error(503, 'Rascunho inválido.');
    if (data.last_intent_digest !== null && data.last_intent_digest !== undefined && !SHA.test(String(data.last_intent_digest))) {
      throw error(503, 'Intenção persistida inválida.');
    }
    return {
      ownerId: data.owner_id,
      revision: data.revision,
      document: data.document,
      sourceFingerprint: data.source_fingerprint,
      updatedAt: data.updated_at,
      lastRequestId: data.last_request_id,
      lastDigest: data.last_digest,
      ...(data.last_intent_digest ? { lastIntentDigest: data.last_intent_digest } : {})
    };
  }

  async function save({ ownerId, expectedRevision, requestId, document, sourceFingerprint, intentDigest = null } = {}) {
    const owner = name(ownerId);
    if (intentDigest !== null && intentDigest !== undefined && !SHA.test(String(intentDigest))) {
      throw error(400, 'Intenção inválida.');
    }
    if (!UUID.test(String(requestId || '')) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw error(400, 'Pedido inválido.');
    }
    if (!SHA.test(String(sourceFingerprint || ''))) throw error(400, 'Pedido inválido.');
    if (!document || typeof document !== 'object') throw error(400, 'Documento inválido.');

    const digest = workspaceDraftFingerprint({ expectedRevision, document });
    const intent = intentDigest || null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await read(owner);
      // Mesmo pedido repetido: devolve o registro gravado, sem escrever de novo.
      if (current?.lastRequestId === requestId) {
        if (current.lastDigest !== digest || (current.lastIntentDigest || null) !== intent) {
          throw error(409, 'Pedido reutilizado com outra intenção.');
        }
        return current;
      }
      if ((current?.revision || 0) !== expectedRevision) {
        throw error(409, 'O rascunho mudou. Recarregue antes de salvar.');
      }

      const record = {
        owner_id: owner,
        namespace,
        revision: expectedRevision + 1,
        document,
        source_fingerprint: current?.sourceFingerprint || sourceFingerprint,
        last_request_id: requestId,
        last_digest: digest,
        last_intent_digest: intent,
        updated_at: new Date().toISOString()
      };

      if (current) {
        // CAS: só grava se a revisão continuar a que lemos.
        const { data, error: dbError } = await client
          .from(hash)
          .update(record)
          .eq('owner_id', owner)
          .eq('namespace', namespace)
          .eq('revision', expectedRevision)
          .select('revision')
          .maybeSingle();
        if (dbError) throw error(503, 'Rascunho não confirmado. Consulte antes de repetir.');
        if (!data) continue; // outra requisição venceu; relê e decide
      } else {
        const { error: dbError } = await client.from(hash).insert(record);
        if (dbError) {
          if (dbError.code === '23505') continue; // corrida no primeiro salvamento
          throw error(503, 'Rascunho não confirmado. Consulte antes de repetir.');
        }
      }

      const saved = await read(owner);
      if (saved?.lastRequestId !== requestId) {
        throw error(503, 'Rascunho não confirmado. Consulte antes de repetir.');
      }
      return saved;
    }
    throw error(409, 'O rascunho mudou durante o salvamento. Recarregue antes de salvar.');
  }

  return Object.freeze({ read, save });
}
