'use client';
import Link from 'next/link';
import {usePathname,useRouter} from 'next/navigation';
import {useEffect,useState} from 'react';
import {clearAuth,readAuth} from '@/lib/auth';
import {api} from '@/lib/api';
const groups=[
{label:'Workspace',items:[['/visao-geral','Visão geral','◫'],['/inbox','Inbox','▤'],['/contatos','Contatos','♙'],['/campanhas','Campanhas','➤']]},
{label:'Atendimento inteligente',items:[['/inteligencia-artificial','Inteligência artificial','✳'],['/treinamento','Treinamento','⌘'],['/simulador','Simulador','▷']]},
{label:'Operação',items:[['/conexoes','Conexões','⌁'],['/instancias','Instâncias','▣'],['/canais','Canais','◈'],['/catalogo','Catálogo','▦'],['/audios','Áudios','♫'],['/historico','Histórico','◷']]},
{label:'Gestão',items:[['/relatorios','Relatórios','▥'],['/contas','Contas','♧'],['/seguranca','Segurança','◇'],['/configuracoes','Configurações','⚙']]}
] as const;
export function AppShell({children}:{children:React.ReactNode}){
const pathname=usePathname(),router=useRouter();const[open,setOpen]=useState(false),[name,setName]=useState('Sua conta'),[ready,setReady]=useState(false);
const current=groups.flatMap(g=>g.items).find(x=>x[0]===pathname)?.[1]??'Ienvia';
useEffect(()=>{if(pathname==='/login'){setReady(true);return;}const auth=readAuth();if(!auth){router.replace('/login');return;}setName(auth.user?.displayName||auth.user?.username||'Sua conta');setReady(true);const unauthorized=()=>{clearAuth();router.replace('/login');};window.addEventListener('ienvia:unauthorized',unauthorized);return()=>window.removeEventListener('ienvia:unauthorized',unauthorized);},[pathname,router]);
async function logout(){try{await api('auth/logout',{method:'POST',body:JSON.stringify({logoutWorker:false})});}catch{}clearAuth();router.replace('/login');}
if(pathname==='/login')return <>{children}</>;if(!ready)return <div className="loading">Verificando sua sessão…</div>;
return <div className="frame"><aside className={`sidebar ${open?'open':''}`}><Link className="brand" href="/visao-geral"><span className="brand-mark">✳</span><span>ienvia</span></Link><div className="workspace"><b>Conta Ienvia</b><small>Ambiente de atendimento</small></div><nav aria-label="Navegação principal">{groups.map(g=><section className="nav-group" key={g.label}><div className="nav-label">{g.label}</div>{g.items.map(([href,label,icon])=><Link key={href} href={href} onClick={()=>setOpen(false)} className={`nav-link ${pathname===href?'active':''}`}><span className="nav-icon" aria-hidden="true">{icon}</span>{label}</Link>)}</section>)}</nav><div className="side-bottom"><b>{name}</b><small>Conta autenticada</small><button className="nav-link" onClick={logout} style={{border:0,background:'transparent',width:'100%',marginTop:12,textAlign:'left'}}>↪ Sair da conta</button></div></aside>{open&&<button className="scrim" aria-label="Fechar menu" onClick={()=>setOpen(false)}/>}<div className="main"><header className="topbar"><button className="menu-button" aria-label="Abrir menu" onClick={()=>setOpen(v=>!v)}>☰</button><div className="crumb"><span>Ienvia</span><span>/</span><strong>{current}</strong></div><div className="top-actions"><span className="user-chip">{name}</span></div></header><main className="content">{children}</main></div></div>;
}
