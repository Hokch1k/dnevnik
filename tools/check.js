// Проверка PWA в headless Chrome: метрики вёрстки + скриншоты (онлайн и офлайн).
// Запуск: node tools/check.js
const {spawn}=require('child_process');
const fs=require('fs');
const path=require('path');
const os=require('os');

const CHROME=process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_BASE=process.env.URL_BASE||'http://127.0.0.1:8123/index.html';
const OUT=path.join(os.tmpdir(),'kilo');
const PORT=9333;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function pick(obj,fn){let out=[];fn(obj,out);return out}

function httpJson(url){
  return new Promise((resolve,reject)=>{
    require('http').get(url,res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>{try{resolve(JSON.parse(b))}catch(e){reject(e)}})}).on('error',reject);
  });
}

class Client{
  constructor(wsUrl){this.ws=new WebSocket(wsUrl);this.id=0;this.pending=new Map();this.events=new Map();
    this.ws.onmessage=ev=>{const m=JSON.parse(ev.data);
      if(m.id&&this.pending.has(m.id)){const{resolve,reject}=this.pending.get(m.id);this.pending.delete(m.id);
        m.error?reject(new Error(m.error.message)):resolve(m.result);}
      else if(m.method){const l=this.events.get(m.method)||[];l.forEach(f=>f(m.params));}
    };}
  open(){return new Promise((res,rej)=>{this.ws.onopen=res;this.ws.onerror=rej})}
  on(method,fn){if(!this.events.has(method))this.events.set(method,[]);this.events.get(method).push(fn)}
  send(method,params){
    const id=++this.id;
    return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params:params||{}}))});
  }
  async eval(expr){
    const r=await this.send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw new Error(r.exceptionDetails.text+' '+JSON.stringify(r.exceptionDetails.exception||{}));
    return r.result.value;
  }
  async shot(file){
    const r=await this.send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(file,Buffer.from(r.data,'base64'));
    return file;
  }
}

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const profile=path.join(OUT,'chrome-profile-'+Date.now());
  const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
    '--remote-debugging-port='+PORT,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});

  try{
    let version=null;
    for(let i=0;i<40&&!version;i++){
      try{version=await httpJson('http://127.0.0.1:'+PORT+'/json/version')}catch(e){await sleep(250)}
    }
    if(!version)throw new Error('не удалось запустить headless Chrome');

    const targets=await httpJson('http://127.0.0.1:'+PORT+'/json/list');
    const page=targets.find(t=>t.type==='page');
    if(!page)throw new Error('нет вкладки в headless Chrome');
    const c=new Client(page.webSocketDebuggerUrl);
    await c.open();

    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:3,mobile:true});
    await c.send('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36'});

    await c.send('Page.navigate',{url:URL_BASE});
    await sleep(2500);

    const metrics=await c.eval(`(()=>{
      const r=el=>{const b=el.getBoundingClientRect();return {l:Math.round(b.left),t:Math.round(b.top),r:Math.round(b.right),b:Math.round(b.bottom)}};
      const card=document.querySelector('.card');
      return JSON.stringify({
        vw:innerWidth, docScroll:document.documentElement.scrollWidth, bodyScroll:document.body.scrollWidth,
        cards:document.querySelectorAll('.card').length,
        title:document.querySelector('#ttl').textContent,
        sub:document.querySelector('#sub').textContent,
        firstCard:card?r(card):null,
        refreshBtn:r(document.querySelector('#refreshBtn')),
        tabs:r(document.querySelector('#tabs')),
        bannerClass:document.querySelector('#offlineBanner').className,
        bannerText:document.querySelector('#offlineBanner').textContent
      });
    })()`);
    const online=JSON.parse(metrics);
    console.log('ONLINE',JSON.stringify(online,null,1));
    await c.shot(path.join(OUT,'dnevnik-online.png'));

    const sheet=JSON.parse(await c.eval(`(()=>{
      document.querySelector('#repoBtn').click();
      const s=document.querySelector('#sheet');
      return JSON.stringify({
        open:s.classList.contains('open'),
        rows:s.querySelectorAll('.row').length,
        hasApk:s.innerHTML.indexOf('Dnevnik.apk')>=0,
        text:(s.textContent||'').replace(/\\s+/g,' ').trim().slice(0,160)
      });
    })()`));
    console.log('SHEET',JSON.stringify(sheet,null,1));
    await sleep(700);
    await c.shot(path.join(OUT,'dnevnik-sheet.png'));
    await c.eval("document.querySelector('#s_close').click()");

    // проверка автообновления с внешнего адреса (SYNC_URL)
    if(process.env.SYNC_URL){
      await c.eval(`localStorage.setItem('data_url',${JSON.stringify(process.env.SYNC_URL)})`);
      const before=JSON.parse(await c.eval(`JSON.stringify({sub:document.querySelector('#sub').textContent})`));
      await c.eval(`sync(true)`);
      await sleep(1500);
      const after=JSON.parse(await c.eval(`JSON.stringify({sub:document.querySelector('#sub').textContent,cards:document.querySelectorAll('.card').length})`));
      console.log('SYNC',JSON.stringify({url:process.env.SYNC_URL,before:before.sub,after:after.sub,cards:after.cards},null,1));
      await c.eval(`localStorage.removeItem('data_url')`);
    }
    // офлайн
    await c.send('Network.enable');
    await c.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await c.send('Page.reload',{ignoreCache:false});
    await sleep(2500);
    const off=JSON.parse(await c.eval(`(()=>{
      const b=document.querySelector('#offlineBanner');
      return JSON.stringify({
        bannerClass:b.className, bannerText:b.textContent,
        cards:document.querySelectorAll('.card').length,
        title:document.querySelector('#ttl').textContent,
        sub:document.querySelector('#sub').textContent
      });
    })()`));
    console.log('OFFLINE',JSON.stringify(off,null,1));
    await c.shot(path.join(OUT,'dnevnik-offline.png'));
  }finally{
    chrome.kill();
  }
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
