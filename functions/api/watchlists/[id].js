import {json,error,readJson,isSameOrigin,checkCsrf,requireDatabase} from '../../../functions-shared/http.js';
import {getAuthenticatedUser,withAuthCookies} from '../../../functions-shared/supabase-auth.js';
import {enforceRateLimit} from '../../../functions-shared/rate-limit.js';
import {normalizeWatchlistName} from '../../../functions-shared/watchlists.js';
async function context(request,env){const auth=await getAuthenticatedUser(request,env);if(!auth.user?.id)return {response:error('Please sign in to manage watchlists.',401)};const db=requireDatabase(env),rate=await enforceRateLimit(env,request,`watchlist:${auth.user.id}`,40,900);if(!rate.allowed)return {response:error('Too many watchlist changes. Please wait.',429,{'Retry-After':String(rate.retryAfter)})};return {auth,db};}
export async function onRequestPatch({request,env,params}){
 if(!isSameOrigin(request))return error('Request origin not allowed.',403);if(!checkCsrf(request))return error('Security token expired.',403);
 try{const c=await context(request,env);if(c.response)return c.response;const name=normalizeWatchlistName((await readJson(request,2048)).name);if(!name)return error('Watchlist names must contain 1–40 characters.',400);const now=new Date().toISOString();try{const r=await c.db.prepare('UPDATE watchlists SET name=?,updated_at=? WHERE id=? AND user_id=?').bind(name,now,String(params.id||''),c.auth.user.id).run();if(!r.meta?.changes)return error('Watchlist not found.',404);}catch(e){if(/unique/i.test(e.message))return error('A watchlist with that name already exists.',409);throw e;}return withAuthCookies(json({ok:true,name,updatedAt:now}),c.auth);}
 catch(e){console.error('Watchlist rename:',e.message);return e.message.startsWith('Request body')?error(e.message,400):error('Unable to rename watchlist.',503);}
}
export async function onRequestDelete({request,env,params}){
 if(!isSameOrigin(request))return error('Request origin not allowed.',403);if(!checkCsrf(request))return error('Security token expired.',403);
 try{const c=await context(request,env);if(c.response)return c.response;const r=await c.db.prepare('DELETE FROM watchlists WHERE id=? AND user_id=?').bind(String(params.id||''),c.auth.user.id).run();if(!r.meta?.changes)return error('Watchlist not found.',404);return withAuthCookies(json({ok:true}),c.auth);}
 catch(e){console.error('Watchlist delete:',e.message);return error('Unable to delete watchlist.',503);}
}
