\set ON_ERROR_STOP on
\ir campanha-recuperacao.test.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SELECT public.ienvia_registrar_worker_campanha('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aparelho-c');
SELECT campanha_id AS auto_livre FROM public.ienvia_criar_campanha('{"nome":"Auto livre","chips":["slot_1"],"modoChips":"fixo","retomada":"automatica","blocos":[{"id":"11111111-1111-4111-8111-111111111111","tipo":"texto","modo":"fixo","textos":["Olá"]}]}','{}','[{"telefone":"5586980000051"},{"telefone":"5586980000052"}]') \gset
SELECT campanha_id AS pausada_envio FROM public.ienvia_criar_campanha('{"nome":"Pausada envio","chips":["slot_1"],"modoChips":"fixo","retomada":"manual","blocos":[{"id":"11111111-1111-4111-8111-111111111111","tipo":"texto","modo":"fixo","textos":["Olá"]}]}','{}','[{"telefone":"5586980000061"}]') \gset
SELECT public.ienvia_alterar_status_campanha(:'auto_livre','ativa');SELECT public.ienvia_alterar_status_campanha(:'pausada_envio','ativa');
SELECT destinatario_id AS da,revisao AS ra FROM public.ienvia_campanha_proxima_etapa WHERE campanha_id=:'auto_livre' \gset
SELECT destinatario_id AS dp,revisao AS rp FROM public.ienvia_campanha_proxima_etapa WHERE campanha_id=:'pausada_envio' \gset
SELECT public.ienvia_reservar_worker_campanha(:'auto_livre',:'da',0,'40000000-0000-0000-0000-000000000162','{"slotId":"slot_1","bloco":{"tipo":"texto","texto":"Olá"}}',:'ra','cccccccc-cccc-4ccc-8ccc-cccccccccccc');
SELECT public.ienvia_confirmar_etapa(:'auto_livre',:'da',0,'40000000-0000-0000-0000-000000000162');
SELECT public.ienvia_reservar_worker_campanha(:'pausada_envio',:'dp',0,'40000000-0000-0000-0000-000000000163','{"slotId":"slot_1","bloco":{"tipo":"texto","texto":"Olá"}}',:'rp','cccccccc-cccc-4ccc-8ccc-cccccccccccc');
SELECT public.ienvia_alterar_status_campanha(:'pausada_envio','pausada');
RESET ROLE;
UPDATE public.ienvia_campanha_workers SET heartbeat_em=clock_timestamp()-interval '5 minutes' WHERE worker_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
SET ROLE authenticated;
SELECT public.ienvia_recuperar_campanha(:'auto_livre');SELECT public.ienvia_recuperar_campanha(:'pausada_envio');
SELECT count(*) AS success_auto FROM public.ienvia_campanhas_controle WHERE campanha_id=:'auto_livre' AND status='ativa' AND ultimo_worker IS NULL \gset
SELECT count(*) AS success_paused FROM public.ienvia_campanha_checkpoints WHERE campanha_id=:'pausada_envio' AND status='incerta' \gset
\if :success_auto
\else
\quit 1
\endif
\if :success_paused
\else
\quit 1
\endif
RESET ROLE;
