// Gera uma migração experimental ordenada. Não aplica nada ao Supabase.
import fs from 'node:fs';import path from 'node:path';
const names=['checkpoints','controle','insercao','destinatarios','planos','media','edicao','uploads','resumo','recuperacao','prontas','recuperacao_lote','remocao_destinatarios','falhas','falhas_view','upload_servico','excluir_media'];
const dir='supabase/experimentos',out=path.join(dir,'campanhas_migracao_consolidada_experimental.sql');
const text=names.map(n=>{const f=`20261029_campanha_${n}.sql`;return `\n-- ==== ${f} ====\n`+fs.readFileSync(path.join(dir,f),'utf8').trim()+'\n';}).join('');
fs.writeFileSync(out,'-- EXPERIMENTAL: NÃO APLICAR À PRODUÇÃO ANTES DE REVISÃO E TESTES REAIS.\n-- Gerado automaticamente; aplicar integralmente em transação única.\n'+text);console.log(`Gerada migração experimental: ${names.length} arquivos, ${Buffer.byteLength(text)} bytes.`);
