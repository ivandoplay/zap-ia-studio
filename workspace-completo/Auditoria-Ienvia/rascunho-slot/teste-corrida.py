import os, subprocess, time

env = {**os.environ,'PGHOST':'127.0.0.1','PGPORT':'55432','PGUSER':'postgres','PGDATABASE':'slot_limpeza_lab'}
def sql(statement):
    return subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-c',statement], env=env, capture_output=True, text=True, check=True).stdout.strip()
owner='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
try:
    sql(f"INSERT INTO auth.users VALUES ('{owner}'); INSERT INTO zapia_wa_slots VALUES ('{owner}','slot_2','disconnected','lab',now());")
    writer=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    writer.stdin.write(f'''BEGIN; INSERT INTO zapia_contacts(user_id,chat_id,data) VALUES ('{owner}','slot_2::lab@lid','{{"messages":[{{"text":"teste antigo"}}]}}');\n\\echo INSERCAO_NAO_CONFIRMADA\n''')
    writer.stdin.flush()
    marker=writer.stdout.readline().strip()
    if marker != 'INSERCAO_NAO_CONFIRMADA': raise RuntimeError(f'Preparação falhou: {marker}')
    print('Gravação antiga aberta antes da limpeza.')
    cleaner=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-c',f"SELECT set_config('request.jwt.claim.sub','{owner}',false); SELECT fichas FROM ienvia_limpar_slot('slot_2');"],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    time.sleep(0.4)
    print('Limpeza aguardou a gravação:', cleaner.poll() is None)
    writer.stdin.write('COMMIT;\n\\q\n');writer.stdin.flush()
    _,err=writer.communicate(timeout=10)
    if writer.returncode: raise RuntimeError(err)
    saida,err=cleaner.communicate(timeout=10)
    if cleaner.returncode: raise RuntimeError(err)
    print('Limpeza informou fichas:', saida.splitlines()[-1])
    count=sql(f"SELECT count(*) FROM zapia_contacts WHERE user_id='{owner}' AND jsonb_array_length(data->'messages')>0;")
    print('Fichas com mensagem antiga após limpeza:', count)
    if count != '0':
        print('FALHA: gravação concorrente pode ressuscitar conteúdo antigo.')
        raise SystemExit(1)
finally:
    sql(f"DELETE FROM zapia_contacts WHERE user_id='{owner}'; DELETE FROM ienvia_slot_geracoes WHERE owner_id='{owner}'; DELETE FROM zapia_wa_slots WHERE user_id='{owner}'; DELETE FROM auth.users WHERE id='{owner}';")
