const $=id=>document.getElementById(id),root=$('watchlistsRoot');
if(root){
 let csrf='',lists=[];
 const status=m=>{$('watchlistsStatus').textContent=m;};
 async function api(url,options={}){
  const headers=new Headers(options.headers||{});headers.set('Accept','application/json');
  if(options.body)headers.set('Content-Type','application/json');
  if(options.method&&options.method!=='GET')headers.set('X-CSRF-Token',csrf);
  const r=await fetch(url,{credentials:'same-origin',...options,headers}),d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||'Request failed.');return d;
 }
 function render(){
  const out=$('watchlistsOutput');out.replaceChildren();
  if(!lists.length){const p=document.createElement('p');p.textContent='No saved watchlists yet.';out.append(p);return;}
  for(const list of lists){
   const card=document.createElement('article');card.className='watchlist-entry';
   const h=document.createElement('h4');h.textContent=list.name;card.append(h);
   const rename=document.createElement('button');rename.type='button';rename.className='text-btn';rename.textContent='Rename';
   rename.onclick=async()=>{const name=prompt('New watchlist name:',list.name);if(name===null)return;try{await api('/api/watchlists/'+encodeURIComponent(list.id),{method:'PATCH',body:JSON.stringify({name})});await load();status('Watchlist renamed.');}catch(e){status(e.message);}};
   const del=document.createElement('button');del.type='button';del.className='text-btn';del.textContent='Delete';
   del.onclick=async()=>{if(!confirm(`Delete "${list.name}" and its tickers?`))return;try{await api('/api/watchlists/'+encodeURIComponent(list.id),{method:'DELETE'});await load();status('Watchlist deleted.');}catch(e){status(e.message);}};
   card.append(rename,del);
   const form=document.createElement('form');form.className='watchlist-symbol-form';
   const input=document.createElement('input');input.required=true;input.maxLength=15;input.placeholder='Ticker (e.g. AAPL)';input.setAttribute('aria-label','Ticker');
   const add=document.createElement('button');add.type='submit';add.className='btn primary';add.textContent='Add ticker';form.append(input,add);
   form.onsubmit=async ev=>{ev.preventDefault();try{await api(`/api/watchlists/${encodeURIComponent(list.id)}/items`,{method:'POST',body:JSON.stringify({symbol:input.value})});await load();status('Ticker saved.');}catch(e){status(e.message);}};
   card.append(form);
   const row=document.createElement('div');row.className='watchlist-symbols';
   for(const item of list.items){const chip=document.createElement('span');chip.className='watchlist-chip';const strong=document.createElement('strong');strong.textContent=item.symbol;const x=document.createElement('button');x.type='button';x.textContent='×';x.setAttribute('aria-label','Remove '+item.symbol);x.onclick=async()=>{try{await api(`/api/watchlists/${encodeURIComponent(list.id)}/items?symbol=${encodeURIComponent(item.symbol)}`,{method:'DELETE'});await load();status('Ticker removed.');}catch(e){status(e.message);}};chip.append(strong,x);row.append(chip);}
   card.append(row);out.append(card);
  }
 }
 async function load(){const d=await api('/api/watchlists');lists=d.watchlists||[];render();}
 async function init(){try{const r=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'}),a=await r.json();if(!r.ok||!a.authenticated||!a.csrfToken){$('watchlistsSignedOut').hidden=false;$('watchlistsWorkspace').hidden=true;return;}csrf=a.csrfToken;$('watchlistsSignedOut').hidden=true;$('watchlistsWorkspace').hidden=false;await load();}catch{status('Could not verify your account. Refresh and try again.');}}
 $('watchlistCreateForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/watchlists',{method:'POST',body:JSON.stringify({name:$('watchlistName').value})});$('watchlistName').value='';await load();status('Watchlist created.');}catch(err){status(err.message);}});
 init();
}
