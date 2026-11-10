import{createClient,RealtimeChannel}from'@supabase/supabase-js';
import{api}from'./api';import{readAuth}from'./auth';
type Config={ok:boolean;url:string;key:string;userId:string};
export async function startInboxRealtime(onChange:()=>void):Promise<()=>void>{
 const auth=readAuth();if(!auth?.session.accessToken)return()=>{};
 const config=await api<Config>('cloud/realtime-config');const latest=readAuth();if(!latest?.session.accessToken)return()=>{};
 if(!config.ok||!config.url||!config.key||!config.userId)return()=>{};
 const client=createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 await client.realtime.setAuth(latest.session.accessToken);
 let active=true;
 const signal=()=>{if(active)onChange();};
 const refreshToken=()=>{const token=readAuth()?.session.accessToken;if(token)void client.realtime.setAuth(token);};window.addEventListener('ienvia:token-updated',refreshToken);
 const channel:RealtimeChannel=client.channel('ienvia-inbox-'+config.userId).on('postgres_changes',{event:'*',schema:'public',table:'zapia_contacts',filter:'user_id=eq.'+config.userId},signal).subscribe(status=>{if(status==='SUBSCRIBED')signal();});
 return async()=>{active=false;window.removeEventListener('ienvia:token-updated',refreshToken);try{await client.removeChannel(channel);}catch{}try{client.realtime.disconnect();}catch{}};
}
