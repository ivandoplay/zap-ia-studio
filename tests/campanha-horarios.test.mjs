import test from 'node:test';
import assert from 'node:assert/strict';
import { estaNaJanela, proximaJanela } from '../src/campanhaHorarios.js';
const config={fuso:'America/Fortaleza',dias:[1,2,3,4,5],inicio:'09:00',fim:'18:00'};
test('respeita hora local, dias úteis e fim exclusivo',()=>{
 assert.equal(estaNaJanela(config,Date.parse('2026-10-28T12:00:00Z')),true);
 assert.equal(estaNaJanela(config,Date.parse('2026-10-28T21:00:00Z')),false);
 assert.equal(estaNaJanela(config,Date.parse('2026-11-01T12:00:00Z')),false);
});
test('encontra o próximo horário permitido com fuso da campanha',()=>{
 assert.equal(new Date(proximaJanela(config,Date.parse('2026-10-30T21:30:01Z'))).toISOString(),'2026-11-02T12:00:00.000Z');
 const dentro=Date.parse('2026-10-28T12:34:22Z');assert.equal(proximaJanela(config,dentro),dentro);
});
test('janela que atravessa meia-noite usa o dia inicial',()=>{
 const c={fuso:'America/Fortaleza',dias:[1],inicio:'22:00',fim:'02:00'};
 assert.equal(estaNaJanela(c,Date.parse('2026-10-27T02:00:00Z')),true);
 assert.equal(estaNaJanela(c,Date.parse('2026-10-27T05:00:00Z')),false);
 assert.equal(estaNaJanela(c,Date.parse('2026-10-28T02:00:00Z')),false);
});
test('horários, dias, fuso e timestamps incorretos são recusados',()=>{
 for (const c of [{...config,dias:[]},{...config,dias:[7]},{...config,inicio:'25:01'},{...config,fim:'09:00'},{...config,fuso:'Fake/Zone'}]) assert.throws(()=>estaNaJanela(c,Date.now()),/inválid/i);
 assert.throws(()=>estaNaJanela(config,NaN),/inválid/i);
});
