// Shell público mínimo. Sem cache de API, páginas autenticadas, contatos ou arquivos compartilhados.
const CACHE_NAME='ienvia-shell-v46';
const SHELL_ASSETS=['/offline.html','/manifest.json','/icon-v2.svg'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL_ASSETS)));});
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME&&/^(zapia-studio-shell-|ienvia-shell-)/.test(key)).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin||req.headers.get('range')||req.headers.get('authorization')||req.headers.get('x-panel-pin')||/^\/(api|uploads|ws)(\/|$)/.test(url.pathname))return;
 if(req.mode==='navigate'){event.respondWith(fetch(req,{cache:'no-cache'}).catch(()=>caches.match('/offline.html').then(value=>value||new Response('Sem rede. Reabra o aplicativo quando houver conexão.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}}))));return;}
 const staticAsset=SHELL_ASSETS.includes(url.pathname)||/^\/v2\/assets\/[a-zA-Z0-9_.-]+\.(js|css|woff2|png|svg)$/.test(url.pathname)||/^\/pwa-icons\/(192|512)\.png$/.test(url.pathname);
 if(!staticAsset||url.search)return;
 event.respondWith(fetch(req,{cache:'no-cache'}).then(response=>{if(response.ok&&response.status===200&&response.type==='basic'&&!/no-store|private/i.test(response.headers.get('cache-control')||'')){const copy=response.clone();event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put(req,copy)).catch(()=>{}));}return response;}).catch(()=>caches.match(req).then(value=>value||Response.error())));
});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(self.clients.openWindow('/visao-geral/'));});
