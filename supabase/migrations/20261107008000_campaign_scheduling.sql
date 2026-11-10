-- Agendamento contínuo de campanhas (caminho rascunho UUID + runner Evolution).
--
-- Por que existe: o runner já envia em lotes e respeita intervalo/janela, mas alguém
-- precisava clicar. Aqui a fila por destinatário passa a ser DURÁVEL e atômica
-- (reserva por UPDATE condicional), então um cron pode chamar o mesmo runner repetidas
-- vezes sem nunca reenviar para quem já recebeu — e o estado do agendamento
-- (próxima execução, pausa, motivo) fica registrado no rascunho.
--
-- Nada aqui envia mensagem: só reserva etapa e registra agenda.
CREATE TABLE IF NOT EXISTS public.ienvia_campanha_fila(
  owner_id uuid NOT NULL,
  campanha_id uuid NOT NULL,
  destinatario_id uuid NOT NULL,
  telefone text NOT NULL CHECK(telefone~'^[1-9][0-9]{7,14}$'),
  ordem bigint NOT NULL,
  etapa integer NOT NULL DEFAULT 1 CHECK(etapa>0),
  estado text NOT NULL DEFAULT 'pendente' CHECK(estado IN ('pendente','enviado','falhou')),
  tentativas integer NOT NULL DEFAULT 0 CHECK(tentativas>=0),
  motivo text CHECK(motivo IS NULL OR length(motivo)<=200),
  reservado_em timestamptz,
  enviado_em timestamptz,
  PRIMARY KEY(owner_id,campanha_id,destinatario_id)
);
ALTER TABLE public.ienvia_campanha_fila ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_campanha_fila FROM PUBLIC,anon,authenticated;

-- Agenda do rascunho: a próxima execução só é permitida depois de `proxima_em`.
CREATE TABLE IF NOT EXISTS public.ienvia_campanha_agenda(
  owner_id uuid NOT NULL,
  campanha_id uuid NOT NULL,
  ativa boolean NOT NULL DEFAULT false,
  slot_id text NOT NULL CHECK(slot_id~'^slot_[1-9]$'),
  proxima_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  lote integer NOT NULL DEFAULT 5 CHECK(lote BETWEEN 1 AND 25),
  pausada_motivo text CHECK(pausada_motivo IS NULL OR length(pausada_motivo)<=80),
  ultima_execucao jsonb,
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(owner_id,campanha_id)
);
ALTER TABLE public.ienvia_campanha_agenda ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_campanha_agenda FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.ienvia_campanha_acesso_servico(p_owner uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_owner IS NULL OR public.zapia_is_user_active(p_owner) IS NOT TRUE THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ienvia_campaign_write_accounts WHERE owner_id=p_owner AND enabled) THEN RAISE EXCEPTION 'Alterações não homologadas' USING ERRCODE='55000';END IF;
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campanha_acesso_servico(uuid) FROM PUBLIC,anon,authenticated;

-- Sincroniza a fila com a lista do rascunho: quem já foi marcado como enviado continua
-- enviado; destinatário novo entra como pendente. Chamado ao ativar o agendamento.
CREATE OR REPLACE FUNCTION public.ienvia_campanha_fila_sincronizar(p_owner uuid,p_id uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.ienvia_campaign_drafts;n integer;
BEGIN
 PERFORM public.ienvia_campaign_access(p_owner,true);
 SELECT * INTO c FROM public.ienvia_campaign_drafts WHERE owner_id=p_owner AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Rascunho ausente' USING ERRCODE='P0002';END IF;
 INSERT INTO public.ienvia_campanha_fila(owner_id,campanha_id,destinatario_id,telefone,ordem)
 SELECT p_owner,p_id,
  overlay(overlay(md5(p_id::text||':'||(value->>'telefone')) placing '5' from 13 for 1) placing '8' from 17 for 1)::uuid,
  value->>'telefone',ordinality
 FROM jsonb_array_elements(c.document->'destinatarios') WITH ORDINALITY
 ON CONFLICT(owner_id,campanha_id,destinatario_id) DO NOTHING;
 GET DIAGNOSTICS n = ROW_COUNT;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campanha_fila_sincronizar(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_campanha_fila_sincronizar(uuid,uuid) TO authenticated;

-- Liga/desliga o agendamento. Ligar exige chip escolhido e fila sincronizada.
CREATE OR REPLACE FUNCTION public.ienvia_campanha_agenda_ativar(p_owner uuid,p_id uuid,p_ativa boolean,p_slot text,p_inicio timestamptz)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.ienvia_campaign_drafts;a public.ienvia_campanha_agenda;
BEGIN
 PERFORM public.ienvia_campaign_access(p_owner,true);
 IF p_ativa IS NOT TRUE THEN
  UPDATE public.ienvia_campanha_agenda SET ativa=false,pausada_motivo=NULL,atualizado_em=clock_timestamp()
   WHERE owner_id=p_owner AND campanha_id=p_id RETURNING * INTO a;
  IF NOT FOUND THEN RETURN jsonb_build_object('ownerId',p_owner,'campanha_id',p_id,'ativa',false,'proxima_em',NULL);END IF;
  RETURN jsonb_build_object('ownerId',p_owner,'campanha_id',p_id,'ativa',false,'proxima_em',a.proxima_em);
 END IF;
 IF p_slot IS NULL OR p_slot!~'^slot_[1-9]$' THEN RAISE EXCEPTION 'Escolha o chip que vai enviar' USING ERRCODE='22023';END IF;
 SELECT * INTO c FROM public.ienvia_campaign_drafts WHERE owner_id=p_owner AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Rascunho ausente' USING ERRCODE='P0002';END IF;
 PERFORM public.ienvia_campanha_fila_sincronizar(p_owner,p_id);
 INSERT INTO public.ienvia_campanha_agenda(owner_id,campanha_id,ativa,slot_id,proxima_em)
 VALUES(p_owner,p_id,true,p_slot,COALESCE(p_inicio,clock_timestamp()))
 ON CONFLICT(owner_id,campanha_id) DO UPDATE SET ativa=true,slot_id=EXCLUDED.slot_id,
  proxima_em=LEAST(public.ienvia_campanha_agenda.proxima_em,EXCLUDED.proxima_em),pausada_motivo=NULL,atualizado_em=clock_timestamp()
 RETURNING * INTO a;
 RETURN jsonb_build_object('ownerId',p_owner,'campanha_id',p_id,'ativa',true,'proxima_em',a.proxima_em,'slot_id',a.slot_id,'lote',a.lote);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campanha_agenda_ativar(uuid,uuid,boolean,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_campanha_agenda_ativar(uuid,uuid,boolean,text,timestamptz) TO authenticated;

-- Lista os destinatários pendentes para o relógio (chave de serviço, sem sessão).
-- O nome vem do rascunho, casado pelo telefone: é o que permite expandir {{nome}}.
CREATE OR REPLACE FUNCTION public.ienvia_campanha_fila_pendentes(p_owner uuid,p_id uuid,p_limite integer DEFAULT 25)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.ienvia_campaign_drafts;itens jsonb;
BEGIN
 PERFORM public.ienvia_campanha_acesso_servico(p_owner);
 IF p_limite IS NULL OR p_limite<1 OR p_limite>25 THEN RAISE EXCEPTION 'Lote inválido' USING ERRCODE='22023';END IF;
 SELECT * INTO c FROM public.ienvia_campaign_drafts WHERE owner_id=p_owner AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Rascunho ausente' USING ERRCODE='P0002';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'destinatario_id',f.destinatario_id,'telefone',f.telefone,'nome',
   coalesce((SELECT d->>'nome' FROM jsonb_array_elements(c.document->'destinatarios') d WHERE d->>'telefone'=f.telefone LIMIT 1),''),
   'campos',
   coalesce((SELECT d->'campos' FROM jsonb_array_elements(c.document->'destinatarios') d WHERE d->>'telefone'=f.telefone LIMIT 1),'{}'::jsonb),
   'ordem',f.ordem) ORDER BY f.ordem),'[]'::jsonb) INTO itens
 FROM (SELECT * FROM public.ienvia_campanha_fila
        WHERE owner_id=p_owner AND campanha_id=p_id AND estado='pendente'
        ORDER BY ordem LIMIT p_limite) f;
 RETURN jsonb_build_object('ownerId',p_owner,'campanha_id',p_id,'destinatarios',itens);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campanha_fila_pendentes(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_campanha_fila_pendentes(uuid,uuid,integer) TO service_role;

-- Libera a reserva de um lote inteiro (usado quando o envio recusou ANTES de qualquer
-- mensagem sair: chip sem permissão de campanha, janela fechada, plano inválido).
CREATE OR REPLACE FUNCTION public.ienvia_campanha_fila_liberar(p_owner uuid,p_id uuid,p_motivo text)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 PERFORM public.ienvia_campanha_acesso_servico(p_owner);
 UPDATE public.ienvia_campanha_fila SET estado='pendente',motivo=left(coalesce(p_motivo,'recusado'),200)
  WHERE owner_id=p_owner AND campanha_id=p_id AND estado='enviado' AND enviado_em IS NULL;
 GET DIAGNOSTICS n = ROW_COUNT;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campanha_fila_liberar(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_campanha_fila_liberar(uuid,uuid,text) TO service_role;

-- Reserva ATÔMICA de uma etapa: só um processo consegue levar cada destinatário.
-- Devolve as linhas reservadas agora (nunca as já enviadas).
CREATE OR REPLACE FUNCTION public.ienvia_campanha_fila_reservar(p_owner uuid,p_id uuid,p_limite integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE itens jsonb;
BEGIN
 -- Caminho de SERVIÇO: só o processo do relógio (chave de serviço) executa. O dono vem do
 -- ambiente, nunca do corpo de uma requisição de navegador.
 PERFORM public.ienvia_campanha_acesso_servico(p_owner);
 IF p_limite IS NULL OR p_limite<1 OR p_limite>25 THEN RAISE EXCEPTION 'Lote inválido' USING ERRCODE='22023';END IF;
 -- Passo 1: trava as linhas pendentes (SKIP LOCKED garante que dois ticks nunca
 -- pegam o mesmo destinatário). Passo 2: marca SÓ as que este processo travou.
 WITH pegos AS (
  SELECT destinatario_id FROM public.ienvia_campanha_fila
   WHERE owner_id=p_owner AND campanha_id=p_id AND estado='pendente'
   ORDER BY ordem LIMIT p_limite FOR UPDATE SKIP LOCKED
 ), ids AS (SELECT destinatario_id FROM pegos),
 marcados AS (
  UPDATE public.ienvia_campanha_fila f SET estado='enviado',reservado_em=clock_timestamp(),tentativas=f.tentativas+1
   WHERE f.owner_id=p_owner AND f.campanha_id=p_id AND f.estado='pendente'
     AND f.destinatario_id IN (SELECT destinatario_id FROM ids)
   RETURNING f.destinatario_id,f.telefone,f.ordem
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('destinatario_id',destinatario_id,'telefone',telefone,'ordem',ordem) ORDER BY ordem),'[]'::jsonb) INTO itens FROM marcados;
 RETURN jsonb_build_object('ownerId',p_owner,'campanha_id',p_id,'itens',itens);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campanha_fila_reservar(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_campanha_fila_reservar(uuid,uuid,integer) TO service_role;

-- Desfaz a reserva quando o provedor recusou com certeza (nada saiu): volta a pendente.
CREATE OR REPLACE FUNCTION public.ienvia_campanha_fila_devolver(p_owner uuid,p_id uuid,p_dest uuid,p_motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.ienvia_campanha_acesso_servico(p_owner);
 -- Só devolve o que está reservado e ainda não teve envio confirmado: um envio aceito
 -- nunca volta para a fila.
 UPDATE public.ienvia_campanha_fila SET estado='pendente',motivo=left(coalesce(p_motivo,'falha'),200)
  WHERE owner_id=p_owner AND campanha_id=p_id AND destinatario_id=p_dest
    AND estado='enviado' AND enviado_em IS NULL;
 RETURN jsonb_build_object('ownerId',p_owner,'campanha_id',p_id,'destinatario_id',p_d);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campanha_fila_devolver(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_campanha_fila_devolver(uuid,uuid,uuid,text) TO service_role;

-- Agenda a PRÓXIMA execução depois de um lote, respeitando o intervalo do rascunho.
CREATE OR REPLACE FUNCTION public.ienvia_campanha_agenda_reagendar(p_owner uuid,p_id uuid,p_espera_ms integer,p_resultado jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.ienvia_campanha_agenda;restantes integer;
BEGIN
 PERFORM public.ienvia_campanha_acesso_servico(p_owner);
 IF p_espera_ms IS NULL OR p_espera_ms<0 OR p_espera_ms>604800000 THEN RAISE EXCEPTION 'Espera inválida' USING ERRCODE='22023';END IF;
 SELECT count(*) INTO restantes FROM public.ienvia_campanha_fila WHERE owner_id=p_owner AND campanha_id=p_id AND estado='pendente';
 UPDATE public.ienvia_campanha_agenda SET ultima_execucao=p_resultado,
  proxima_em=clock_timestamp()+make_interval(secs=>p_espera_ms/1000.0),
  ativa=CASE WHEN restantes>0 THEN ativa ELSE false END,atualizado_em=clock_timestamp()
  WHERE owner_id=p_owner AND campanha_id=p_id RETURNING * INTO a;
 IF NOT FOUND THEN RETURN jsonb_build_object('ownerId',p_owner,'campanha_id',p_id,'ativa',false,'restantes',restantes);END IF;
 RETURN jsonb_build_object('ownerId',p_owner,'campanha_id',p_id,'ativa',a.ativa,'proxima_em',a.proxima_em,'restantes',restantes);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campanha_agenda_reagendar(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_campanha_agenda_reagendar(uuid,uuid,integer,jsonb) TO service_role;

-- Acesso do processo automático: exige conta ativa e escrita homologada, mas NÃO depende de
-- sessão de navegador. Quem chama só pode ser a chave de serviço (grant acima/below).
CREATE OR REPLACE FUNCTION public.ienvia_campanha_fila_sincronizar_servico(p_owner uuid,p_id uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.ienvia_campaign_drafts;n integer;
BEGIN
 PERFORM public.ienvia_campanha_acesso_servico(p_owner);
 SELECT * INTO c FROM public.ienvia_campaign_drafts WHERE owner_id=p_owner AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Rascunho ausente' USING ERRCODE='P0002';END IF;
 INSERT INTO public.ienvia_campanha_fila(owner_id,campanha_id,destinatario_id,telefone,ordem)
 SELECT p_owner,p_id,
  overlay(overlay(md5(p_id::text||':'||(value->>'telefone')) placing '5' from 13 for 1) placing '8' from 17 for 1)::uuid,
  value->>'telefone',ordinality
 FROM jsonb_array_elements(c.document->'destinatarios') WITH ORDINALITY
 ON CONFLICT(owner_id,campanha_id,destinatario_id) DO NOTHING;
 GET DIAGNOSTICS n = ROW_COUNT;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campanha_fila_sincronizar_servico(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_campanha_fila_sincronizar_servico(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ienvia_campanha_agenda_servico(p_owner uuid,p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.ienvia_campanha_agenda;c public.ienvia_campaign_drafts;
BEGIN
 PERFORM public.ienvia_campanha_acesso_servico(p_owner);
 SELECT * INTO a FROM public.ienvia_campanha_agenda WHERE owner_id=p_owner AND campanha_id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Agendamento ausente' USING ERRCODE='P0002';END IF;
 SELECT * INTO c FROM public.ienvia_campaign_drafts WHERE owner_id=p_owner AND id=p_id;
 RETURN jsonb_build_object('ownerId',p_owner,'campanha_id',p_id,'ativa',a.ativa,'slot_id',a.slot_id,
  'proxima_em',a.proxima_em,'lote',a.lote,'pausada_motivo',a.pausada_motivo,'ultima_execucao',a.ultima_execucao,
  -- Intervalo do rascunho define a espera entre lotes; não inventamos um valor novo.
  'intervalo_lote_ms',COALESCE((c.document->'opcoes'->>'pausa_lote_min_ms')::numeric,0)::bigint);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campanha_agenda_servico(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_campanha_agenda_servico(uuid,uuid) TO service_role;

-- Chamada pelo cron (sem auth.uid()): devolve as campanhas cuja hora chegou.
-- Restrito ao dono da plataforma — não é uma API pública de listagem.
CREATE OR REPLACE FUNCTION public.ienvia_campanha_agenda_vencidas(p_owner uuid,p_limite integer DEFAULT 10)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE itens jsonb;
BEGIN
 PERFORM public.ienvia_campanha_acesso_servico(p_owner);
 IF p_limite IS NULL OR p_limite<1 OR p_limite>25 THEN RAISE EXCEPTION 'Lote inválido' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('campanha_id',campanha_id,'slot_id',slot_id,'lote',lote,'proxima_em',proxima_em) ORDER BY proxima_em),'[]'::jsonb) INTO itens
  FROM (SELECT * FROM public.ienvia_campanha_agenda
        WHERE owner_id=p_owner AND ativa AND proxima_em<=clock_timestamp()
        ORDER BY proxima_em LIMIT p_limite FOR UPDATE SKIP LOCKED) q;
 RETURN jsonb_build_object('ownerId',p_owner,'itens',itens);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campanha_agenda_vencidas(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_campanha_agenda_vencidas(uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.ienvia_campanha_agenda_estado(p_owner uuid,p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.ienvia_campanha_agenda;tot integer;env integer;fal integer;
BEGIN
 PERFORM public.ienvia_campaign_access(p_owner,false);
 SELECT * INTO a FROM public.ienvia_campanha_agenda WHERE owner_id=p_owner AND campanha_id=p_id;
 SELECT count(*),count(*) FILTER(WHERE estado='enviado'),count(*) FILTER(WHERE estado='falhou') INTO tot,env,fal
  FROM public.ienvia_campanha_fila WHERE owner_id=p_owner AND campanha_id=p_id;
 RETURN jsonb_build_object('ownerId',p_owner,'campanha_id',p_id,
  'ativa',coalesce(a.ativa,false),'slot_id',a.slot_id,'proxima_em',a.proxima_em,'lote',coalesce(a.lote,5),
  'pausada_motivo',a.pausada_motivo,'ultima_execucao',a.ultima_execucao,
  'fila',jsonb_build_object('total',tot,'enviados',env,'falhas',fal,'pendentes',tot-env));
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campanha_agenda_estado(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ienvia_campanha_agenda_estado(uuid,uuid) TO authenticated,service_role;
