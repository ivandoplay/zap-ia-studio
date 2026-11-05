// Servidor LOCAL de demonstração. Não importa servidor principal, auth, .env ou APIs.
import express from 'express';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),app=express();
const config=JSON.parse(fs.readFileSync(path.join(root,'review-site/vercel.json'),'utf8'));
app.disable('x-powered-by');app.use((_req,res,next)=>{for(const h of config.headers[0].headers){
 // Somente o preview local fictício permite iframe; a CSP publicada continua frame-ancestors 'none'.
 res.setHeader(h.key,h.key==='Content-Security-Policy'?h.value.replace("frame-ancestors 'none'; ",''):h.value);
}next();});
const startPath=['/contas/','/configuracoes/','/inteligencia-artificial/','/simulador/','/catalogo/','/audios/','/treinamento/','/campanhas/','/conversas/','/visao-geral/'].includes(process.env.REVIEW_START_PATH)?process.env.REVIEW_START_PATH:'/conversas/';
app.get('/',(_q,r)=>r.redirect(startPath));app.use(express.static(path.join(root,'review-site/public')));app.use((_q,r)=>r.status(404).type('text').send('Página não disponível nesta demonstração.'));
app.listen(Number(process.env.PORT||4174),'0.0.0.0',()=>console.log('Revisão visual estática disponível. Dados fictícios; sem autenticação, API, banco ou WhatsApp.'));
