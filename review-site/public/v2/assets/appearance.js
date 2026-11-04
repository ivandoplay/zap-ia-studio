import {readAppearance,saveAppearance,appearanceKey} from './appearance-preferences.js';
import {icon} from './icons.js';
export function mountAppearance({currentUser,api}={}) {
 const subject=currentUser?.id||'local-browser',key=appearanceKey(subject);let storage;
 try{storage=window.localStorage;}catch{}
 const button=document.querySelector('#theme-toggle'),feedback=document.querySelector('#appearance-feedback');
 let disposed=false,version=0,timer,busy=false;
 const pendingKey=key?`${key}:pending`:null;
 const pending=()=>{try{return !!pendingKey&&storage?.getItem(pendingKey)==='1';}catch{return false;}};
 function mark(value){try{if(pendingKey)value?storage?.setItem(pendingKey,'1'):storage?.removeItem(pendingKey);}catch{}}
 function apply(theme){document.documentElement.dataset.theme=theme;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#101815':'#f4f7f5');button.setAttribute('aria-label',theme==='dark'?'Usar tema claro':'Usar tema escuro');button.title=button.getAttribute('aria-label');button.innerHTML=icon(theme==='dark'?'sun':'moon');}
 function notice(text,retry=false){clearTimeout(timer);feedback.replaceChildren(document.createTextNode(text));feedback.hidden=false;if(retry){const btn=document.createElement('button');btn.className='button button-quiet';btn.textContent='Tentar salvar tema';btn.type='button';btn.addEventListener('click',()=>save(document.documentElement.dataset.theme));feedback.append(btn);}else timer=setTimeout(()=>{if(!disposed)feedback.hidden=true;},5000);}
 async function save(theme){
  if(busy||disposed)return;busy=true;button.disabled=true;version++;apply(theme);
  const saved=saveAppearance(storage,subject,theme);
  if(api?.account){mark(true);notice('Aplicando tema e salvando na sua conta…');
   try{await api.save(theme);if(disposed)return;mark(false);notice(`Tema ${theme==='dark'?'escuro':'claro'} salvo na sua conta.`);}
   catch{if(!disposed)notice(saved?'Tema aplicado e salvo neste navegador, mas ainda não sincronizado com a conta.':'Tema aplicado apenas nesta aba. Não foi possível salvar.',true);}
  }else notice(saved?'Tema salvo neste navegador.':'Tema aplicado apenas nesta aba; armazenamento indisponível.');
  if(!disposed){busy=false;button.disabled=false;}
 }
 apply(readAppearance(storage,subject));
 const initial=version;
 if(api?.account)api.load().then(data=>{if(disposed||version!==initial)return;if(pending()){notice('A escolha deste navegador ainda não foi sincronizada com a conta.',true);return;}if(['dark','light'].includes(data.theme)){apply(data.theme);saveAppearance(storage,subject,data.theme);}}).catch(()=>{if(!disposed&&version===initial)notice('Não foi possível consultar a aparência da conta. Mantida a escolha deste navegador.');});
 const onClick=()=>save(document.documentElement.dataset.theme==='dark'?'light':'dark');
 const onStorage=event=>{if(!disposed&&(event.key===key||event.key===null))apply(readAppearance(storage,subject));};
 button.addEventListener('click',onClick);window.addEventListener('storage',onStorage);
 return ()=>{disposed=true;clearTimeout(timer);button.removeEventListener('click',onClick);window.removeEventListener('storage',onStorage);};
}
