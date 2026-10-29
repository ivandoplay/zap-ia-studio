-- Experimento isolado: plano, etapas versionadas e edição transacional.
-- Não executar em produção antes da conclusão de mídia, worker e testes de integração.
ALTER TABLE public.ienvia_campanhas_controle ADD COLUMN plano jsonb;
ALTER TABLE public.ienvia_campanha_checkpoints ADD COLUMN bloco_id uuid;
ALTER TABLE public.ienvia_campanha_checkpoints ADD COLUMN bloco_config jsonb;
CREATE UNIQUE INDEX ienvia_checkpoint_bloco_unico ON public.ienvia_campanha_checkpoints(owner_id,campanha_id,destinatario_id,bloco_id);
REVOKE INSERT ON public.ienvia_campanhas_controle FROM authenticated;

-- Os objetos binários devem ficar em bucket privado; este experimento só mantém metadados.
CREATE TABLE public.ienvia_campanha_pastas (
 owner_id uuid NOT NULL, pasta_id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
 nome text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(nome)) BETWEEN 1 AND 120),
 tipo text NOT NULL CHECK (tipo IN ('imagem','audio')), criada_em timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 PRIMARY KEY(owner_id,pasta_id)
);
CREATE TABLE public.ienvia_campanha_arquivos (
 owner_id uuid NOT NULL, arquivo_id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(), pasta_id uuid NOT NULL,
 tipo text NOT NULL CHECK (tipo IN ('imagem','audio')), caminho text NOT NULL CHECK (pg_catalog.length(caminho) BETWEEN 1 AND 500),
 mime text NOT NULL CHECK (pg_catalog.length(mime) BETWEEN 1 AND 120), tamanho bigint NOT NULL CHECK (tamanho BETWEEN 1 AND 36700160),
 ordem integer NOT NULL CHECK (ordem BETWEEN 1 AND 10000), excluindo boolean NOT NULL DEFAULT false,
 PRIMARY KEY(owner_id,arquivo_id), UNIQUE(owner_id,pasta_id,ordem), UNIQUE(owner_id,caminho),
 FOREIGN KEY(owner_id,pasta_id) REFERENCES public.ienvia_campanha_pastas(owner_id,pasta_id) ON DELETE RESTRICT
);
ALTER TABLE public.ienvia_campanha_pastas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ienvia_campanha_arquivos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ienvia_campanha_pastas,public.ienvia_campanha_arquivos FROM PUBLIC;
GRANT SELECT ON public.ienvia_campanha_pastas,public.ienvia_campanha_arquivos TO authenticated;
CREATE POLICY ienvia_pastas_own ON public.ienvia_campanha_pastas FOR SELECT TO authenticated USING(owner_id=(SELECT auth.uid()) AND (SELECT public.zapia_is_user_active(auth.uid())));
CREATE POLICY ienvia_arquivos_own ON public.ienvia_campanha_arquivos FOR SELECT TO authenticated USING(owner_id=(SELECT auth.uid()) AND (SELECT public.zapia_is_user_active(auth.uid())));

CREATE FUNCTION ienvia_private.validar_plano(p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE bloco jsonb; n integer; ids text[]:=ARRAY[]::text[]; id text; chip text; chips text[]:=ARRAY[]::text[];
BEGIN
 IF p IS NULL OR pg_catalog.jsonb_typeof(p)<>'object' OR pg_catalog.length(p::text)>250000 THEN RAISE EXCEPTION 'Plano inválido' USING ERRCODE='23514'; END IF;
 IF pg_catalog.jsonb_typeof(p->'nome') IS DISTINCT FROM 'string' OR pg_catalog.length(pg_catalog.btrim(p->>'nome')) NOT BETWEEN 1 AND 120
    OR p->>'modoChips' NOT IN ('fixo','rodizio') OR p->>'retomada' NOT IN ('manual','automatica')
    OR p->>'modoChips' IS NULL OR p->>'retomada' IS NULL THEN RAISE EXCEPTION 'Configuração inválida' USING ERRCODE='23514'; END IF;
 IF pg_catalog.jsonb_typeof(p->'chips') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_typeof(p->'blocos') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Listas inválidas' USING ERRCODE='23514'; END IF;
 IF pg_catalog.jsonb_array_length(p->'chips') NOT BETWEEN 1 AND 3 OR pg_catalog.jsonb_array_length(p->'blocos') NOT BETWEEN 1 AND 100 OR (p->>'modoChips'='fixo' AND pg_catalog.jsonb_array_length(p->'chips')<>1) THEN RAISE EXCEPTION 'Limite inválido' USING ERRCODE='23514'; END IF;
 FOR chip IN SELECT value FROM pg_catalog.jsonb_array_elements_text(p->'chips') LOOP
  IF chip NOT IN ('slot_1','slot_2','slot_3') OR chip=ANY(chips) THEN RAISE EXCEPTION 'Chip inválido' USING ERRCODE='23514'; END IF; chips:=pg_catalog.array_append(chips,chip);
 END LOOP;
 FOR bloco IN SELECT value FROM pg_catalog.jsonb_array_elements(p->'blocos') LOOP
  IF pg_catalog.jsonb_typeof(bloco)<>'object' OR pg_catalog.jsonb_typeof(bloco->'id') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Bloco inválido' USING ERRCODE='23514'; END IF;
  id:=pg_catalog.lower(bloco->>'id');
  IF id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR id=ANY(ids) THEN RAISE EXCEPTION 'ID de bloco inválido' USING ERRCODE='23514'; END IF; ids:=pg_catalog.array_append(ids,id);
  IF bloco->>'tipo'='texto' THEN
   IF bloco->>'modo' NOT IN ('fixo','spintax','rotacao','ia') OR bloco->>'modo' IS NULL OR pg_catalog.jsonb_typeof(bloco->'textos') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Texto inválido' USING ERRCODE='23514'; END IF;
   n:=pg_catalog.jsonb_array_length(bloco->'textos');
   IF n NOT BETWEEN 1 AND 20 OR (bloco->>'modo' IN ('fixo','spintax') AND n<>1) OR (bloco->>'modo' IN ('rotacao','ia') AND (bloco->>'selecao' IS NULL OR bloco->>'selecao' NOT IN ('sequencial','aleatorio'))) OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(bloco->'textos') AS x(v) WHERE pg_catalog.jsonb_typeof(x.v)<>'string' OR pg_catalog.length(pg_catalog.btrim(x.v#>>'{}')) NOT BETWEEN 1 AND 5000) THEN RAISE EXCEPTION 'Variações inválidas' USING ERRCODE='23514'; END IF;
  ELSIF bloco->>'tipo' IN ('imagem','audio') THEN
   IF pg_catalog.jsonb_typeof(bloco->'pastaId') IS DISTINCT FROM 'string' OR (bloco->>'pastaId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR bloco->>'selecao' IS NULL OR bloco->>'selecao' NOT IN ('sequencial','aleatorio') OR (bloco->>'tipo'='audio' AND pg_catalog.jsonb_typeof(bloco->'notaVoz') IS DISTINCT FROM 'boolean') THEN RAISE EXCEPTION 'Pasta inválida' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_pastas AS f WHERE f.owner_id=(SELECT auth.uid()) AND f.pasta_id=(bloco->>'pastaId')::uuid AND f.tipo=bloco->>'tipo') THEN RAISE EXCEPTION 'Pasta não encontrada' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Tipo de bloco inválido' USING ERRCODE='23514'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.validar_plano(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION ienvia_private.adicionar_destinatarios(p_campanha uuid,p_lista jsonb)
RETURNS SETOF public.ienvia_campanha_destinatarios LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE controle public.ienvia_campanhas_controle%ROWTYPE; registro jsonb; destino public.ienvia_campanha_destinatarios%ROWTYPE; ordem_atual bigint;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 SELECT c.* INTO controle FROM public.ienvia_campanhas_controle AS c WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha FOR UPDATE;
 IF NOT FOUND OR controle.status='concluida' OR controle.plano IS NULL THEN RETURN; END IF;
 IF p_lista IS NULL OR pg_catalog.jsonb_typeof(p_lista)<>'array' THEN RAISE EXCEPTION 'Lista inválida' USING ERRCODE='23514'; END IF;
 IF pg_catalog.jsonb_array_length(p_lista) NOT BETWEEN 1 AND 500 OR pg_catalog.length(p_lista::text)>500000 THEN RAISE EXCEPTION 'Lista fora do limite' USING ERRCODE='23514'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_lista) AS v(e)
   WHERE pg_catalog.jsonb_typeof(v.e) IS DISTINCT FROM 'object'
      OR pg_catalog.jsonb_typeof(v.e->'telefone') IS DISTINCT FROM 'string'
      OR (v.e->>'telefone') !~ '^[1-9][0-9]{7,14}$'
      OR (v.e ? 'nome' AND pg_catalog.jsonb_typeof(v.e->'nome') IS DISTINCT FROM 'string')
      OR pg_catalog.length(COALESCE(v.e->>'nome',''))>200
      OR (v.e ? 'campos' AND pg_catalog.jsonb_typeof(v.e->'campos') IS DISTINCT FROM 'object')
      OR (v.e-'telefone'-'nome'-'campos')<>'{}'::jsonb)
 THEN RAISE EXCEPTION 'Destinatário inválido' USING ERRCODE='23514'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_lista) AS v(e)
   CROSS JOIN LATERAL pg_catalog.jsonb_each(COALESCE(v.e->'campos','{}'::jsonb)) AS f(chave,valor)
   WHERE f.chave !~ '^[a-z0-9_]{1,60}$' OR f.chave IN ('__proto__','prototype','constructor','nome','telefone')
      OR pg_catalog.jsonb_typeof(f.valor)<>'string' OR pg_catalog.length(f.valor#>>'{}')>2000)
 THEN RAISE EXCEPTION 'Campo personalizado inválido' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(max(d.ordem),0) INTO ordem_atual FROM public.ienvia_campanha_destinatarios AS d WHERE d.owner_id=(SELECT auth.uid()) AND d.campanha_id=p_campanha;
 IF ordem_atual+pg_catalog.jsonb_array_length(p_lista)>10000 OR (ordem_atual+pg_catalog.jsonb_array_length(p_lista))*controle.blocos_total>100000 THEN
   RAISE EXCEPTION 'Limite de destinatários ou etapas excedido' USING ERRCODE='23514'; END IF;
 FOR registro IN SELECT value FROM pg_catalog.jsonb_array_elements(p_lista) LOOP
   ordem_atual=ordem_atual+1;
   INSERT INTO public.ienvia_campanha_destinatarios(owner_id,campanha_id,telefone,nome,campos,ordem)
    VALUES ((SELECT auth.uid()),p_campanha,registro->>'telefone',COALESCE(registro->>'nome',''),COALESCE(registro->'campos','{}'::jsonb),ordem_atual) RETURNING * INTO destino;
   INSERT INTO public.ienvia_campanha_checkpoints(owner_id,campanha_id,destinatario_id,etapa,bloco_id,bloco_config)
    SELECT (SELECT auth.uid()),p_campanha,destino.destinatario_id,i,(controle.plano->'blocos'->i->>'id')::uuid,controle.plano->'blocos'->i FROM pg_catalog.generate_series(0,controle.blocos_total-1) AS g(i);
   RETURN NEXT destino;
 END LOOP;
 UPDATE public.ienvia_campanhas_controle AS c SET revisao=c.revisao+1
   WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha;
END $$;

CREATE FUNCTION ienvia_private.criar_campanha(p_plano jsonb,p_opcoes jsonb,p_lista jsonb)
RETURNS SETOF public.ienvia_campanhas_controle LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cid uuid:=pg_catalog.gen_random_uuid(); total integer; inicio integer:=0; parte jsonb; n integer;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 PERFORM ienvia_private.validar_plano(p_plano);
 IF p_opcoes IS NULL OR pg_catalog.jsonb_typeof(p_opcoes)<>'object' OR pg_catalog.length(p_opcoes::text)>20000 OR p_lista IS NULL OR pg_catalog.jsonb_typeof(p_lista)<>'array' OR pg_catalog.length(p_lista::text)>2000000 THEN RAISE EXCEPTION 'Dados inválidos' USING ERRCODE='23514'; END IF;
 total:=pg_catalog.jsonb_array_length(p_lista);
 IF total NOT BETWEEN 1 AND 10000 OR total*pg_catalog.jsonb_array_length(p_plano->'blocos')>100000 THEN RAISE EXCEPTION 'Limite excedido' USING ERRCODE='23514'; END IF;
 INSERT INTO public.ienvia_campanhas_controle(owner_id,campanha_id,nome,plano,blocos_total,proxima_acao_em,
   intervalo_min_ms,intervalo_max_ms,pausa_lote_min_ms,pausa_lote_max_ms,intervalo_etapas_ms,lote_min,lote_max,restricao_horaria,fuso,dias,inicio,fim)
 VALUES ((SELECT auth.uid()),cid,p_plano->>'nome',p_plano,pg_catalog.jsonb_array_length(p_plano->'blocos'),
   COALESCE((p_opcoes->>'inicio_em')::timestamptz,pg_catalog.clock_timestamp()),
   COALESCE((p_opcoes->>'intervalo_min_ms')::bigint,0),COALESCE((p_opcoes->>'intervalo_max_ms')::bigint,0),
   COALESCE((p_opcoes->>'pausa_lote_min_ms')::bigint,0),COALESCE((p_opcoes->>'pausa_lote_max_ms')::bigint,0),COALESCE((p_opcoes->>'intervalo_etapas_ms')::bigint,0),
   COALESCE((p_opcoes->>'lote_min')::int,1),COALESCE((p_opcoes->>'lote_max')::int,1),COALESCE((p_opcoes->>'restricao_horaria')::boolean,false),
   COALESCE(p_opcoes->>'fuso','America/Fortaleza'),
   COALESCE((SELECT pg_catalog.array_agg(x.value::smallint ORDER BY x.ord) FROM pg_catalog.jsonb_array_elements_text(p_opcoes->'dias') WITH ORDINALITY AS x(value,ord)),ARRAY[0,1,2,3,4,5,6]::smallint[]),
   COALESCE((p_opcoes->>'inicio')::time,'00:00'::time),COALESCE((p_opcoes->>'fim')::time,'23:59'::time));
 WHILE inicio<total LOOP
  SELECT pg_catalog.jsonb_agg(x.value ORDER BY x.ord) INTO parte FROM pg_catalog.jsonb_array_elements(p_lista) WITH ORDINALITY AS x(value,ord) WHERE x.ord>inicio AND x.ord<=inicio+500;
  SELECT pg_catalog.count(*) INTO n FROM ienvia_private.adicionar_destinatarios(cid,parte);
  IF n<>pg_catalog.jsonb_array_length(parte) THEN RAISE EXCEPTION 'Não foi possível criar destinatários' USING ERRCODE='23514'; END IF;
  inicio:=inicio+500;
 END LOOP;
 RETURN QUERY SELECT c.* FROM public.ienvia_campanhas_controle AS c WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=cid;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.criar_campanha(jsonb,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.criar_campanha(jsonb,jsonb,jsonb) TO authenticated;
CREATE FUNCTION public.ienvia_criar_campanha(p_plano jsonb,p_opcoes jsonb,p_lista jsonb) RETURNS SETOF public.ienvia_campanhas_controle
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM ienvia_private.criar_campanha($1,$2,$3); $$;
REVOKE ALL ON FUNCTION public.ienvia_criar_campanha(jsonb,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_criar_campanha(jsonb,jsonb,jsonb) TO authenticated;

CREATE FUNCTION ienvia_private.editar_plano_campanha(p_campanha uuid,p_plano jsonb)
RETURNS SETOF public.ienvia_campanhas_controle LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE controle public.ienvia_campanhas_controle; ativos uuid[];
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 SELECT c.* INTO controle FROM public.ienvia_campanhas_controle AS c WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha FOR UPDATE;
 IF NOT FOUND OR controle.status='concluida' OR controle.plano IS NULL THEN RETURN; END IF;
 PERFORM ienvia_private.validar_plano(p_plano);
 SELECT COALESCE(pg_catalog.array_agg(d.destinatario_id),ARRAY[]::uuid[]) INTO ativos FROM public.ienvia_campanha_destinatarios AS d
 WHERE d.owner_id=(SELECT auth.uid()) AND d.campanha_id=p_campanha AND EXISTS
  (SELECT 1 FROM public.ienvia_campanha_checkpoints AS x WHERE x.owner_id=d.owner_id AND x.campanha_id=d.campanha_id AND x.destinatario_id=d.destinatario_id AND x.status<>'confirmada');
 DELETE FROM public.ienvia_campanha_checkpoints AS x WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.destinatario_id=ANY(ativos) AND x.status='pendente' AND x.material IS NULL;
 INSERT INTO public.ienvia_campanha_checkpoints(owner_id,campanha_id,destinatario_id,etapa,bloco_id,bloco_config)
 SELECT (SELECT auth.uid()),p_campanha,d.destinatario_id,
  (base.ultima + pg_catalog.row_number() OVER(PARTITION BY d.destinatario_id ORDER BY blocos.ord))::integer,
  (blocos.bloco->>'id')::uuid,blocos.bloco
 FROM public.ienvia_campanha_destinatarios AS d
 CROSS JOIN LATERAL (SELECT COALESCE(pg_catalog.max(x.etapa),-1) AS ultima FROM public.ienvia_campanha_checkpoints AS x
   WHERE x.owner_id=d.owner_id AND x.campanha_id=d.campanha_id AND x.destinatario_id=d.destinatario_id) AS base
 CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(p_plano->'blocos') WITH ORDINALITY AS blocos(bloco,ord)
 WHERE d.owner_id=(SELECT auth.uid()) AND d.campanha_id=p_campanha AND d.destinatario_id=ANY(ativos)
   AND NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints AS preservado WHERE preservado.owner_id=d.owner_id AND preservado.campanha_id=d.campanha_id AND preservado.destinatario_id=d.destinatario_id AND preservado.bloco_id=(blocos.bloco->>'id')::uuid);
 IF (SELECT pg_catalog.count(*) FROM public.ienvia_campanha_checkpoints AS x WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha)>100000 THEN
  RAISE EXCEPTION 'Limite de etapas excedido' USING ERRCODE='23514';
 END IF;
 IF controle.destinatario_corrente IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints AS x WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.destinatario_id=controle.destinatario_corrente AND x.status<>'confirmada') THEN
   RAISE EXCEPTION 'Mantenha um bloco pendente para a pessoa em andamento' USING ERRCODE='23514';
 END IF;
 RETURN QUERY UPDATE public.ienvia_campanhas_controle AS c SET plano=p_plano,nome=p_plano->>'nome',blocos_total=pg_catalog.jsonb_array_length(p_plano->'blocos'),revisao=c.revisao+1
 WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha RETURNING c.*;
END $$;
REVOKE ALL ON FUNCTION ienvia_private.editar_plano_campanha(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ienvia_private.editar_plano_campanha(uuid,jsonb) TO authenticated;
CREATE FUNCTION public.ienvia_editar_plano_campanha(p_campanha uuid,p_plano jsonb) RETURNS SETOF public.ienvia_campanhas_controle
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT * FROM ienvia_private.editar_plano_campanha($1,$2); $$;
REVOKE ALL ON FUNCTION public.ienvia_editar_plano_campanha(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ienvia_editar_plano_campanha(uuid,jsonb) TO authenticated;

CREATE OR REPLACE VIEW public.ienvia_campanha_proxima_etapa WITH (security_invoker=true,security_barrier=true) AS
 SELECT c.owner_id,c.campanha_id,c.revisao,c.proxima_acao_em,c.pausa_tipo,
        proximo.destinatario_id,proximo.telefone,proximo.nome,proximo.campos,proximo.ordem,proximo.etapa,proximo.bloco_id,proximo.bloco_config,proximo.material_preparado
 FROM public.ienvia_campanhas_controle AS c
 CROSS JOIN LATERAL (
  SELECT d.destinatario_id,d.telefone,d.nome,d.campos,d.ordem,e.etapa,e.bloco_id,e.bloco_config,e.material_preparado
  FROM public.ienvia_campanha_destinatarios AS d
  CROSS JOIN LATERAL (
   SELECT x.etapa,x.bloco_id,x.bloco_config,x.material AS material_preparado FROM public.ienvia_campanha_checkpoints AS x
   WHERE x.owner_id=d.owner_id AND x.campanha_id=d.campanha_id AND x.destinatario_id=d.destinatario_id AND x.status='pendente'
   ORDER BY x.etapa LIMIT 1
  ) AS e
  WHERE d.owner_id=c.owner_id AND d.campanha_id=c.campanha_id AND (c.destinatario_corrente IS NULL OR c.destinatario_corrente=d.destinatario_id)
  ORDER BY d.ordem LIMIT 1
 ) AS proximo
 WHERE c.status='ativa' AND NOT EXISTS (
  SELECT 1 FROM public.ienvia_campanha_checkpoints AS ocupado
  WHERE ocupado.owner_id=c.owner_id AND ocupado.campanha_id=c.campanha_id AND ocupado.status IN ('em_envio','incerta')
 );
CREATE OR REPLACE FUNCTION ienvia_private.reservar_campanha(p_campanha uuid,p_destinatario uuid,p_etapa integer,p_tentativa uuid,p_material jsonb,p_revisao bigint)
RETURNS SETOF public.ienvia_campanha_checkpoints LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.ienvia_campanhas_controle; b jsonb; ordem bigint; slot text; salvo jsonb;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 SELECT * INTO c FROM public.ienvia_campanhas_controle AS x WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.revisao=p_revisao FOR UPDATE;
 IF NOT FOUND OR c.plano IS NULL THEN RETURN; END IF;
 SELECT x.bloco_config,x.ordem,x.material_preparado INTO b,ordem,salvo FROM public.ienvia_campanha_proxima_etapa AS x WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.destinatario_id=p_destinatario AND x.etapa=p_etapa AND x.revisao=p_revisao;
 IF NOT FOUND OR b IS NULL OR pg_catalog.jsonb_typeof(p_material) IS DISTINCT FROM 'object' OR (p_material-'slotId'-'bloco')<>'{}'::jsonb OR pg_catalog.jsonb_typeof(p_material->'bloco') IS DISTINCT FROM 'object' THEN RETURN; END IF;
 IF salvo IS NOT NULL THEN
  IF p_material IS DISTINCT FROM salvo THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM ienvia_private.reservar_etapa(p_campanha,p_destinatario,p_etapa,p_tentativa,p_material);
  RETURN;
 END IF;
 slot:=c.plano->'chips'->>((ordem-1)%pg_catalog.jsonb_array_length(c.plano->'chips'))::integer;
 IF p_material->>'slotId' IS DISTINCT FROM slot OR p_material->'bloco'->>'tipo' IS DISTINCT FROM b->>'tipo' THEN RETURN; END IF;
 IF b->>'tipo'='texto' THEN
  IF pg_catalog.jsonb_typeof(p_material->'bloco'->'texto') IS DISTINCT FROM 'string' OR pg_catalog.length(pg_catalog.btrim(p_material->'bloco'->>'texto')) NOT BETWEEN 1 AND 10000 OR ((p_material->'bloco')-'tipo'-'texto')<>'{}'::jsonb THEN RETURN; END IF;
 ELSIF b->>'tipo' IN ('imagem','audio') THEN
  IF p_material->'bloco'->>'pastaId' IS DISTINCT FROM b->>'pastaId' OR (p_material->'bloco'->>'arquivoId') IS NULL OR (p_material->'bloco'->>'arquivoId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN; END IF;
  IF b->>'tipo'='audio' AND (p_material->'bloco'->'notaVoz' IS DISTINCT FROM b->'notaVoz' OR ((p_material->'bloco')-'tipo'-'pastaId'-'arquivoId'-'notaVoz')<>'{}'::jsonb) THEN RETURN; END IF;
  IF b->>'tipo'='imagem' AND ((p_material->'bloco')-'tipo'-'pastaId'-'arquivoId')<>'{}'::jsonb THEN RETURN; END IF;
  PERFORM 1 FROM public.ienvia_campanha_arquivos AS a WHERE a.owner_id=(SELECT auth.uid()) AND a.arquivo_id=(p_material->'bloco'->>'arquivoId')::uuid AND a.pasta_id=(b->>'pastaId')::uuid AND a.tipo=b->>'tipo' AND NOT a.excluindo FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
 ELSE RETURN; END IF;
 RETURN QUERY SELECT * FROM ienvia_private.reservar_etapa(p_campanha,p_destinatario,p_etapa,p_tentativa,p_material);
END $$;

CREATE OR REPLACE FUNCTION ienvia_private.alterar_status_campanha(p_campanha uuid,p_status text)
RETURNS SETOF public.ienvia_campanhas_controle LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE anterior text;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 SELECT c.status INTO anterior FROM public.ienvia_campanhas_controle AS c
   WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF p_status IS NULL OR NOT ((anterior IN ('rascunho','pausada') AND p_status='ativa') OR (anterior='ativa' AND p_status='pausada')) THEN RETURN; END IF;
 IF p_status='ativa' AND EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints AS x
   WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.status='incerta') THEN RETURN; END IF;
 IF p_status='ativa' AND EXISTS (SELECT 1 FROM public.ienvia_campanhas_controle AS c WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha AND (c.plano IS NULL OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(c.plano->'blocos') AS b(bloco) WHERE b.bloco->>'tipo' IN ('imagem','audio') AND NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_arquivos AS a WHERE a.owner_id=c.owner_id AND a.pasta_id=(b.bloco->>'pastaId')::uuid AND a.tipo=b.bloco->>'tipo' AND NOT a.excluindo)))) THEN RETURN; END IF;
 IF anterior='rascunho' AND NOT EXISTS (SELECT 1 FROM public.ienvia_campanha_checkpoints AS x WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha) THEN RETURN; END IF;
 RETURN QUERY UPDATE public.ienvia_campanhas_controle AS c SET status=p_status,revisao=c.revisao+1,
   lote_meta=CASE WHEN anterior='rascunho' THEN c.lote_min+pg_catalog.floor(pg_catalog.random()*(c.lote_max-c.lote_min+1))::integer ELSE c.lote_meta END
   WHERE c.owner_id=(SELECT auth.uid()) AND c.campanha_id=p_campanha RETURNING c.*;
END $$;
