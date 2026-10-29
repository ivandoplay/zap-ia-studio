import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const base='https://zap-ia-studio.vercel.app';
const expected=createHash('sha256').update(await readFile('/home/user/atendente-ia-whatsapp/public/ienvia-logo-v2.png')).digest('hex');
const a=await fetch(`${base}/ienvia-logo-v2.png`,{cache:'no-store'});assert.equal(a.status,200);assert.equal(createHash('sha256').update(Buffer.from(await a.arrayBuffer())).digest('hex'),expected);
const browser=await chromium.launch({headless:true});try{for(const width of [320,375,1440]){const page=await browser.newPage({viewport:{width,height:850},reducedMotion:'reduce'});const errs=[];page.on('pageerror',e=>errs.push(e.message));let r=await page.goto(base+'/?logo=novo',{waitUntil:'load'});assert.equal(r.status(),200);const img=page.locator('.ienvia-wordmark');assert.equal(await img.getAttribute('src'),'/ienvia-logo-v2.png');assert(await img.evaluate(i=>i.complete&&i.naturalWidth>0));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));r=await page.goto(base+'/painel',{waitUntil:'load'});assert.equal(r.status(),200);const icon=page.locator('#cloudLoginScreen .brand-mark img');assert.equal(await icon.getAttribute('src'),'/ienvia-icon-v2.png');assert(await icon.evaluate(i=>i.complete&&i.naturalWidth>0));assert.deepEqual(errs,[]);console.log(`OK: logo e login em produção ${width}px`);await page.close();}}finally{await browser.close()}
const v=await(await fetch(base+'/api/public/version',{cache:'no-store'})).json();assert.equal(v.version,'5.8.14');console.log('Versão do motor em produção:',v.version);
