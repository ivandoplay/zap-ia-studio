// Gerencia orçamento comum da cascata. A função invocada deve respeitar timeoutMs
// e cancelar a requisição; este módulo não tenta cancelar uma Promise por si só.
export async function executarGeminiLimitado({
  chaves, modelos, indiceInicial = 0, invocar, prazoMs = 38000,
  agora = () => performance.now(), aguardar = (ms) => new Promise(r => setTimeout(r, ms))
}) {
  if (!Array.isArray(chaves) || !chaves.length || !Array.isArray(modelos) || !modelos.length || typeof invocar !== 'function' || !Number.isFinite(prazoMs) || prazoMs < 1000) throw new Error('Configuração da cascata Gemini inválida.');
  const inicio = agora();
  let ultimaFalha = null;
  for (let i = 0; i < chaves.length; i++) {
    const indice = (indiceInicial + i) % chaves.length;
    for (const modelo of modelos) {
      const restante = Math.floor(prazoMs - (agora() - inicio));
      if (restante < 500) throw ultimaFalha || new Error('Tempo limite da chamada Gemini esgotado.');
      try {
        const texto = await invocar({chave:chaves[indice],modelo,timeoutMs:Math.min(35000,restante)});
        return {texto,modelo,indiceChave:indice+1,totalChaves:chaves.length};
      } catch (erro) {
        ultimaFalha = erro;
        const msg = String(erro?.message || ''), status = Number(erro?.status || erro?.code);
        if (![400,404,429,503].includes(status) && !/429|quota|404|not_found|no longer available|overloaded|unavailable|abort|timeout|api_key_invalid/i.test(msg)) throw erro;
        if ((status === 503 || /503|overloaded|unavailable/i.test(msg)) && prazoMs - (agora() - inicio) > 1200) await aguardar(700);
      }
    }
  }
  throw ultimaFalha || new Error('Nenhum modelo Gemini respondeu.');
}
