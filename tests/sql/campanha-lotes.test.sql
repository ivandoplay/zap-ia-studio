\set ON_ERROR_STOP on
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
INSERT INTO public.ienvia_campanhas_controle(owner_id,campanha_id,nome,lote_min,lote_max,intervalo_min_ms,intervalo_max_ms,pausa_lote_min_ms,pausa_lote_max_ms,intervalo_etapas_ms)
VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000120','Lotes sintéticos',2,2,600000,600000,900000,900000,0);
SELECT public.ienvia_adicionar_etapas('20000000-0000-0000-0000-000000000120',pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('destinatario_id',d.id,'etapa',e.i)))
FROM (VALUES ('30000000-0000-0000-0000-000000000120'::uuid),('30000000-0000-0000-0000-000000000121'::uuid),('30000000-0000-0000-0000-000000000122'::uuid)) d(id)
CROSS JOIN (VALUES (0),(1)) e(i);
DO $$ DECLARE c bigint; tipo text; cont integer; BEGIN
 SELECT count(*) INTO c FROM public.ienvia_alterar_status_campanha('20000000-0000-0000-0000-000000000120','ativa'); IF c<>1 THEN RAISE EXCEPTION 'ativação falhou'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000120','30000000-0000-0000-0000-000000000120',0,'40000000-0000-0000-0000-000000000120','{"texto":"A0"}'); IF c<>1 THEN RAISE EXCEPTION 'reserva A0'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_confirmar_etapa('20000000-0000-0000-0000-000000000120','30000000-0000-0000-0000-000000000120',0,'40000000-0000-0000-0000-000000000120'); IF c<>1 THEN RAISE EXCEPTION 'confirma A0'; END IF;
 SELECT pessoas_no_lote INTO cont FROM public.ienvia_campanhas_controle WHERE campanha_id='20000000-0000-0000-0000-000000000120'; IF cont<>0 THEN RAISE EXCEPTION 'etapa não equivale a pessoa'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_pular_pausa_campanha('20000000-0000-0000-0000-000000000120'); IF c<>0 THEN RAISE EXCEPTION 'intervalo entre blocos não deve ser pulado'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000120','30000000-0000-0000-0000-000000000121',0,'40000000-0000-0000-0000-000000000125','{"texto":"B0"}'); IF c<>0 THEN RAISE EXCEPTION 'não concluir pessoa atual'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000120','30000000-0000-0000-0000-000000000120',1,'40000000-0000-0000-0000-000000000121','{"texto":"A1"}'); IF c<>1 THEN RAISE EXCEPTION 'reserva A1'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_confirmar_etapa('20000000-0000-0000-0000-000000000120','30000000-0000-0000-0000-000000000120',1,'40000000-0000-0000-0000-000000000121'); IF c<>1 THEN RAISE EXCEPTION 'confirma A1'; END IF;
 SELECT pessoas_no_lote,pausa_tipo INTO cont,tipo FROM public.ienvia_campanhas_controle WHERE campanha_id='20000000-0000-0000-0000-000000000120'; IF cont<>1 OR tipo<>'pessoa' THEN RAISE EXCEPTION 'primeira pessoa ou pausa incorreta'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000120','30000000-0000-0000-0000-000000000121',0,'40000000-0000-0000-0000-000000000122','{"texto":"B0"}'); IF c<>0 THEN RAISE EXCEPTION 'pausa ignorada'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_pular_pausa_campanha('20000000-0000-0000-0000-000000000120'); IF c<>1 THEN RAISE EXCEPTION 'não pulou pausa pessoa'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000120','30000000-0000-0000-0000-000000000121',0,'40000000-0000-0000-0000-000000000122','{"texto":"B0"}'); IF c<>1 THEN RAISE EXCEPTION 'reserva B0'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_confirmar_etapa('20000000-0000-0000-0000-000000000120','30000000-0000-0000-0000-000000000121',0,'40000000-0000-0000-0000-000000000122'); IF c<>1 THEN RAISE EXCEPTION 'confirma B0'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000120','30000000-0000-0000-0000-000000000121',1,'40000000-0000-0000-0000-000000000123','{"texto":"B1"}'); IF c<>1 THEN RAISE EXCEPTION 'reserva B1'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_confirmar_etapa('20000000-0000-0000-0000-000000000120','30000000-0000-0000-0000-000000000121',1,'40000000-0000-0000-0000-000000000123'); IF c<>1 THEN RAISE EXCEPTION 'confirma B1'; END IF;
 SELECT pessoas_no_lote,pausa_tipo INTO cont,tipo FROM public.ienvia_campanhas_controle WHERE campanha_id='20000000-0000-0000-0000-000000000120'; IF cont<>0 OR tipo<>'lote' THEN RAISE EXCEPTION 'pausa de lote incorreta'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_pular_pausa_campanha('20000000-0000-0000-0000-000000000120'); IF c<>1 THEN RAISE EXCEPTION 'não pulou pausa de lote'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000120','30000000-0000-0000-0000-000000000122',0,'40000000-0000-0000-0000-000000000124','{"texto":"C0"}'); IF c<>1 THEN RAISE EXCEPTION 'reserva C0'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_marcar_etapa_incerta('20000000-0000-0000-0000-000000000120','30000000-0000-0000-0000-000000000122',0,'40000000-0000-0000-0000-000000000124'); IF c<>1 THEN RAISE EXCEPTION 'C0 não ficou incerta'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_resolver_etapa_incerta('20000000-0000-0000-0000-000000000120','30000000-0000-0000-0000-000000000122',0,'40000000-0000-0000-0000-000000000124',NULL); IF c<>0 THEN RAISE EXCEPTION 'decisão nula não permitida'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_resolver_etapa_incerta('20000000-0000-0000-0000-000000000120','30000000-0000-0000-0000-000000000122',0,'40000000-0000-0000-0000-000000000124','confirmada'); IF c<>1 THEN RAISE EXCEPTION 'confirmação manual falhou'; END IF;
 SELECT pessoas_no_lote,status INTO cont,tipo FROM public.ienvia_campanhas_controle WHERE campanha_id='20000000-0000-0000-0000-000000000120'; IF cont<>0 OR tipo<>'pausada' THEN RAISE EXCEPTION 'confirmação de etapa não pode contar pessoa'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_alterar_status_campanha('20000000-0000-0000-0000-000000000120','ativa'); IF c<>1 THEN RAISE EXCEPTION 'retomada falhou'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_reservar_etapa('20000000-0000-0000-0000-000000000120','30000000-0000-0000-0000-000000000122',1,'40000000-0000-0000-0000-000000000126','{"texto":"C1"}'); IF c<>1 THEN RAISE EXCEPTION 'reserva C1'; END IF;
 SELECT count(*) INTO c FROM public.ienvia_confirmar_etapa('20000000-0000-0000-0000-000000000120','30000000-0000-0000-0000-000000000122',1,'40000000-0000-0000-0000-000000000126'); IF c<>1 THEN RAISE EXCEPTION 'confirma C1'; END IF;
 SELECT status INTO tipo FROM public.ienvia_campanhas_controle WHERE campanha_id='20000000-0000-0000-0000-000000000120'; IF tipo<>'concluida' THEN RAISE EXCEPTION 'não concluiu campanha'; END IF;
END $$;
RESET ROLE;
