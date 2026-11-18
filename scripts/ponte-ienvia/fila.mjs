import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function abrirFila(diretorio) {
  fs.mkdirSync(diretorio, { recursive: true, mode: 0o700 });
  return {
    guardar(chave, valor) {
      const nome = crypto.createHash('sha256').update(chave).digest('hex') + '.json';
      const arquivo = path.join(diretorio, nome);
      if (fs.existsSync(arquivo)) return;
      const tmp = arquivo + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(valor), { mode: 0o600 });
      fs.renameSync(tmp, arquivo);
    },
    listar(limite = 20) {
      return fs.readdirSync(diretorio).filter(n => n.endsWith('.json')).slice(0, limite).map(nome => ({ nome, valor: JSON.parse(fs.readFileSync(path.join(diretorio,nome),'utf8')) }));
    },
    confirmar(nome) {
      if (!/^[a-f0-9]{64}\.json$/.test(nome)) throw new Error('Nome de entrada inválido.');
      fs.unlinkSync(path.join(diretorio,nome));
    }
  };
}
