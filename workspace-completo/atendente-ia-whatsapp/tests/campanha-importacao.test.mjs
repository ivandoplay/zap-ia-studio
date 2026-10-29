import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretarCsv, importarDestinatarios, normalizarTelefoneCampanha } from '../src/campanhaImportacao.js';

test('CSV interpreta campos entre aspas, escape, quebra de linha e BOM',()=>{
 assert.deepEqual(interpretarCsv('\ufeffNome;Telefone;Nota\r\n"Ana; Maria";"(86) 98123-4567";"linha 1\nlinha ""2"""\r\n',';'),[['Nome','Telefone','Nota'],['Ana; Maria','(86) 98123-4567','linha 1\nlinha "2"']]);
});
test('CSV inválido é rejeitado e separador é explícito',()=>{
 for(const v of ['Nome;Telefone\n"Ana;123','Nome;Telefone\n"Ana"x;123','Nome;Telefone\nAna";123'])assert.throws(()=>interpretarCsv(v,';'),/CSV inválido/i);
 assert.throws(()=>interpretarCsv('a,b','|'),/separador/i);
});
test('normaliza números sem assegurar existência no WhatsApp',()=>{
 assert.equal(normalizarTelefoneCampanha('(86) 98123-4567'),'5586981234567');
 assert.equal(normalizarTelefoneCampanha('+55 (86) 98123-4567'),'5586981234567');
 assert.equal(normalizarTelefoneCampanha('+44 7700 900123'),'447700900123');
 assert.equal(normalizarTelefoneCampanha('5586981234567'),'5586981234567');
 assert.equal(normalizarTelefoneCampanha('123'),null);
 assert.equal(normalizarTelefoneCampanha('1e+12'),null);
 assert.equal(normalizarTelefoneCampanha('tel:abc'),null);
});
test('importa CSV por cabeçalho e sinaliza inválidos e repetidos sem descartá-los silenciosamente',()=>{
 const result=importarDestinatarios({texto:'nome;telefone\nAna;(86) 98123-4567\nAna repetida;+55 86 98123-4567\nSem número;abc\nBruna;86987654321',formato:'csv',separador:';'});
 assert.deepEqual(result.destinatarios,[{nome:'Ana',telefone:'5586981234567'},{nome:'Bruna',telefone:'5586987654321'}]);
 assert.deepEqual(result.problemas.map(x=>x.tipo),['duplicado','invalido']);
});
test('importa lista de texto com um telefone por linha, sem permitir conteúdo ilimitado',()=>{
 const result=importarDestinatarios({texto:'(86) 98123-4567\n+55 86 98765-4321',formato:'txt'});
 assert.equal(result.destinatarios.length,2);assert.equal(result.destinatarios[0].nome,'');
 assert.throws(()=>importarDestinatarios({texto:'0'.repeat(2000001),formato:'txt'}),/limite/i);
 assert.throws(()=>importarDestinatarios({texto:'telefone\n123',formato:'xlsx'}),/formato/i);
});

test('preserva campos adicionais seguros para personalização e recusa cabeçalhos ambíguos',()=>{
 const r=importarDestinatarios({texto:'Nome;Telefone;Cidade;Nome do Produto\nAna;86981234567;Batalha;Plano Ouro',formato:'csv',separador:';'});
 assert.deepEqual(r.destinatarios[0].campos,{cidade:'Batalha',nome_do_produto:'Plano Ouro'});
 assert.throws(()=>importarDestinatarios({texto:'telefone;celular\n86981234567;86987654321',formato:'csv',separador:';'}),/ambígu/i);
 assert.throws(()=>importarDestinatarios({texto:'telefone;Cidade;cidade\n86981234567;A;B',formato:'csv',separador:';'}),/duplicad/i);
 assert.throws(()=>importarDestinatarios({texto:'telefone;__proto__\n86981234567;A',formato:'csv',separador:';'}),/inválid/i);
});

test('informa a linha física correta no CSV, incluindo vazias e campos multilinha',()=>{
 const texto='Nome;Telefone\n\n"Ana\nSilva";abc\nBruno;86987654321\nBruno repetido;86987654321';
 const r=importarDestinatarios({texto,formato:'csv',separador:';'});
 assert.deepEqual(r.problemas,[{linha:3,tipo:'invalido'},{linha:6,tipo:'duplicado'}]);
});
