\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO zapia_wa_slots VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','slot_1','connected','one',now()),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','slot_2','disconnected','two',now()),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','slot_2','disconnected','other',now());
INSERT INTO zapia_contacts(user_id,chat_id,data) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','111@s.whatsapp.net','{"messages":[{"text":"principal"}],"notes":"nota principal"}'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','slot_2::222@lid','{"messages":[{"text":"alvo"}],"notes":"nota comercial","tasks":[{"id":"x"}]}'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','slot_2::333@lid','{"messages":[{"text":"outra conta"}]}');
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
SELECT * FROM ienvia_limpar_slot('slot_2');
DO $$ DECLARE a jsonb; b jsonb; c jsonb; BEGIN
 SELECT data INTO a FROM zapia_contacts WHERE chat_id='111@s.whatsapp.net';
 SELECT data INTO b FROM zapia_contacts WHERE chat_id='slot_2::222@lid';
 SELECT data INTO c FROM zapia_contacts WHERE chat_id='slot_2::333@lid';
 IF jsonb_array_length(a->'messages')<>1 OR jsonb_array_length(b->'messages')<>0 OR b->>'notes'<>'nota comercial' OR jsonb_array_length(b->'tasks')<>1 OR jsonb_array_length(c->'messages')<>1 THEN RAISE EXCEPTION 'isolamento falhou'; END IF;
 BEGIN UPDATE zapia_contacts SET data='{"messages":[{"text":"cache antigo"}]}' WHERE chat_id='slot_2::222@lid'; RAISE EXCEPTION 'cache antigo foi aceito'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='cache antigo foi aceito' THEN RAISE; END IF; END;
 BEGIN UPDATE zapia_contacts SET data=jsonb_set(data,'{messages}','[{"text":"cedo"}]') WHERE chat_id='slot_2::222@lid'; RAISE EXCEPTION 'slot bloqueado aceitou mensagem'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='slot bloqueado aceitou mensagem' THEN RAISE; END IF; END;
END $$;
UPDATE zapia_wa_slots SET status='connected',worker_heartbeat_at=clock_timestamp() WHERE user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND slot_id='slot_2';
SELECT ienvia_slot_repareado('slot_2');
UPDATE zapia_contacts SET data=jsonb_set(data,'{messages}','[{"text":"importada"}]') WHERE chat_id='slot_2::222@lid';
DO $$ BEGIN IF (SELECT jsonb_array_length(data->'messages') FROM zapia_contacts WHERE chat_id='slot_2::222@lid')<>1 THEN RAISE EXCEPTION 'reimportação falhou'; END IF; END $$;
ROLLBACK;
