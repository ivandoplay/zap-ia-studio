// Paginação por keyset (cursor) em vez de OFFSET.
// OFFSET 5000 faz o Postgres varrer e descartar 5000 linhas; o cursor usa o índice
// e começa a ler exatamente onde parou — custo constante em qualquer página.
//
// Regra de ouro: cursor só funciona com ORDER BY em coluna única e estável
// (id, created_at com desempate por id). Nunca use cursor com ORDER BY aleatório.

/**
 * @param {object} query  builder do supabase-js já com .order() aplicado
 * @param {{cursor?:string|null, coluna?:string, limite?:number}} opts
 */
export function aplicarCursor(query, { cursor = null, coluna = 'created_at', limite = 50 } = {}) {
  const tamanho = Math.max(1, Math.min(500, Number(limite) || 50));
  let q = cursor ? query.gt(coluna, cursor) : query;
  q = q.order(coluna, { ascending: true }).limit(tamanho + 1);
  return {
    query: q,
    /** Separa a página do "tem mais" e devolve o próximo cursor. */
    finalizar(linhas = []) {
      const temMais = linhas.length > tamanho;
      const pagina = temMais ? linhas.slice(0, tamanho) : linhas;
      const ultimo = pagina[pagina.length - 1];
      return {
        pagina,
        temMais,
        proximoCursor: ultimo ? ultimo[coluna] : null
      };
    }
  };
}
