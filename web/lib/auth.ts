export type IenviaSession={accessToken:string;refreshToken:string;expiresAt?:number};
export type IenviaUser={id?:string;username?:string;displayName?:string;role?:string;maxWaSlots?:number;isActive?:boolean};
const STORAGE_KEY='zapia_cloud_auth';
export function readAuth():{session:IenviaSession;user?:IenviaUser}|null{if(typeof window==='undefined')return null;try{const raw=localStorage.getItem(STORAGE_KEY);if(!raw)return null;const saved=JSON.parse(raw);if(typeof saved?.accessToken!=='string'||typeof saved?.refreshToken!=='string')return null;return{session:saved,user:saved.user};}catch{return null;}}
export function saveAuth(session:IenviaSession,user?:IenviaUser){localStorage.setItem(STORAGE_KEY,JSON.stringify({...session,user:user??readAuth()?.user??null}));}
export function clearAuth(){localStorage.removeItem(STORAGE_KEY);}
