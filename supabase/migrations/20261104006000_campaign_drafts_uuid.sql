-- SOMENTE LOCAL. Rascunhos UUID, sem scheduler, envio, alteração de IA ou conversão de slots.
CREATE TABLE public.ienvia_campaign_write_accounts(owner_id uuid PRIMARY KEY REFERENCES public.zapia_users(user_id),enabled boolean NOT NULL DEFAULT false);
CREATE TABLE public.ienvia_campaign_drafts(
 owner_id uuid NOT NULL REFERENCES public.zapia_users(user_id),id uuid NOT NULL,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 document jsonb NOT NULL,create_fingerprint text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,id)
);
ALTER TABLE public.ienvia_campaign_write_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ienvia_campaign_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_campaign_write_accounts,public.ienvia_campaign_drafts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ienvia_campaign_access(p_owner uuid,p_write boolean DEFAULT false) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid();
BEGIN
 IF u IS NULL OR p_owner IS NULL OR public.zapia_is_user_active(u) IS NOT TRUE OR public.zapia_is_user_active(p_owner) IS NOT TRUE THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501';END IF;
 IF p_write THEN
  IF u<>p_owner THEN RAISE EXCEPTION 'Suporte somente leitura' USING ERRCODE='42501';END IF;
  PERFORM 1 FROM public.ienvia_campaign_write_accounts WHERE owner_id=u AND enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Alterações não homologadas' USING ERRCODE='55000';END IF;
 ELSIF u<>p_owner AND NOT EXISTS(SELECT 1 FROM public.zapia_users WHERE user_id=u AND is_active AND role='master') THEN RAISE EXCEPTION 'Conta não autorizada' USING ERRCODE='42501';END IF;
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campaign_access(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

-- Mesma gramática limitada do Spintax: 16 níveis, 100 ramos; não expande nem sorteia.
CREATE FUNCTION public.ienvia_campaign_check_spintax(s text) RETURNS void
 LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE pos integer:=1;depth integer:=0;total integer:=0;finish integer;ch text;name text;content boolean[]:='{}';alternatives integer[]:='{}';
BEGIN
 WHILE pos<=length(s) LOOP
  ch:=substr(s,pos,1);
  IF substr(s,pos,2)='{{' THEN
   finish:=strpos(substr(s,pos+2),'}}');IF finish<1 THEN RAISE EXCEPTION 'Campo inválido' USING ERRCODE='22023';END IF;
   name:=btrim(substr(s,pos+2,finish-1));IF name!~'^[[:alnum:]_]+$' THEN RAISE EXCEPTION 'Campo inválido' USING ERRCODE='22023';END IF;
   IF depth>0 THEN content[depth]:=true;END IF;pos:=pos+finish+3;CONTINUE;
  ELSIF ch='{' THEN
   depth:=depth+1;IF depth>16 THEN RAISE EXCEPTION 'Spintax excede profundidade' USING ERRCODE='22023';END IF;content[depth]:=false;alternatives[depth]:=1;
  ELSIF ch='|' AND depth>0 THEN
   IF NOT content[depth] THEN RAISE EXCEPTION 'Ramo vazio' USING ERRCODE='22023';END IF;content[depth]:=false;alternatives[depth]:=alternatives[depth]+1;
  ELSIF ch='}' THEN
   IF depth<1 OR NOT content[depth] OR alternatives[depth]<2 THEN RAISE EXCEPTION 'Spintax inválido' USING ERRCODE='22023';END IF;total:=total+alternatives[depth];IF total>100 THEN RAISE EXCEPTION 'Spintax excede opções' USING ERRCODE='22023';END IF;depth:=depth-1;IF depth>0 THEN content[depth]:=true;END IF;
  ELSIF depth>0 THEN content[depth]:=true;
  END IF;pos:=pos+1;
 END LOOP;
 IF depth<>0 THEN RAISE EXCEPTION 'Spintax não fechado' USING ERRCODE='22023';END IF;
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campaign_check_spintax(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.ienvia_campaign_validate_document(p_owner uuid,d jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p jsonb:=d->'plano';o jsonb:=d->'opcoes';r jsonb;b jsonb;t jsonb;v jsonb;k text;s text;sid uuid;seen text[]:='{}';ids text[]:='{}';n numeric;cnt integer;field text;fields jsonb;
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR d-ARRAY['plano','opcoes','destinatarios']<>'{}'::jsonb OR octet_length(d::text)>4194304 OR jsonb_typeof(p) IS DISTINCT FROM 'object' OR p-ARRAY['nome','instanceIds','distribution','retomada','blocos']<>'{}'::jsonb OR jsonb_typeof(p->'nome') IS DISTINCT FROM 'string' OR length(btrim(p->>'nome')) NOT BETWEEN 1 AND 120 OR (p->>'nome')~'[[:cntrl:]]' THEN RAISE EXCEPTION 'Plano inválido' USING ERRCODE='22023';END IF;
 IF jsonb_typeof(p->'instanceIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'instanceIds')<1 OR jsonb_typeof(p->'distribution') IS DISTINCT FROM 'string' OR p->>'distribution' NOT IN ('fixo','rodizio') OR jsonb_typeof(p->'retomada') IS DISTINCT FROM 'string' OR p->>'retomada' NOT IN ('manual','automatica') OR (p->>'distribution'='fixo' AND jsonb_array_length(p->'instanceIds')<>1) THEN RAISE EXCEPTION 'Instâncias inválidas' USING ERRCODE='22023';END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(p->'instanceIds') LOOP
  s:=v#>>'{}';IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR s!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR lower(s)=ANY(ids) THEN RAISE EXCEPTION 'Identidade de instância inválida' USING ERRCODE='22023';END IF;
  sid:=s::uuid;PERFORM 1 FROM public.ienvia_channels WHERE id=sid AND owner_id=p_owner FOR KEY SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Instância de outra conta' USING ERRCODE='42501';END IF;ids:=array_append(ids,lower(s));
 END LOOP;
 IF jsonb_typeof(p->'blocos') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'blocos') NOT BETWEEN 1 AND 100 OR octet_length(p::text)>1000000 THEN RAISE EXCEPTION 'Blocos inválidos' USING ERRCODE='22023';END IF;
 ids:='{}';
 FOR b IN SELECT value FROM jsonb_array_elements(p->'blocos') LOOP
  IF jsonb_typeof(b) IS DISTINCT FROM 'object' OR jsonb_typeof(b->'id') IS DISTINCT FROM 'string' OR b->>'id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR lower(b->>'id')=ANY(ids) OR jsonb_typeof(b->'tipo') IS DISTINCT FROM 'string' OR b->>'tipo' NOT IN ('texto','imagem','audio') THEN RAISE EXCEPTION 'Bloco inválido' USING ERRCODE='22023';END IF;ids:=array_append(ids,lower(b->>'id'));
  IF b->>'tipo'='texto' THEN
   IF b-ARRAY['id','tipo','modo','textos','selecao']<>'{}'::jsonb OR jsonb_typeof(b->'modo') IS DISTINCT FROM 'string' OR b->>'modo' NOT IN ('fixo','spintax','rotacao','ia') OR jsonb_typeof(b->'textos') IS DISTINCT FROM 'array' OR jsonb_array_length(b->'textos') NOT BETWEEN 1 AND 20 OR (b->>'modo' IN ('fixo','spintax') AND jsonb_array_length(b->'textos')<>1) OR (b->>'modo' IN ('rotacao','ia') AND (jsonb_typeof(b->'selecao') IS DISTINCT FROM 'string' OR b->>'selecao' NOT IN ('sequencial','aleatorio'))) THEN RAISE EXCEPTION 'Texto inválido' USING ERRCODE='22023';END IF;
   FOR t IN SELECT value FROM jsonb_array_elements(b->'textos') LOOP IF jsonb_typeof(t) IS DISTINCT FROM 'string' OR length(btrim(t#>>'{}')) NOT BETWEEN 1 AND 5000 OR regexp_replace(t#>>'{}',E'[\n\r\t]','','g')~'[[:cntrl:]]' THEN RAISE EXCEPTION 'Texto inválido' USING ERRCODE='22023';END IF;IF b->>'modo'='spintax' THEN PERFORM public.ienvia_campaign_check_spintax(t#>>'{}');END IF;END LOOP;
  ELSE
   IF b-ARRAY['id','tipo','pastaId','selecao','notaVoz']<>'{}'::jsonb OR jsonb_typeof(b->'pastaId') IS DISTINCT FROM 'string' OR b->>'pastaId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR jsonb_typeof(b->'selecao') IS DISTINCT FROM 'string' OR b->>'selecao' NOT IN ('sequencial','aleatorio') OR (b->>'tipo'='audio' AND jsonb_typeof(b->'notaVoz') IS DISTINCT FROM 'boolean') OR (b->>'tipo'='imagem' AND b?'notaVoz') THEN RAISE EXCEPTION 'Mídia inválida' USING ERRCODE='22023';END IF;
   -- A biblioteca privada legada é compartilhada explicitamente, sem caminhos fornecidos pelo cliente.
   IF to_regclass('public.ienvia_campanha_pastas') IS NULL THEN RAISE EXCEPTION 'Biblioteca privada não preparada' USING ERRCODE='55000';END IF;
   EXECUTE 'SELECT count(*) FROM public.ienvia_campanha_pastas WHERE owner_id=$1 AND pasta_id=$2 AND tipo=$3' INTO cnt USING p_owner,(b->>'pastaId')::uuid,b->>'tipo';IF cnt<>1 THEN RAISE EXCEPTION 'Pasta não autorizada' USING ERRCODE='42501';END IF;
  END IF;
 END LOOP;
 IF jsonb_typeof(o) IS DISTINCT FROM 'object' OR o-ARRAY['intervalo_min_ms','intervalo_max_ms','pausa_lote_min_ms','pausa_lote_max_ms','intervalo_etapas_ms','lote_min','lote_max','restricao_horaria','fuso','dias','inicio','fim','inicio_em']<>'{}'::jsonb THEN RAISE EXCEPTION 'Opções inválidas' USING ERRCODE='22023';END IF;
 FOREACH k IN ARRAY ARRAY['intervalo_min_ms','intervalo_max_ms','pausa_lote_min_ms','pausa_lote_max_ms','intervalo_etapas_ms','lote_min','lote_max'] LOOP
  IF jsonb_typeof(o->k) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Intervalo inválido' USING ERRCODE='22023';END IF;n:=(o->>k)::numeric;IF n<>trunc(n) OR n<(CASE WHEN k LIKE 'lote_%' THEN 1 ELSE 0 END) OR n>(CASE WHEN k LIKE 'lote_%' THEN 10000 ELSE 604800000 END) THEN RAISE EXCEPTION 'Intervalo inválido' USING ERRCODE='22023';END IF;
 END LOOP;
 IF (o->>'intervalo_min_ms')::numeric>(o->>'intervalo_max_ms')::numeric OR (o->>'pausa_lote_min_ms')::numeric>(o->>'pausa_lote_max_ms')::numeric OR (o->>'lote_min')::numeric>(o->>'lote_max')::numeric OR jsonb_typeof(o->'restricao_horaria') IS DISTINCT FROM 'boolean' OR jsonb_typeof(o->'fuso') IS DISTINCT FROM 'string' OR length(o->>'fuso')>80 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=o->>'fuso') THEN RAISE EXCEPTION 'Agenda inválida' USING ERRCODE='22023';END IF;
 FOREACH k IN ARRAY ARRAY['inicio','fim'] LOOP IF jsonb_typeof(o->k) IS DISTINCT FROM 'string' OR o->>k!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RAISE EXCEPTION 'Horário inválido' USING ERRCODE='22023';END IF;END LOOP;
 IF (o->>'restricao_horaria')::boolean AND o->>'inicio'=o->>'fim' THEN RAISE EXCEPTION 'Janela vazia' USING ERRCODE='22023';END IF;
 IF jsonb_typeof(o->'dias') IS DISTINCT FROM 'array' OR jsonb_array_length(o->'dias') NOT BETWEEN 1 AND 7 THEN RAISE EXCEPTION 'Dias inválidos' USING ERRCODE='22023';END IF;seen:='{}';
 FOR v IN SELECT value FROM jsonb_array_elements(o->'dias') LOOP IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR v::text!~'^[0-6]$' OR v::text=ANY(seen) THEN RAISE EXCEPTION 'Dias inválidos' USING ERRCODE='22023';END IF;seen:=array_append(seen,v::text);END LOOP;
 IF o?'inicio_em' THEN IF jsonb_typeof(o->'inicio_em') IS DISTINCT FROM 'string' OR o->>'inicio_em'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,3})?)?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RAISE EXCEPTION 'Início inválido' USING ERRCODE='22023';END IF;PERFORM (o->>'inicio_em')::timestamptz;END IF;
 IF jsonb_typeof(d->'destinatarios') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'destinatarios') NOT BETWEEN 1 AND 10000 OR jsonb_array_length(d->'destinatarios')*jsonb_array_length(p->'blocos')>100000 THEN RAISE EXCEPTION 'Destinatários inválidos' USING ERRCODE='22023';END IF;seen:='{}';
 FOR r IN SELECT value FROM jsonb_array_elements(d->'destinatarios') LOOP
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['telefone','nome','campos']<>'{}'::jsonb OR jsonb_typeof(r->'telefone') IS DISTINCT FROM 'string' OR r->>'telefone'!~'^[1-9][0-9]{7,14}$' OR (r->>'telefone')=ANY(seen) OR jsonb_typeof(r->'nome') IS DISTINCT FROM 'string' OR length(r->>'nome')>200 OR jsonb_typeof(r->'campos') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Destinatário inválido' USING ERRCODE='22023';END IF;seen:=array_append(seen,r->>'telefone');fields:=r->'campos';
  FOR k,v IN SELECT key,value FROM jsonb_each(fields) LOOP IF k!~'^[a-z0-9_]{1,60}$' OR k IN ('__proto__','constructor','prototype','nome','telefone') OR jsonb_typeof(v) IS DISTINCT FROM 'string' OR length(v#>>'{}')>2000 THEN RAISE EXCEPTION 'Campo inválido' USING ERRCODE='22023';END IF;END LOOP;
  FOR b IN SELECT value FROM jsonb_array_elements(p->'blocos') WHERE value->>'tipo'='texto' LOOP FOR t IN SELECT value FROM jsonb_array_elements(b->'textos') LOOP
   FOR field IN SELECT lower(m[1]) FROM regexp_matches(t#>>'{}','\{\{\s*([[:alnum:]_]+)\s*\}\}','g') m LOOP IF field NOT IN ('nome','telefone') AND NOT fields?field THEN RAISE EXCEPTION 'Campo ausente' USING ERRCODE='22023';END IF;END LOOP;
  END LOOP;END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campaign_validate_document(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.ienvia_campaign_draft_dto(c public.ienvia_campaign_drafts) RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('owner_id',c.owner_id,'campanha_id',c.id,'nome',c.document->'plano'->>'nome','status','rascunho','revisao',c.revision,'plano',c.document->'plano','proxima_acao_em',c.document->'opcoes'->'inicio_em','pausa_tipo','inicio')||(c.document->'opcoes')
$$;
REVOKE ALL ON FUNCTION public.ienvia_campaign_draft_dto(public.ienvia_campaign_drafts) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ienvia_campaign_can_write(p_owner uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_owner=auth.uid() AND public.zapia_is_user_active(auth.uid()) IS TRUE AND EXISTS(SELECT 1 FROM public.ienvia_campaign_write_accounts WHERE owner_id=p_owner AND enabled)
$$;
REVOKE ALL ON FUNCTION public.ienvia_campaign_can_write(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.ienvia_campaign_save_draft(p_id uuid,p_revision integer,p_document jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE u uuid:=auth.uid();c public.ienvia_campaign_drafts;d jsonb:=p_document;fingerprint text;inserted boolean;
BEGIN
 PERFORM public.ienvia_campaign_access(u,true);
 IF p_id IS NULL OR p_id::text!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR p_revision IS NULL OR p_revision<0 THEN RAISE EXCEPTION 'Pedido inválido' USING ERRCODE='22023';END IF;
 IF p_revision>0 THEN
  SELECT * INTO c FROM public.ienvia_campaign_drafts WHERE owner_id=u AND id=p_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Rascunho ausente' USING ERRCODE='P0002';END IF;
  IF c.revision<>p_revision THEN RAISE EXCEPTION 'Revisão mudou' USING ERRCODE='40001';END IF;
  IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR d-ARRAY['plano','opcoes']<>'{}'::jsonb THEN RAISE EXCEPTION 'Edição inválida' USING ERRCODE='22023';END IF;
  d:=d||jsonb_build_object('destinatarios',c.document->'destinatarios');
 END IF;
 PERFORM public.ienvia_campaign_validate_document(u,d);fingerprint:=encode(sha256(convert_to(d::text,'UTF8')),'hex');
 IF p_revision=0 THEN
  INSERT INTO public.ienvia_campaign_drafts(owner_id,id,document,create_fingerprint) VALUES(u,p_id,d,fingerprint) ON CONFLICT(owner_id,id) DO NOTHING RETURNING * INTO c;inserted:=FOUND;
  IF NOT inserted THEN SELECT * INTO c FROM public.ienvia_campaign_drafts WHERE owner_id=u AND id=p_id FOR UPDATE;IF c.create_fingerprint<>fingerprint THEN RAISE EXCEPTION 'Pedido reutilizado' USING ERRCODE='40001';END IF;END IF;
 ELSE UPDATE public.ienvia_campaign_drafts SET document=d,revision=revision+1,updated_at=now() WHERE owner_id=u AND id=p_id RETURNING * INTO c;inserted:=true;
 END IF;
 RETURN jsonb_build_object('ownerId',u,'writesEnabled',true,'campanha',public.ienvia_campaign_draft_dto(c),'replayed',NOT inserted);
END $$;
CREATE FUNCTION public.ienvia_campaign_list_drafts(p_owner uuid,p_limit integer DEFAULT 50,p_after uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE rows jsonb;more boolean;cursor_id uuid;
BEGIN
 PERFORM public.ienvia_campaign_access(p_owner,false);IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Página inválida' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(public.ienvia_campaign_draft_dto(q) ORDER BY q.id),'[]'::jsonb) INTO rows FROM (SELECT c.* FROM public.ienvia_campaign_drafts c WHERE owner_id=p_owner AND (p_after IS NULL OR id>p_after) ORDER BY id LIMIT p_limit) q;
 cursor_id:=(rows->-1->>'campanha_id')::uuid;SELECT EXISTS(SELECT 1 FROM public.ienvia_campaign_drafts WHERE owner_id=p_owner AND id>cursor_id) INTO more;
 RETURN jsonb_build_object('ownerId',p_owner,'writesEnabled',public.ienvia_campaign_can_write(p_owner),'items',rows,'hasMore',more,'nextCursor',CASE WHEN more THEN cursor_id ELSE NULL END);
END $$;
CREATE FUNCTION public.ienvia_campaign_get_draft(p_owner uuid,p_id uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE c public.ienvia_campaign_drafts;
BEGIN
 PERFORM public.ienvia_campaign_access(p_owner,false);SELECT * INTO c FROM public.ienvia_campaign_drafts WHERE owner_id=p_owner AND id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'Rascunho ausente' USING ERRCODE='P0002';END IF;
 RETURN jsonb_build_object('ownerId',p_owner,'writesEnabled',public.ienvia_campaign_can_write(p_owner),'campanha',public.ienvia_campaign_draft_dto(c),'resumo',jsonb_build_object('owner_id',p_owner,'campanha_id',p_id,'total',jsonb_array_length(c.document->'destinatarios'),'concluidos',0,'incertos',0,'excluidos',0),'revisao',NULL);
END $$;
CREATE FUNCTION public.ienvia_campaign_draft_recipients(p_owner uuid,p_id uuid,p_offset integer DEFAULT 0) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='3s' AS $$
DECLARE c public.ienvia_campaign_drafts;items jsonb;
BEGIN
 PERFORM public.ienvia_campaign_access(p_owner,false);IF p_offset IS NULL OR p_offset<0 OR p_offset>9950 THEN RAISE EXCEPTION 'Página inválida' USING ERRCODE='22023';END IF;
 SELECT * INTO c FROM public.ienvia_campaign_drafts WHERE owner_id=p_owner AND id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'Rascunho ausente' USING ERRCODE='P0002';END IF;
 SELECT coalesce(jsonb_agg(value||jsonb_build_object('owner_id',p_owner,'campanha_id',p_id,'destinatario_id',overlay(overlay(md5(p_id::text||':'||(value->>'telefone')) placing '5' from 13 for 1) placing '8' from 17 for 1)::uuid,'ordem',ordinality,'pode_excluir',true,'excluido',false) ORDER BY ordinality),'[]'::jsonb) INTO items FROM jsonb_array_elements(c.document->'destinatarios') WITH ORDINALITY WHERE ordinality>p_offset AND ordinality<=p_offset+50;
 RETURN jsonb_build_object('ownerId',p_owner,'writesEnabled',public.ienvia_campaign_can_write(p_owner),'destinatarios',items);
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campaign_save_draft(uuid,integer,jsonb),public.ienvia_campaign_list_drafts(uuid,integer,uuid),public.ienvia_campaign_get_draft(uuid,uuid),public.ienvia_campaign_draft_recipients(uuid,uuid,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_campaign_save_draft(uuid,integer,jsonb),public.ienvia_campaign_list_drafts(uuid,integer,uuid),public.ienvia_campaign_get_draft(uuid,uuid),public.ienvia_campaign_draft_recipients(uuid,uuid,integer) TO authenticated;

CREATE FUNCTION public.ienvia_campaign_features(p_owner uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM public.ienvia_campaign_access(p_owner,false);RETURN jsonb_build_object('ownerId',p_owner,'writesEnabled',public.ienvia_campaign_can_write(p_owner));END $$;
REVOKE ALL ON FUNCTION public.ienvia_campaign_features(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_campaign_features(uuid) TO authenticated;

CREATE FUNCTION public.ienvia_campaign_remove_draft_recipient(p_id uuid,p_revision integer,p_recipient uuid,p_confirm boolean) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE u uuid:=auth.uid();c public.ienvia_campaign_drafts;remaining jsonb;before_count integer;
BEGIN
 PERFORM public.ienvia_campaign_access(u,true);
 IF p_revision IS NULL OR p_revision<1 OR p_recipient IS NULL OR p_confirm IS NOT TRUE THEN RAISE EXCEPTION 'Confirmação inválida' USING ERRCODE='22023';END IF;
 SELECT * INTO c FROM public.ienvia_campaign_drafts WHERE owner_id=u AND id=p_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Rascunho ausente' USING ERRCODE='P0002';END IF;IF c.revision<>p_revision THEN RAISE EXCEPTION 'Revisão mudou' USING ERRCODE='40001';END IF;
 before_count:=jsonb_array_length(c.document->'destinatarios');
 SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb) INTO remaining FROM jsonb_array_elements(c.document->'destinatarios') WITH ORDINALITY WHERE overlay(overlay(md5(p_id::text||':'||(value->>'telefone')) placing '5' from 13 for 1) placing '8' from 17 for 1)::uuid<>p_recipient;
 IF jsonb_array_length(remaining)<>before_count-1 THEN RAISE EXCEPTION 'Destinatário ausente' USING ERRCODE='P0002';END IF;IF before_count<=1 THEN RAISE EXCEPTION 'Mantenha ao menos um destinatário' USING ERRCODE='22023';END IF;
 UPDATE public.ienvia_campaign_drafts SET document=jsonb_set(document,'{destinatarios}',remaining),revision=revision+1,updated_at=now() WHERE owner_id=u AND id=p_id RETURNING * INTO c;
 RETURN jsonb_build_object('ownerId',u,'writesEnabled',true,'campanha',public.ienvia_campaign_draft_dto(c));
END $$;
REVOKE ALL ON FUNCTION public.ienvia_campaign_remove_draft_recipient(uuid,integer,uuid,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.ienvia_campaign_remove_draft_recipient(uuid,integer,uuid,boolean) TO authenticated;
