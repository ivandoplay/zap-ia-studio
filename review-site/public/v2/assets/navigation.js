const page=(id,label,icon,tab)=>({id,label,icon,href:tab?`/em-preparo/?pagina=${encodeURIComponent(tab)}`:'/visao-geral/'});
export function getNavigation(role='user') {
 const groups=[{label:'Operação',items:[page('overview','Visão geral','overview'),{id:'conversas',label:'Conversas',icon:'chat',href:'/conversas/'},{id:'historico',label:'Histórico por instância',icon:'chat',href:'/historico/'},{id:'campanhas',label:'Campanhas',icon:'campaign',href:'/campanhas/'},{id:'canais',label:'Instâncias',icon:'phone',href:'/instancias/'},{id:'conexoes',label:'Conexões / Motor',icon:'connection',href:'/conexoes/'}]},
 {label:'Meu negócio',items:[{id:'treinamento',label:'Treinamento',icon:'training',href:'/treinamento/'},{id:'catalogo',label:'Catálogo',icon:'catalog',href:'/catalogo/'},{id:'audios',label:'Áudios',icon:'audio',href:'/audios/'},{id:'simulador',label:'Simulador',icon:'simulator',href:'/simulador/'},{id:'ia',label:'Inteligência artificial',icon:'spark',href:'/inteligencia-artificial/'},{id:'config',label:'Configurações',icon:'settings',href:'/configuracoes/'}]}];
 if(['master','administrator'].includes(role))groups.push({label:'Administração',items:[{id:'contas',label:'Contas',icon:'users',href:'/contas/'}]});
 return groups;
}
export function findPages(query='',role='user') {
 const normal=v=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 return getNavigation(role).flatMap(g=>g.items).filter(p=>normal(p.label).includes(normal(query.trim())));
}
