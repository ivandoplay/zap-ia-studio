import test from 'node:test';
import assert from 'node:assert/strict';
import {filterConversations} from '../public/v2/assets/conversations-model.js';

test('paridade CRM: busca encontra campos da ficha e arquivadas sem alterar o filtro padrão',()=>{
 const rows=[{id:'a',name:'Ana',archived:true,phone:'+558600000077',company:'Cerâmica Horizonte',city:'Batalha',email:'ana@example.invalid',leadSource:'Feira do Centro',note:'Entrega no balcão',tags:[]},{id:'b',name:'Bruno',archived:false,tags:[]}];
 assert.deepEqual(filterConversations(rows).map(c=>c.id),['b']);
 for(const q of ['Ana','558600000077','ceramica horizonte','batalha','ana@example.invalid','feira do centro','entrega no balcão'])assert.deepEqual(filterConversations(rows,{q}).map(c=>c.id),['a'],q);
 assert.deepEqual(filterConversations(rows,{q:'   '}).map(c=>c.id),['b']);
 assert.deepEqual(filterConversations(rows,{q:'.*'}),[]);
 assert.deepEqual(filterConversations(rows,{filter:'archived'}).map(c=>c.id),['a']);
 assert.equal(rows[0].archived,true);
});

test('paridade CRM: Com você segue etapa atual e Quentes preserva etiquetas/sentimento oficiais',()=>{
 const rows=[{id:'a',stage:'aguardando_humano',needsHuman:false,tags:['Cliente VIP']},{id:'b',stage:'concluido',needsHuman:true,tags:[]},{id:'c',stage:'novo',tags:['Pedido de alto valor']},{id:'d',stage:'novo',tags:[],sentiment:{code:'hot'}},{id:'e',needsHuman:true,hot:true,tags:[]}];
 assert.deepEqual(filterConversations(rows,{filter:'human'}).map(c=>c.id),['a','e']);
 assert.deepEqual(filterConversations(rows,{filter:'hot'}).map(c=>c.id),['a','c','d','e']);
 assert.deepEqual(filterConversations(rows,{filter:'human',tag:'Cliente VIP'}).map(c=>c.id),['a']);
});
