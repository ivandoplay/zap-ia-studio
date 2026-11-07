-- Fila de abordagem (aba Segurança) sobre o MESMO motor de Campanhas.
--
-- Por que assim: o motor antigo (whatsappManager.enqueueProactiveBatch) é um laço de processo
-- com socket Baileys e setTimeout — não roda na Vercel, que não mantém processo longo. Em vez de
-- criar um segundo motor de disparo, esta fila usa a mesma tabela de reserva e o mesmo envio
-- (Evolution) que já mandam de verdade. Se um dia existir motor local, ele lê a mesma tabela:
-- nada aqui depende da Vercel.
--
-- Regras que valem sempre:
--  * a fila pertence a quem chama: p_owner precisa ser o auth.uid() (suporte é recusado);
--  * o telefone de destino é do DONO da conta; nada sai sem lista explícita;
--  * o texto é o aprovado no rascunho de Segurança; nada é inventado aqui.

CREATE TABLE IF NOT EXISTS public.ienvia_abordagem_fila (
  owner_id uuid NOT NULL,
  item_id uuid NOT NULL,
  telefone text NOT NULL,
  nome text NOT NULL DEFAULT '',
  texto text NOT NULL,
  ordem integer NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente','reservado','enviado','falha')),
  motivo text,
  provider_message_id text,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (owner_id, item_id),
  CONSTRAINT ienvia_abordagem_telefone CHECK (telefone ~ '^[1-9][0-9]{9,14}$')
);
REVOKE ALL ON TABLE public.ienvia_abordagem_fila FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.ienvia_abordagem_controle (
  owner_id uuid PRIMARY KEY,
  pausada boolean NOT NULL DEFAULT true,
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON TABLE public.ienvia_abordagem_controle FROM PUBLIC, anon, authenticated, service_role;

-- Preenche a fila com o número do dono e o texto aprovado. Idempotente: repetir não duplica
-- nem sobrescreve um item já enviado.
CREATE OR REPLACE FUNCTION public.ienvia_abordagem_enfileirar(
  p_owner uuid, p_telefones jsonb, p_texto text, p_nome text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := auth.uid(); t text; txt text := btrim(COALESCE(p_texto,'')); n integer := 0; ordem integer := 0;
BEGIN
  IF u IS NULL OR p_owner IS NULL OR u <> p_owner THEN RAISE EXCEPTION 'Somente a propria conta' USING ERRCODE='42501'; END IF;
  IF public.zapia_is_user_active(u) IS NOT TRUE THEN RAISE EXCEPTION 'Conta inativa' USING ERRCODE='42501'; END IF;
  IF txt = '' THEN RAISE EXCEPTION 'Informe o texto aprovado' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(COALESCE(p_telefones,'[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'Lista invalida' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(p_telefones) > 200 THEN RAISE EXCEPTION 'Maximo de 200 numeros por vez' USING ERRCODE='22023'; END IF;
  FOR t IN SELECT regexp_replace(COALESCE(v,''),'\D','','g') FROM jsonb_array_elements_text(p_telefones) AS v LOOP
    CONTINUE WHEN t !~ '^[1-9][0-9]{9,14}$';
    ordem := ordem + 1;
    INSERT INTO public.ienvia_abordagem_fila(owner_id,item_id,telefone,nome,texto,ordem)
    VALUES (p_owner,
            (overlay(overlay(md5(p_owner::text||':'||t) placing '5' from 13 for 1) placing '8' from 17 for 1))::uuid,
            t, COALESCE(p_nome,''), txt, ordem)
    ON CONFLICT (owner_id,item_id) DO NOTHING;
    IF FOUND THEN n := n + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('ownerId',p_owner,'adicionados',n);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_abordagem_enfileirar(uuid,jsonb,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_abordagem_enfileirar(uuid,jsonb,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ienvia_abordagem_estado(p_owner uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := auth.uid(); r record; pausada boolean;
BEGIN
  IF u IS NULL OR p_owner IS NULL OR u <> p_owner THEN RAISE EXCEPTION 'Somente a propria conta' USING ERRCODE='42501'; END IF;
  SELECT count(*) FILTER (WHERE estado='pendente') AS pendentes,
         count(*) FILTER (WHERE estado='reservado') AS reservados,
         count(*) FILTER (WHERE estado='enviado') AS enviados,
         count(*) FILTER (WHERE estado='falha') AS falhas,
         count(*) AS total
    INTO r FROM public.ienvia_abordagem_fila WHERE owner_id = p_owner;
  SELECT c.pausada INTO pausada FROM public.ienvia_abordagem_controle c WHERE c.owner_id = p_owner;
  RETURN jsonb_build_object('ownerId',p_owner,'total',r.total,'pendentes',r.pendentes,
    'reservados',r.reservados,'enviados',r.enviados,'falhas',r.falhas,'pausada',COALESCE(pausada,true));
END $$;
REVOKE ALL ON FUNCTION public.ienvia_abordagem_estado(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_abordagem_estado(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ienvia_abordagem_pausar(p_owner uuid, p_pausada boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := auth.uid(); v boolean := COALESCE(p_pausada,true);
BEGIN
  IF u IS NULL OR p_owner IS NULL OR u <> p_owner THEN RAISE EXCEPTION 'Somente a propria conta' USING ERRCODE='42501'; END IF;
  INSERT INTO public.ienvia_abordagem_controle(owner_id,pausada,atualizado_em) VALUES (p_owner,v,clock_timestamp())
  ON CONFLICT (owner_id) DO UPDATE SET pausada=EXCLUDED.pausada, atualizado_em=EXCLUDED.atualizado_em;
  RETURN jsonb_build_object('ownerId',p_owner,'pausada',v);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_abordagem_pausar(uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_abordagem_pausar(uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.ienvia_abordagem_limpar(p_owner uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := auth.uid(); n integer := 0;
BEGIN
  IF u IS NULL OR p_owner IS NULL OR u <> p_owner THEN RAISE EXCEPTION 'Somente a propria conta' USING ERRCODE='42501'; END IF;
  DELETE FROM public.ienvia_abordagem_fila WHERE owner_id=p_owner AND estado IN ('pendente','falha');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ownerId',p_owner,'removidos',n);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_abordagem_limpar(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_abordagem_limpar(uuid) TO authenticated;

-- Reserva o próximo item (um por vez, como o motor antigo). A linha é travada com
-- FOR UPDATE SKIP LOCKED: dois processos nunca pegam o mesmo destinatário.
CREATE OR REPLACE FUNCTION public.ienvia_abordagem_reservar(p_owner uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := auth.uid(); it public.ienvia_abordagem_fila; pausada boolean;
BEGIN
  IF u IS NULL OR p_owner IS NULL OR u <> p_owner THEN RAISE EXCEPTION 'Somente a propria conta' USING ERRCODE='42501'; END IF;
  SELECT c.pausada INTO pausada FROM public.ienvia_abordagem_controle c WHERE c.owner_id=p_owner;
  IF COALESCE(pausada,true) THEN RETURN jsonb_build_object('ownerId',p_owner,'item',NULL,'motivo','pausada'); END IF;
  SELECT * INTO it FROM public.ienvia_abordagem_fila
   WHERE owner_id=p_owner AND estado='pendente' ORDER BY ordem, telefone
   FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ownerId',p_owner,'item',NULL,'motivo','vazia'); END IF;
  UPDATE public.ienvia_abordagem_fila SET estado='reservado', atualizado_em=clock_timestamp()
   WHERE owner_id=p_owner AND item_id=it.item_id;
  RETURN jsonb_build_object('ownerId',p_owner,'item',jsonb_build_object(
    'itemId',it.item_id,'telefone',it.telefone,'nome',it.nome,'texto',it.texto));
END $$;
REVOKE ALL ON FUNCTION public.ienvia_abordagem_reservar(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_abordagem_reservar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ienvia_abordagem_concluir(
  p_owner uuid, p_item uuid, p_ok boolean, p_msg text DEFAULT NULL, p_motivo text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := auth.uid(); n integer := 0;
BEGIN
  IF u IS NULL OR p_owner IS NULL OR u <> p_owner THEN RAISE EXCEPTION 'Somente a propria conta' USING ERRCODE='42501'; END IF;
  IF p_ok IS TRUE AND (p_msg IS NULL OR btrim(p_msg)='') THEN RAISE EXCEPTION 'Confirmacao sem id do provedor' USING ERRCODE='22023'; END IF;
  UPDATE public.ienvia_abordagem_fila
     SET estado = CASE WHEN p_ok IS TRUE THEN 'enviado' ELSE 'falha' END,
         provider_message_id = CASE WHEN p_ok IS TRUE THEN btrim(p_msg) ELSE provider_message_id END,
         motivo = CASE WHEN p_ok IS TRUE THEN NULL ELSE left(COALESCE(p_motivo,'send_failed'),120) END,
         atualizado_em = clock_timestamp()
   WHERE owner_id=p_owner AND item_id=p_item AND estado='reservado';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'Item nao estava reservado' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('ownerId',p_owner,'itemId',p_item,'ok',p_ok IS TRUE);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_abordagem_concluir(uuid,uuid,boolean,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_abordagem_concluir(uuid,uuid,boolean,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ienvia_abordagem_devolver(p_owner uuid, p_item uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := auth.uid();
BEGIN
  IF u IS NULL OR p_owner IS NULL OR u <> p_owner THEN RAISE EXCEPTION 'Somente a propria conta' USING ERRCODE='42501'; END IF;
  UPDATE public.ienvia_abordagem_fila SET estado='pendente', motivo=left(COALESCE(p_motivo,''),120), atualizado_em=clock_timestamp()
   WHERE owner_id=p_owner AND item_id=p_item AND estado='reservado';
  RETURN jsonb_build_object('ownerId',p_owner,'itemId',p_item);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_abordagem_devolver(uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_abordagem_devolver(uuid,uuid,text) TO authenticated;

-- Item reservado há mais de 10 minutos sem desfecho volta para a fila: processo interrompido
-- não pode custar um contato perdido.
CREATE OR REPLACE FUNCTION public.ienvia_abordagem_recuperar(p_owner uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := auth.uid(); n integer := 0;
BEGIN
  IF u IS NULL OR p_owner IS NULL OR u <> p_owner THEN RAISE EXCEPTION 'Somente a propria conta' USING ERRCODE='42501'; END IF;
  UPDATE public.ienvia_abordagem_fila SET estado='pendente', atualizado_em=clock_timestamp()
   WHERE owner_id=p_owner AND estado='reservado' AND atualizado_em < clock_timestamp() - interval '10 minutes';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ownerId',p_owner,'recuperados',n);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_abordagem_recuperar(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_abordagem_recuperar(uuid) TO authenticated;

COMMENT ON TABLE public.ienvia_abordagem_fila IS
  'Fila de abordagem da aba Seguranca. Usa o mesmo envio de campanha (Evolution); um motor local futuro le esta tabela, nao um laco de processo.';
