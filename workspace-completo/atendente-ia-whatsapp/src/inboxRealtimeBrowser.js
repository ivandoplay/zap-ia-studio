import {createClient} from '@supabase/supabase-js';
import {createInboxRealtime} from './inboxRealtime.js';
window.ienviaInboxRealtime = createInboxRealtime({
 createClient,
 onChange:()=>window.dispatchEvent(new Event('ienvia:inbox-changed'))
});
