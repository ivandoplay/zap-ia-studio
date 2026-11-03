-- Compatibilidade de reserva de campanhas com o campo provedor do worker real.
-- Reproduzido no Supabase: material com provedor=evolution_api era rejeitado sem erro.
-- Escopo: somente o corpo privado existente. Não altera grants, RLS, status, horários,
-- campanhas, credenciais ou checkpoints. Não ativa nem reprocessa campanhas existentes.
-- Mantém lock, proprietário, conta ativa, revisão exata, material preservado e janela.
-- Materiais legados sem provedor continuam válidos; provedores desconhecidos são rejeitados.
CREATE OR REPLACE FUNCTION ienvia_private.reservar_campanha(p_campanha uuid,p_destinatario uuid,p_etapa integer,p_tentativa uuid,p_material jsonb,p_revisao bigint)
RETURNS SETOF public.ienvia_campanha_checkpoints LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.ienvia_campanhas_controle; b jsonb; ordem bigint; slot text; salvo jsonb;
BEGIN
 IF (SELECT public.zapia_is_user_active(auth.uid())) IS NOT TRUE THEN RETURN; END IF;
 SELECT * INTO c FROM public.ienvia_campanhas_controle AS x WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.revisao=p_revisao FOR UPDATE;
 IF NOT FOUND OR c.plano IS NULL THEN RETURN; END IF;
 SELECT x.bloco_config,x.ordem,x.material_preparado INTO b,ordem,salvo FROM public.ienvia_campanha_proxima_etapa AS x WHERE x.owner_id=(SELECT auth.uid()) AND x.campanha_id=p_campanha AND x.destinatario_id=p_destinatario AND x.etapa=p_etapa AND x.revisao=p_revisao;
 IF NOT FOUND OR b IS NULL OR pg_catalog.jsonb_typeof(p_material) IS DISTINCT FROM 'object' OR (p_material-'slotId'-'provedor'-'bloco')<>'{}'::jsonb OR pg_catalog.jsonb_typeof(p_material->'bloco') IS DISTINCT FROM 'object' THEN RETURN; END IF;
 -- Provedor opcional para preservar checkpoints legados, mas nunca aceita null ou rota desconhecida.
 IF p_material ? 'provedor' AND (pg_catalog.jsonb_typeof(p_material->'provedor') IS DISTINCT FROM 'string' OR p_material->>'provedor' NOT IN ('baileys','evolution_api')) THEN RETURN; END IF;
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
