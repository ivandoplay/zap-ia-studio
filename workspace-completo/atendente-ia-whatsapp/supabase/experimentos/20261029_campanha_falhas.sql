-- Erro de preparação interrompe a campanha em vez de ficar em loop silencioso.
-- Código controlado não grava número, texto, credenciais ou mensagens de erro externas.
ALTER TABLE public.ienvia_campanhas_controle ADD COLUMN falha_codigo text CHECK(falha_codigo IN ('contato_restrito','campos','preparacao'));
CREATE FUNCTION ienvia_private.registrar_falha_campanha(p_campanha uuid,p_codigo text)
RETURNS SETOF public.ienvia_campanhas_controle LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 IF p_codigo IS NULL OR p_codigo NOT IN ('contato_restrito','campos','preparacao') THEN RAISE EXCEPTION 'Código inválido' USING ERRCODE='23514'; END IF;
 RETURN QUERY UPDATE public.ienvia_campanhas_controle c SET status='pausada',falha_codigo=p_codigo,revisao=c.revisao+1
 WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha AND c.status='ativa' RETURNING c.*;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.registrar_falha_campanha(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.registrar_falha_campanha(uuid,text) TO authenticated;
CREATE FUNCTION public.ienvia_registrar_falha_campanha(p_campanha uuid,p_codigo text) RETURNS SETOF public.ienvia_campanhas_controle LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM ienvia_private.registrar_falha_campanha($1,$2); $$;
REVOKE ALL ON FUNCTION public.ienvia_registrar_falha_campanha(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_registrar_falha_campanha(uuid,text) TO authenticated;
CREATE FUNCTION ienvia_private.limpar_falha_ao_retomar() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN NEW.falha_codigo=NULL;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION ienvia_private.limpar_falha_ao_retomar() FROM PUBLIC;
CREATE TRIGGER ienvia_limpar_falha_ao_retomar BEFORE UPDATE OF status ON public.ienvia_campanhas_controle
FOR EACH ROW WHEN (OLD.status='pausada' AND NEW.status='ativa') EXECUTE FUNCTION ienvia_private.limpar_falha_ao_retomar();
