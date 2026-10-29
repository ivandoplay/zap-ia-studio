import test from 'node:test';import assert from 'node:assert/strict';import {prepararMaterialCampanha} from '../src/campanhaPlano.js';
const id='11111111-1111-4111-8111-111111111111',bloco={id,tipo:'texto',modo:'fixo',textos:['Mensagem aprovada']};
const plano={nome:'Teste',chips:['slot_1'],modoChips:'fixo',retomada:'manual',blocos:[bloco]};
test('não prepara conteúdo divergente do bloco aprovado no plano',()=>{assert.throws(()=>prepararMaterialCampanha({plano,bloco:{...bloco,textos:['Mensagem diferente']},destinatario:{ordem:1,nome:'A',telefone:'5586981234567',campos:{}}}),/plano/i);});
