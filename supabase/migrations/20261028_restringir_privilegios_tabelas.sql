-- RLS protege linhas de SELECT/INSERT/UPDATE/DELETE, mas não restringe TRUNCATE.
-- A aplicação usa CRUD/RPC, não TRUNCATE/TRIGGER/REFERENCES/MAINTAIN como cliente.
-- Preserva privilégios de service_role, postgres e o CRUD existente de clientes.
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE
  public.zapia_commands,
  public.zapia_contacts,
  public.zapia_users,
  public.zapia_wa_runtime,
  public.zapia_wa_slots,
  public.zapia_worker_devices,
  public.zapia_workspaces
FROM anon, authenticated;
