// Atalhos do compositor: fonte explícita; sem API, armazenamento, motor ou envio.
export function matchQuickReplies(items,query=''){
 if(!Array.isArray(items))throw TypeError('Fonte de respostas rápidas indisponível.');
 const q=String(query).replace(/^\/+/, '').toLowerCase().trim();
 return items.filter(item=>!q||[item.shortcut,item.title,item.text].some(value=>String(value).toLowerCase().includes(q)));
}
export function expandQuickReply(text,name=''){
 const first=String(name||'').trim().split(/\s+/)[0]||'';
 const result=String(text||'').replace(/\{\{\s*nome\s*\}\}|\{\s*nome\s*\}/gi,()=>first).trim();if(result.length>4000)throw Object.assign(Error('O atalho com o nome excede 4000 caracteres. Revise o texto antes de inserir.'),{status:400});return result;
}
let sequence=0;
export function mountQuickRepliesPopover({root,input,getItems,getName,onSelect,onManage,onError=error=>{throw error;},signal}){
 const controller=new AbortController(),id='crm-quick-replies-'+(++sequence),popup=document.createElement('section'),head=document.createElement('header'),list=document.createElement('div'),empty=document.createElement('p');let dead=false,selected=0,items=[];
 popup.className='crm-slash-popover';popup.hidden=true;popup.setAttribute('aria-label','Atalhos de resposta');head.className='crm-slash-head';const title=document.createElement('strong');title.textContent='Respostas rápidas';head.append(title);
 if(onManage){const manage=document.createElement('button');manage.type='button';manage.className='hub-button';manage.textContent='Gerenciar atalhos';manage.addEventListener('click',()=>{if(dead||input.closest('[inert]'))return;hide();try{Promise.resolve(onManage()).catch(onError);}catch(error){onError(error);}});head.append(manage);}
 list.id=id;list.setAttribute('role','listbox');list.setAttribute('aria-label','Respostas rápidas disponíveis');empty.textContent='Nenhum atalho encontrado.';popup.append(head,list,empty);root.append(popup);input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',id);input.setAttribute('aria-expanded','false');
 function hide(){popup.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
 function choose(item){if(dead||!root.isConnected||input.closest('[inert]')||signal?.aborted)return;try{const text=expandQuickReply(item.text,getName());onSelect(text);hide();}catch(error){onError(error);}}
 function draw(){list.replaceChildren();empty.hidden=items.length>0;items.forEach((item,i)=>{const option=document.createElement('button'),code=document.createElement('code'),title=document.createElement('strong'),preview=document.createElement('small');option.type='button';option.className='crm-slash-option';option.id=id+'-'+i;option.setAttribute('role','option');option.setAttribute('aria-selected',String(selected===i));option.tabIndex=-1;code.textContent='/'+item.shortcut;title.textContent=item.title;preview.textContent=item.text;option.append(code,title,preview);option.addEventListener('pointerdown',e=>e.preventDefault());option.addEventListener('click',()=>choose(item));list.append(option);});if(items.length)input.setAttribute('aria-activedescendant',id+'-'+selected);else input.removeAttribute('aria-activedescendant');}
 function update(value){if(dead)return;if(!String(value).startsWith('/')){hide();return;}items=matchQuickReplies(getItems(),value);selected=0;draw();popup.hidden=false;input.setAttribute('aria-expanded','true');}
 function keyDown(event){if(dead||popup.hidden||event.isComposing||event.keyCode===229)return false;const key=event.key;if(!['ArrowDown','ArrowUp','Enter','Tab','Escape'].includes(key))return false;if(key==='Tab'&&!items.length)return false;event.preventDefault();event.stopPropagation();if(key==='Escape')hide();else if(key==='Enter'||key==='Tab'){if(items.length)choose(items[selected]);}else if(items.length){selected=(selected+(key==='ArrowDown'?1:-1)+items.length)%items.length;draw();list.children[selected]?.scrollIntoView({block:'nearest'});}return true;}
 document.addEventListener('pointerdown',e=>{if(e.target!==input&&!popup.contains(e.target))hide();},{signal:controller.signal});
 function dispose(){if(dead)return;dead=true;controller.abort();signal?.removeEventListener('abort',dispose);hide();popup.remove();items=[];input.removeAttribute('aria-controls');input.removeAttribute('aria-autocomplete');}
 signal?.addEventListener('abort',dispose,{once:true});return {update,keyDown,hide,dispose};
}
export function parseQuickReplyDraft(value){
 const fail=()=>{throw Object.assign(Error('Confira o código, título e texto do atalho (até 4000 caracteres).'),{status:400});};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['id','shortcut','title','text'].includes(k)))fail();
 if(value.id!==undefined&&(typeof value.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(value.id)))fail();
 if(typeof value.shortcut!=='string'||!value.shortcut.trim()||value.shortcut.length>80||/[\x00-\x1f\x7f]/.test(value.shortcut)||typeof value.text!=='string'||!value.text.trim()||value.text.length>4000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.text))fail();
 const shortcut=value.shortcut.trim().replace(/^\/+/, '').toLowerCase().replace(/[^a-z0-9_-]/g,'')||'atalho';
 if(value.title!==undefined&&(typeof value.title!=='string'||value.title.length>160||/[\x00-\x1f\x7f]/.test(value.title)))fail();
 return {...value.id?{id:value.id}:{},shortcut,title:value.title?.trim()||shortcut,text:value.text.trim()};
}
