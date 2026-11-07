import {chromium} from 'playwright';
const B='https://zap-ia-studio.vercel.app';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1440,height:900}});
const p=await ctx.newPage();
await p.goto(B,{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForTimeout(2500);
console.log('URL inicial:',p.url());
console.log('título:',await p.title());
// procura campos de login
const inputs=await p.$$eval('input',els=>els.map(e=>({type:e.type,name:e.name,placeholder:e.placeholder,id:e.id})));
console.log('inputs:',JSON.stringify(inputs).slice(0,600));
const btns=await p.$$eval('button',els=>els.map(e=>e.textContent.trim()).filter(Boolean).slice(0,15));
console.log('botões:',JSON.stringify(btns));
await p.screenshot({path:'/home/user/shots/00-login.png',fullPage:false}).catch(()=>{});
await b.close();
