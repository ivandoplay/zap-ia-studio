-- Índices para filtros de tenant que percorrem muitas linhas (aditivo, sem alteração de dados).
-- Não duplica as chaves já usadas nos upserts (user_id, chat_id/slot_id).
-- Em bases muito grandes, avalie executá-los manualmente com CREATE INDEX CONCURRENTLY
-- fora de uma transação de migração para evitar bloqueio de escrita.

-- A sincronização incremental filtra por dono e updated_at (> cursor temporal).
CREATE INDEX IF NOT EXISTS idx_zapia_contacts_user_updated
  ON public.zapia_contacts (user_id, updated_at);

-- A escolha de worker lista todos os aparelhos do tenant em ordem de heartbeat.
CREATE INDEX IF NOT EXISTS idx_zapia_worker_devices_user_heartbeat
  ON public.zapia_worker_devices (user_id, heartbeat_at DESC);
