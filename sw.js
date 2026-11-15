const CACHE='dnevnik-v4';
const SHELL=['./','./index.html','./manifest.json','./icon-192.png','./icon-512.png','./data.json'];

self.addEventListener('install',e=>{
  e.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await Promise.allSettled(SHELL.map(u=>cache.add(new Request(u,{cache:'reload'}))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.protocol!=='http:'&&url.protocol!=='https:')return;

  if(req.mode==='navigate'){
    e.respondWith(networkFirst(req,true));
    return;
  }
  if(url.origin===location.origin){
    e.respondWith(networkFirst(req,false));
    return;
  }
  if(/\/data\.json(\?|$)/.test(url.pathname)){
    e.respondWith(networkFirst(req,false));
  }
});

async function networkFirst(request,isPage){
  const cache=await caches.open(CACHE);
  try{
    const response=await fetch(request,{cache:'no-store'});
    if(response&&response.ok)cache.put(request,response.clone());
    return response;
  }catch(err){
    const cached=await cache.match(request,{ignoreSearch:true});
    if(cached)return cached;
    if(isPage){
      const shell=await cache.match('./index.html');
      if(shell)return shell;
    }
    return new Response('Offline',{status:503,statusText:'Offline'});
  }
}

self.addEventListener('message',e=>{
  if(e.data==='skipWaiting')self.skipWaiting();
});
