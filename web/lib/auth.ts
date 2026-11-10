export type IenviaSession={access_token:string;refresh_token:string;expires_at?:number;token_type?:string};
export type IenviaUser={id?:string;username?:string;displayName?:string;role?:string};
const STORAGE_KEY='zapia_cloud_auth',USER_KEY='ienvia_web_user';
export function readAuth():{session:IenviaSession;user?:IenviaUser}|null{if(typeof window==='undefined')return null;try{const raw=localStorage.getItem(STORAGE_KEY);if(!raw)return null;const session=JSON.parse(raw);if(typeof session?.access_token!=='string'||typeof session?.refresh_token!=='string')return null;const u=localStorage.getItem(USER_KEY);return{session,user:u?JSON.parse(u):undefined};}catch{return null;}}
export function saveAuth(session:IenviaSession,user?:IenviaUser){localStorage.setItem(STORAGE_KEY,JSON.stringify(session));if(user)localStorage.setItem(USER_KEY,JSON.stringify(user));else localStorage.removeItem(USER_KEY);}
export function clearAuth(){localStorage.removeItem(STORAGE_KEY);localStorage.removeItem(USER_KEY);}
