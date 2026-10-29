\set ON_ERROR_STOP on
\ir campanha-resumo.test.sql
\ir ../../supabase/experimentos/20261029_campanha_recuperacao.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SELECT public.ienvia_registrar_worker_campanha('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aparelho-a');
SELECT campanha_id AS manual FROM public.ienvia_criar_campanha('{"nome":"Manual","chips":["slot_1"],"modoChips":"fixo","retomada":"manual","blocos":[{"id":"11111111-1111-4111-8111-111111111111","tipo":"texto","modo":"fixo","textos":["Olá"]}]}','{}','[{"telefone":"5586980000031"},{"telefone":"5586980000032"}]') \gset
SELECT campanha_id AS auto FROM public.ienvia_criar_campanha('{"nome":"Auto","chips":["slot_1"],"modoChips":"fixo","retomada":"automatica","blocos":[{"id":"11111111-1111-4111-8111-111111111111","tipo":"texto","modo":"fixo","textos":["Olá"]}]}','{}','[{"telefone":"5586980000041"},{"telefone":"5586980000042"}]') \gset
SELECT public.ienvia_alterar_status_campanha(:'manual','ativa');SELECT public.ienvia_alterar_status_campanha(:'auto','ativa');
SELECT destinatario_id AS destmanual,revisao AS revmanual FROM public.ienvia_campanha_proxima_etapa WHERE campanha_id=:'manual' \gset
SELECT destinatario_id AS destauto,revisao AS revauto FROM public.ienvia_campanha_proxima_etapa WHERE campanha_id=:'auto' \gset
SELECT count(*) FROM public.ienvia_reservar_worker_campanha(:'manual',:'destmanual',0,'40000000-0000-0000-0000-000000000160','{"slotId":"slot_1","bloco":{"tipo":"texto","texto":"Olá"}}',:'revmanual','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
SELECT count(*) FROM public.ienvia_confirmar_etapa(:'manual',:'destmanual',0,'40000000-0000-0000-0000-000000000160');
SELECT count(*) FROM public.ienvia_reservar_worker_campanha(:'auto',:'destauto',0,'40000000-0000-0000-0000-000000000161','{"slotId":"slot_1","bloco":{"tipo":"texto","texto":"Olá"}}',:'revauto','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
RESET ROLE;
UPDATE public.ienvia_campanha_workers SET heartbeat_em=clock_timestamp()-interval '5 minutes' WHERE worker_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET ROLE authenticated;
SELECT public.ienvia_recuperar_campanha(:'manual');SELECT public.ienvia_recuperar_campanha(:'auto');
SELECT count(*) AS manual_paused FROM public.ienvia_campanhas_controle WHERE campanha_id=:'manual' AND status='pausada' \gset
SELECT count(*) AS auto_uncertain FROM public.ienvia_campanha_checkpoints WHERE campanha_id=:'auto' AND status='incerta' \gset
SELECT count(*) AS auto_paused FROM public.ienvia_campanhas_controle WHERE campanha_id=:'auto' AND status='pausada' \gset
\if :manual_paused
\else
\quit 1
\endif
\if :auto_uncertain
\else
\quit 1
\endif
\if :auto_paused
\else
\quit 1
\endif
-- Após a escolha explícita de retomar, o worker antigo não deve pausar novamente.
SELECT public.ienvia_registrar_worker_campanha('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aparelho-b');
SELECT public.ienvia_alterar_status_campanha(:'manual','ativa');
SELECT public.ienvia_recuperar_campanha(:'manual');
SELECT count(*) AS resumed FROM public.ienvia_campanhas_controle WHERE campanha_id=:'manual' AND status='ativa' \gset
\if :resumed
\else
\quit 1
\endif
RESET ROLE;
