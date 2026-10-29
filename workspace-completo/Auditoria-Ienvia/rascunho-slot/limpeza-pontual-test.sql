\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE w (user_id uuid PRIMARY KEY,settings jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO auth.users VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
INSERT INTO w VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','{"keep":"yes","deletedChatTombstones":{"slot_2::keep@lid":"2025-01-01T00:00:00Z"}}');
INSERT INTO zapia_contacts(user_id,chat_id,data) VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','558600000000@s.whatsapp.net','{"slotId":"slot_1","phone":"558600000000","messages":[{"text":"a"}]}'),('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','slot_2::123@lid','{"slotId":"slot_2","messages":[{"text":"b"}]}');
WITH alvos AS MATERIALIZED (
 SELECT chat_id,data FROM zapia_contacts WHERE user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND chat_id NOT LIKE 'slot_2::%' AND chat_id NOT LIKE 'slot_3::%' AND COALESCE(data->>'slotId','slot_1')='slot_1'
), aliases AS (
 SELECT chat_id AS chave FROM alvos
 UNION SELECT 'tel:'||regexp_replace(coalesce(data->>'phone',''),'[^0-9]','','g') FROM alvos WHERE length(regexp_replace(coalesce(data->>'phone',''),'[^0-9]','','g'))>=8
), marco AS (SELECT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS stamp), marcas AS (SELECT coalesce(jsonb_object_agg(chave,to_jsonb(stamp)),'{}'::jsonb) AS mapa FROM aliases CROSS JOIN marco), gravado AS (
 UPDATE w SET settings=jsonb_set(settings,'{deletedChatTombstones}',coalesce(settings->'deletedChatTombstones','{}'::jsonb)||marcas.mapa,true),updated_at=clock_timestamp() FROM marcas WHERE user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' RETURNING 1
), excluido AS (DELETE FROM zapia_contacts WHERE user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND chat_id IN (SELECT chat_id FROM alvos) AND EXISTS (SELECT 1 FROM gravado) RETURNING chat_id)
SELECT count(*) FROM excluido;
DO $$ BEGIN
IF (SELECT count(*) FROM zapia_contacts WHERE user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')<>1 OR (SELECT count(*) FROM zapia_contacts WHERE user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND chat_id LIKE 'slot_2::%')<>1 THEN RAISE EXCEPTION 'isolamento falhou';END IF;
IF NOT (SELECT settings->'deletedChatTombstones' ? '558600000000@s.whatsapp.net' AND settings->'deletedChatTombstones' ? 'tel:558600000000' AND settings->'deletedChatTombstones' ? 'slot_2::keep@lid' AND settings->>'keep'='yes' FROM w) THEN RAISE EXCEPTION 'marcadores incorretos'; END IF;
END $$;
ROLLBACK;
