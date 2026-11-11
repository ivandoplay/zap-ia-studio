import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const proposal = readFileSync(
  new URL('../supabase/experimentos/security_definer_acl_proposal.sql', import.meta.url),
  'utf8',
);

await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE ROLE service_role;

  CREATE FUNCTION public.ienvia_finalizar_exclusao_arquivo_campanha_servico(uuid, uuid)
  RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;

  CREATE FUNCTION public.ienvia_registrar_arquivo_campanha_servico(uuid, uuid, uuid, text, bigint, text, text)
  RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;

  -- Reproduz a ACL observada no banco remoto: anon e service_role tinham EXECUTE.
  GRANT EXECUTE ON FUNCTION public.ienvia_finalizar_exclusao_arquivo_campanha_servico(uuid, uuid)
    TO anon, service_role;
  GRANT EXECUTE ON FUNCTION public.ienvia_registrar_arquivo_campanha_servico(uuid, uuid, uuid, text, bigint, text, text)
    TO anon, service_role;
`);

test('proposta remove EXECUTE de anon e preserva service_role nas RPCs internas', async () => {
  await db.exec(proposal);

  const { rows } = await db.query(`
    SELECT
      has_function_privilege('anon',
        'public.ienvia_finalizar_exclusao_arquivo_campanha_servico(uuid,uuid)', 'EXECUTE') AS anon_delete,
      has_function_privilege('anon',
        'public.ienvia_registrar_arquivo_campanha_servico(uuid,uuid,uuid,text,bigint,text,text)', 'EXECUTE') AS anon_register,
      has_function_privilege('service_role',
        'public.ienvia_finalizar_exclusao_arquivo_campanha_servico(uuid,uuid)', 'EXECUTE') AS service_delete,
      has_function_privilege('service_role',
        'public.ienvia_registrar_arquivo_campanha_servico(uuid,uuid,uuid,text,bigint,text,text)', 'EXECUTE') AS service_register
  `);

  assert.equal(rows[0].anon_delete, false);
  assert.equal(rows[0].anon_register, false);
  assert.equal(rows[0].service_delete, true);
  assert.equal(rows[0].service_register, true);
});

test.after(async () => db.close());
