-- Campanhas com chips mistos precisam pausar com uma causa visível, sem trocar de número/provedor.
BEGIN;
ALTER TABLE public.ienvia_campanhas_controle
  DROP CONSTRAINT IF EXISTS ienvia_campanhas_controle_falha_codigo_check;
ALTER TABLE public.ienvia_campanhas_controle
  ADD CONSTRAINT ienvia_campanhas_controle_falha_codigo_check
  CHECK (falha_codigo IS NULL OR falha_codigo IN ('contato_restrito','campos','preparacao','chip_indisponivel','chip_provedor_ambiguo'));
CREATE OR REPLACE FUNCTION ienvia_private.registrar_falha_campanha(p_campanha uuid,p_codigo text)
RETURNS SETOF public.ienvia_campanhas_controle
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 IF p_codigo IS NULL OR p_codigo NOT IN ('contato_restrito','campos','preparacao','chip_indisponivel','chip_provedor_ambiguo') THEN
  RAISE EXCEPTION 'Código inválido' USING ERRCODE='23514';
 END IF;
 RETURN QUERY UPDATE public.ienvia_campanhas_controle c
   SET status='pausada',falha_codigo=p_codigo,revisao=c.revisao+1
   WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha AND c.status='ativa'
   RETURNING c.*;
END $$;
COMMIT;
