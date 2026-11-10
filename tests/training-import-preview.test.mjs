import test from 'node:test';
import assert from 'node:assert/strict';
import {previewTrainingImport} from '../src/training/importPreview.js';
import {createTrainingDocument} from '../src/shared/contracts/training-domain.js';

const ownerId = '00000000-0000-4000-8000-000000000001';
const context = {tenant:{id:ownerId},viewer:{id:ownerId,role:'master'}};

test('training import preview compiles an isolated document without mutating the active source', async () => {
  const current = createTrainingDocument({name:'Perfil atual',tone:'consultivo'});
  const before = structuredClone(current);
  const blueprint = {
    profile:{name:'Clínica Sorriso',niche:'Odontologia',tone:'acolhedor',faqs:[{question:'Atende sábado?',answer:'Consulte a agenda.'}]},
    approvedMessages:[{title:'Boas-vindas',text:'Olá! Como posso ajudar?'}],
    operationalSkills:[{name:'Acolhimento',when:'Primeiro contato',bodyMd:'Faça uma pergunta simples.'}],
    humanizationSkills:[{name:'Naturalidade',goal:'Conversar com clareza e empatia.'}]
  };
  const result = await previewTrainingImport({
    bytesBase64:Buffer.from(JSON.stringify(blueprint)).toString('base64'),
    filename:'treinamento.json',
    document:current,
    ctx:context
  });
  assert.equal(result.training.name,'Clínica Sorriso');
  assert.equal(result.pack.canonicalCore.approvedMessages.length,1);
  assert.equal(result.pack.operationalSkills.length,1);
  assert.equal(result.pack.humanizationSkills.length,1);
  assert.deepEqual(current,before);
});

test('training import preview rejects malformed base64 before compiling', async () => {
  const current = createTrainingDocument({name:'Perfil atual',tone:'consultivo'});
  await assert.rejects(
    previewTrainingImport({bytesBase64:'%%%invalid%%%',filename:'treinamento.json',document:current,ctx:context}),
    /Arquivo inválido/
  );
});
