import { SqliteHistoryLab } from './native-sqlite-history.mjs';
const [filename,start,count] = process.argv.slice(2); const db=new SqliteHistoryLab(filename);
try {
  for(let chip=Number(start);chip<Number(start)+Number(count);chip++) {
    const chat=`slot_${chip%3+1}::simulado-${chip}`;
    const user=`conta-${Math.floor(chip/3)}`;
    for(let batch=0;batch<5;batch++) {
      const rows=Array.from({length:200},(_,j)=>{
        const n=batch*200+j; return {waMsgId:`m-${n}`,timestamp:new Date(1700000000000+n*1000).toISOString(),role:'user',text:'Texto de mensagem simulada para teste de carga.'};
      });
      db.add(user,chat,rows);
    }
  }
} finally {db.close();}
