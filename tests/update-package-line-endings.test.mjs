import assert from 'node:assert/strict';
process.env.VERCEL='1';process.env.SUPABASE_URL='http://127.0.0.1:1';process.env.SUPABASE_ANON_KEY='teste';
const {normalizeMotorPackageFile}=await import('../src/server.js');
for(const ext of ['bat','ps1','txt']){
 const lf=Buffer.from('linha1\nlinha2\n');const crlf=Buffer.from('linha1\r\nlinha2\r\n');
 assert.equal(normalizeMotorPackageFile('teste.'+ext,lf).toString(),'linha1\r\nlinha2\r\n');
 assert.deepEqual(normalizeMotorPackageFile('teste.'+ext,lf),normalizeMotorPackageFile('teste.'+ext,crlf));
}
assert.equal(normalizeMotorPackageFile('teste.sh',Buffer.from('a\r\nb\r\n')).toString(),'a\nb\n');
const binary=Buffer.from([0,13,10,255]);assert.deepEqual(normalizeMotorPackageFile('img.png',binary),binary);
console.log('OK: conteúdo de ZIP é determinístico entre CRLF e LF; binários intactos.');
