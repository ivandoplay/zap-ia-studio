import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createZipBuffer, extractZipBuffer } from '../src/zipReader.js';
import { importarXlsx } from '../src/campanhaXlsx.js';

test('importa a primeira planilha XLSX, identifica duplicados e inválidos',async()=>{
 const dados=readFileSync(new URL('./fixtures/campanha-sintetico.xlsx',import.meta.url));
 const out=await importarXlsx(dados);
 assert.deepEqual(out.destinatarios,[{nome:'Ana Sintética',telefone:'5586981234567'},{nome:'Bruno Sintético',telefone:'5586987654321'}]);
 assert.deepEqual(out.problemas.map(x=>x.tipo),['duplicado','invalido']);
});
test('recusa arquivo inválido, expansão excessiva e entradas duplicadas',async()=>{
 await assert.rejects(()=>importarXlsx(Buffer.from('não é uma planilha')),/inválid|ZIP|planilha/i);
 const grande=createZipBuffer([{path:'xl/worksheets/sheet1.xml',content:Buffer.alloc(16*1024*1024,65)}]);
 await assert.rejects(()=>importarXlsx(grande),/limite|excede|grande/i);
 const duplo=createZipBuffer([{path:'xl/workbook.xml',content:'a'},{path:'xl/workbook.xml',content:'b'}]);
 await assert.rejects(()=>importarXlsx(duplo),/duplic/i);
});

test('recusa coordenadas esparsas excessivas e declarações XML',async()=>{
 const base=readFileSync(new URL('./fixtures/campanha-sintetico.xlsx',import.meta.url));
 const entries=extractZipBuffer(base).files.map(f=>({path:f.path,content:f.buffer}));
 const idx=entries.findIndex(f=>f.path==='xl/worksheets/sheet1.xml');assert.ok(idx>=0);
 for (const xml of ['<worksheet><dimension ref="A1:XFD1048576"/></worksheet>','<worksheet><sheetData><row r="100000"><c r="A100000"><v>1</v></c></row></sheetData></worksheet>','<!DOCTYPE foo [<!ENTITY x "texto">]><worksheet/>','<worksheet><numFmt numFmtId="2147483647"/></worksheet>','<worksheet>'+ '<si/>'.repeat(500001) +'</worksheet>']) {
  const clone=entries.map(x=>({...x}));clone[idx]={path:clone[idx].path,content:xml};
  await assert.rejects(()=>importarXlsx(createZipBuffer(clone)),/limite|não permitid/i);
 }
});

test('rejeita planilha apontada por relações para arquivo que escaparia à validação XML',async()=>{
 const base=readFileSync(new URL('./fixtures/campanha-sintetico.xlsx',import.meta.url));
 const entries=extractZipBuffer(base).files.map(f=>({path:f.path,content:f.buffer}));
 const rel=entries.findIndex(f=>f.path==='xl/_rels/workbook.xml.rels');const sheet=entries.findIndex(f=>f.path==='xl/worksheets/sheet1.xml');
 for(const prefixado of [false,true]) {
  const clone=entries.map(x=>({...x}));let xml=clone[rel].content.toString().replace('/xl/worksheets/sheet1.xml','/xl/worksheets/sheet1.bin');
  if(prefixado)xml=xml.replace('<Relationships ', '<Relationships xmlns:x="urn:teste" ').replace('Target="/xl/worksheets/sheet1.bin"','x:Target="/xl/worksheets/sheet1.bin"');
  clone[rel]={...clone[rel],content:xml};clone[sheet]={...clone[sheet],path:'xl/worksheets/sheet1.bin'};
  await assert.rejects(()=>importarXlsx(createZipBuffer(clone)),/relação|caminho|xml/i);
 }
});
