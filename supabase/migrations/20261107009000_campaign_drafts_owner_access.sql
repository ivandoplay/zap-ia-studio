-- Acesso do DONO à tabela de rascunhos (o que faltava para o envio de campanha funcionar).
--
-- Sintoma medido em produção: POST /api/campaigns-v2/drafts/:id/run devolvia
-- CAMPAIGN_UNAVAILABLE. A migração original criou a tabela com RLS habilitado e
-- `REVOKE ALL ... FROM authenticated` sem criar policy nenhuma: nem o dono autenticado
-- conseguia ler o próprio rascunho, então o runner falhava antes de enviar qualquer coisa.
--
-- A escrita continua sendo CAS por revisão (o runner já faz `eq('revision', n)`), e o
-- acesso é limitado ao proprietário ativo. Suporte (master em outra conta) NÃO recebe
-- nada aqui: essa leitura privilegiada continua pelas RPCs de leitura, somente leitura.
GRANT SELECT, UPDATE ON public.ienvia_campaign_drafts TO authenticated;

DROP POLICY IF EXISTS ienvia_campaign_drafts_owner_read ON public.ienvia_campaign_drafts;
CREATE POLICY ienvia_campaign_drafts_owner_read ON public.ienvia_campaign_drafts
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND public.zapia_is_user_active(auth.uid()) IS TRUE);

DROP POLICY IF EXISTS ienvia_campaign_drafts_owner_update ON public.ienvia_campaign_drafts;
CREATE POLICY ienvia_campaign_drafts_owner_update ON public.ienvia_campaign_drafts
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() AND public.zapia_is_user_active(auth.uid()) IS TRUE)
  WITH CHECK (owner_id = auth.uid() AND public.zapia_is_user_active(auth.uid()) IS TRUE);

-- A fila do agendamento também é lida pelo dono para acompanhar o progresso na tela.
GRANT SELECT ON public.ienvia_campanha_fila TO authenticated;
DROP POLICY IF EXISTS ienvia_campanha_fila_owner_read ON public.ienvia_campanha_fila;
CREATE POLICY ienvia_campanha_fila_owner_read ON public.ienvia_campanha_fila
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND public.zapia_is_user_active(auth.uid()) IS TRUE);

GRANT SELECT ON public.ienvia_campanha_agenda TO authenticated;
DROP POLICY IF EXISTS ienvia_campanha_agenda_owner_read ON public.ienvia_campanha_agenda;
CREATE POLICY ienvia_campanha_agenda_owner_read ON public.ienvia_campanha_agenda
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND public.zapia_is_user_active(auth.uid()) IS TRUE);
