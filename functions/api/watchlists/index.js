import {json,error,readJson,isSameOrigin,checkCsrf,requireDatabase} from '../../../functions-shared/http.js';
import {getAuthenticatedUser,withAuthCookies} from '../../../functions-shared/supabase-auth.js';
import {enforceRateLimit} from '../../../functions-shared/rate-limit.js';
import {normalizeWatchlistName} from '../../../functions-shared/watchlists.js';

export async function onRequestGet({request,env}) {
 try {
  const auth=await getAuthenticatedUser(request,env);
  if(!auth.user?.id)return error('Please sign in to view your watchlists.',401);
  const db=requireDatabase(env);
  const lists=await db.prepare('SELECT id,name,created_at AS createdAt,updated_at AS updatedAt FROM watchlists WHERE user_id=? ORDER BY updated_at DESC').bind(auth.user.id).all();
  const items=await db.prepare('SELECT i.id,i.watchlist_id AS watchlistId,i.symbol,i.created_at AS createdAt FROM watchlist_items i JOIN watchlists w ON w.id=i.watchlist_id WHERE w.user_id=? ORDER BY i.created_at').bind(auth.user.id).all();
  const map=new Map((lists.results||[]).map(x=>[x.id,{...x,items:[]}]));
  for(const item of items.results||[])map.get(item.watchlistId)?.items.push(item);
  return withAuthCookies(json({watchlists:[...map.values()]}),auth);
 } catch(err){console.error('Watchlist read:',err.message);return error('Unable to load watchlists.',503);}
}
export async function onRequestPost({request,env}) {
 if(!isSameOrigin(request))return error('Request origin not allowed.',403);
 if(!checkCsrf(request))return error('Security token expired. Refresh the page and try again.',403);
 try {
  const auth=await getAuthenticatedUser(request,env);
  if(!auth.user?.id)return error('Please sign in to create a watchlist.',401);
  const db=requireDatabase(env),rate=await enforceRateLimit(env,request,`watchlist:${auth.user.id}`,40,900);
  if(!rate.allowed)return error('Too many watchlist changes. Please wait.',429,{'Retry-After':String(rate.retryAfter)});
  const name=normalizeWatchlistName((await readJson(request,2048)).name);
  if(!name)return error('Watchlist names must contain 1–40 characters.',400);
  const count=await db.prepare('SELECT COUNT(*) AS total FROM watchlists WHERE user_id=?').bind(auth.user.id).first();
  if(Number(count?.total||0)>=20)return error('You can create up to 20 watchlists.',400);
  const id=crypto.randomUUID(),now=new Date().toISOString();
  try{await db.prepare('INSERT INTO watchlists(id,user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').bind(id,auth.user.id,name,now,now).run();}
  catch(err){if(/unique/i.test(err.message))return error('A watchlist with that name already exists.',409);throw err;}
  return withAuthCookies(json({ok:true,watchlist:{id,name,createdAt:now,updatedAt:now,items:[]}},201),auth);
 }catch(err){console.error('Watchlist create:',err.message);return err.message.startsWith('Request body')?error(err.message,400):error('Unable to create watchlist.',503);}
}
