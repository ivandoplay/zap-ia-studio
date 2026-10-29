import os, subprocess, time
env={**os.environ,'PGHOST':'127.0.0.1','PGPORT':'55432','PGUSER':'postgres','PGDATABASE':'slot_limpeza_lab'}
def sql(s): return subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-c',s],env=env,capture_output=True,text=True,check=True).stdout.strip()
owner='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
try:
 sql(f"INSERT INTO auth.users VALUES ('{owner}'); INSERT INTO zapia_wa_slots VALUES ('{owner}','slot_2','disconnected','lab',now()); INSERT INTO zapia_contacts(user_id,chat_id,data) VALUES ('{owner}','slot_2::lab@lid','{{\"messages\":[{{\"text\":\"antiga\"}}]}}');")
 writer=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 writer.stdin.write(f"BEGIN; UPDATE zapia_contacts SET data=data||'{{\"notes\":\"edição prévia\"}}'::jsonb WHERE user_id='{owner}' AND chat_id='slot_2::lab@lid';\n\\echo LINHA_TRAVADA\n");writer.stdin.flush()
 assert writer.stdout.readline().strip()=='LINHA_TRAVADA'
 cleaner=subprocess.Popen(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-c',f"SELECT set_config('request.jwt.claim.sub','{owner}',false); SELECT fichas FROM ienvia_limpar_slot('slot_2');"],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 time.sleep(.4)
 writer.stdin.write('COMMIT;\n\\q\n');writer.stdin.flush()
 out,err=writer.communicate(timeout=10); co,ce=cleaner.communicate(timeout=10)
 print('Transação de edição:',writer.returncode,'; transação de limpeza:',cleaner.returncode)
 if 'deadlock detected' in (err+ce).lower():
  print('FALHA: interbloqueio reproduzido no protótipo serializado; abortar implantação.');raise SystemExit(1)
 if writer.returncode or cleaner.returncode: print('Outra falha:',err,ce);raise SystemExit(1)
finally:
 sql(f"DELETE FROM zapia_contacts WHERE user_id='{owner}'; DELETE FROM ienvia_slot_geracoes WHERE owner_id='{owner}'; DELETE FROM zapia_wa_slots WHERE user_id='{owner}'; DELETE FROM auth.users WHERE id='{owner}';")
