// Preparação isolada de mensagens de campanha. Não envia mensagens nem acessa dados de contas.
const MAX_TEXTO = 20000;
const MAX_PROFUNDIDADE = 16;
const MAX_OPCOES = 100;

function valorAleatorio(random) {
  const valor = random();
  if (!Number.isFinite(valor) || valor < 0 || valor >= 1) throw new Error('Fonte aleatória inválida.');
  return valor;
}

export function sortearInteiro(minimo, maximo, random = Math.random) {
  if (!Number.isSafeInteger(minimo) || !Number.isSafeInteger(maximo) || minimo < 0 || maximo < minimo || maximo > 1000000000) {
    throw new Error('Limites inválidos para sorteio.');
  }
  return minimo + Math.floor(valorAleatorio(random) * (maximo - minimo + 1));
}

export function escolherItem(itens, modo, cursor = 0, random = Math.random) {
  if (!Array.isArray(itens) || itens.length === 0) throw new Error('A lista está vazia.');
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Cursor inválido.');
  let indice;
  if (modo === 'sequencial') indice = cursor % itens.length;
  else if (modo === 'aleatorio') indice = sortearInteiro(0, itens.length - 1, random);
  else throw new Error('Modo de rotação inválido.');
  return { item: itens[indice], indice };
}

export function expandirMensagem(texto, campos = {}, random = Math.random) {
  if (typeof texto !== 'string' || texto.length > MAX_TEXTO || !campos || typeof campos !== 'object' || Array.isArray(campos)) {
    throw new Error('Texto ou campos inválidos; verifique o limite de tamanho.');
  }
  let pos = 0;
  let opcoes = 0;
  const parse = (profundidade, dentro) => {
    if (profundidade > MAX_PROFUNDIDADE) throw new Error('Limite de profundidade do Spintax excedido.');
    const lista = [];
    let literal = '';
    const limpar = () => { if (literal) { lista.push({tipo:'texto', valor:literal}); literal=''; } };
    while (pos < texto.length) {
      const atual = texto[pos];
      if (dentro && (atual === '|' || atual === '}')) break;
      if (atual === '}') throw new Error('Spintax inválido: chave de fechamento inesperada.');
      if (atual === '{' && texto[pos + 1] === '{') {
        limpar();
        const fim = texto.indexOf('}}', pos + 2);
        if (fim < 0) throw new Error('Campo inválido: fechamento ausente.');
        const nome = texto.slice(pos + 2, fim).trim();
        if (!/^[\p{L}\p{N}_]+$/u.test(nome)) throw new Error('Campo inválido.');
        lista.push({tipo:'campo', valor:nome.toLocaleLowerCase('pt-BR')});
        pos = fim + 2;
      } else if (atual === '{') {
        limpar(); pos++;
        const alternativas = [];
        while (true) {
          const ramo = parse(profundidade + 1, true);
          if (ramo.length === 0) throw new Error('Spintax inválido: opção vazia.');
          alternativas.push(ramo);
          if (++opcoes > MAX_OPCOES) throw new Error('Limite de opções do Spintax excedido.');
          if (texto[pos] === '|') { pos++; continue; }
          if (texto[pos] !== '}' || alternativas.length < 2) throw new Error('Spintax inválido: alternativas ou fechamento ausentes.');
          pos++; break;
        }
        lista.push({tipo:'escolha', valor:alternativas});
      } else { literal += atual; pos++; }
    }
    limpar();
    return lista;
  };
  const arvore = parse(0, false);
  const valores = new Map(Object.entries(campos).map(([chave, valor]) => [chave.toLocaleLowerCase('pt-BR'), valor]));
  const renderizar = (lista) => lista.map((no) => {
    if (no.tipo === 'texto') return no.valor;
    if (no.tipo === 'campo') {
      if (!valores.has(no.valor) || valores.get(no.valor) == null) throw new Error(`Campo não informado: ${no.valor}.`);
      return String(valores.get(no.valor));
    }
    return renderizar(no.valor[sortearInteiro(0, no.valor.length - 1, random)]);
  }).join('');
  return renderizar(arvore);
}
