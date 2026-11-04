const page=(id,label,icon,tab)=>({id,label,icon,href:tab?`/painel#${tab}`:'/visao-geral/'});
export function getNavigation(role='user') {
 const groups=[{label:'Operação',items:[page('overview','Visão geral','overview'),page('conversas','Conversas','chat','crm'),page('campanhas','Campanhas','campaign','campanhas'),{id:'conexoes',label:'Conexões / Motor',icon:'connection',href:'/conexoes/'}]},
 {label:'Meu negócio · painel atual',items:[page('treinamento','Treinamento','training','treinamento'),page('catalogo','Catálogo','catalog','catalogo'),page('audios','Áudios','audio','audios'),page('simulador','Simulador','simulator','simulador'),page('ia','Inteligência artificial','spark','ia'),page('config','Configurações','settings','seguranca')]}];
 if(role==='master')groups.push({label:'Administração · painel atual',items:[page('contas','Contas','users','contas')]});
 return groups;
}
export function findPages(query='',role='user') {
 const normal=v=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 return getNavigation(role).flatMap(g=>g.items).filter(p=>normal(p.label).includes(normal(query.trim())));
}
