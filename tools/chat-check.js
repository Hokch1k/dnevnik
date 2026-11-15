// Проверка чата: вход по коду, отправка сообщения, шифрование на сервере.
// Запуск: node tools/chat-check.js <код класса>
const {spawn}=require('child_process');
const fs=require('fs');
const path=require('path');
const os=require('os');
const crypto=require('crypto');

const CHROME=process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_BASE=process.env.URL_BASE||'http://127.0.0.1:8123/index.html';
const CODE=process.argv[2]||'';
const OUT=path.join(os.tmpdir(),'kilo');
const PORT=9334;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const SALTD='4hwf+0CdaqeqoMKDSFeyLA==';
const SALTK='1Dl+G/fnUz7kNueMLfIvfg==';
const TOPIC_SALT='dnevnik-chat-2026c';

function httpJson(url){
  return new Promise((resolve,reject)=>{
    require('http').get(url,res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>{try{resolve(JSON.parse(b))}catch(e){reject(e)}})}).on('error',reject);
  });
}
class Client{
  constructor(wsUrl){this.ws=new WebSocket(wsUrl);this.id=0;this.pending=new Map();
    this.ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&this.pending.has(m.id)){const{resolve,reject}=this.pending.get(m.id);this.pending.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result);}else if(m.method==='Runtime.consoleAPICalled'){console.log('PAGE',m.params.type,(m.params.args||[]).map(a=>a.value||a.description||'').join(' ').slice(0,300));}else if(m.method==='Runtime.exceptionThrown'){console.log('PAGE EXC',JSON.stringify(m.params.exceptionDetails.exception&&m.params.exceptionDetails.exception.description||m.params.exceptionDetails.text).slice(0,300));}};}
  open(){return new Promise((res,rej)=>{this.ws.onopen=res;this.ws.onerror=rej})}
  send(method,params){const id=++this.id;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params:params||{}}))})}
  async eval(expr){
    const r=await this.send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
}

(async()=>{
  if(!CODE){console.error('нужен код класса аргументом');process.exit(2)}
  fs.mkdirSync(OUT,{recursive:true});
  const profile=path.join(OUT,'chat-profile-'+Date.now());
  const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
  try{
    let v=null;
    for(let i=0;i<40&&!v;i++){try{v=await httpJson('http://127.0.0.1:'+PORT+'/json/version')}catch(e){await sleep(250)}}
    if(!v)throw new Error('chrome не запустился');
    const list=await httpJson('http://127.0.0.1:'+PORT+'/json/list');
    const page=list.find(t=>t.type==='page');
    const c=new Client(page.webSocketDebuggerUrl);
    await c.open();
    await c.send('Page.enable');await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
    await c.send('Page.navigate',{url:URL_BASE});
    await sleep(2500);

    const errs=await c.eval(`JSON.stringify(window.__errs||[])`);
    console.log('js errors at load:',errs);

    // открыть чат
    await c.eval(`document.querySelector('#chatBtn').click()`);
    await sleep(300);
    const unlockSeen=await c.eval(`!!document.querySelector('#u_code')`);
    console.log('unlock sheet:',unlockSeen);

    // неверный код
    await c.eval(`(()=>{document.querySelector('#u_code').value='wrong-code';document.querySelector('#u_go').click()})()`);
    await sleep(1500);
    const wrongRejected=await c.eval(`!!document.querySelector('#u_code')`);
    console.log('wrong code rejected:',wrongRejected);

    // верный код
    await c.eval(`(()=>{document.querySelector('#u_code').value=${JSON.stringify(CODE)};document.querySelector('#u_go').click()})()`);
    await sleep(2500);
    const nickSeen=await c.eval(`!!document.querySelector('#n_nick')`);
    console.log('nick sheet:',nickSeen);
    if(nickSeen){
      await c.eval(`(()=>{document.querySelector('#n_nick').value='Тестер';document.querySelector('#n_go').click()})()`);
      await sleep(1500);
    }
    const chatOpen=await c.eval(`!!document.querySelector('#chatInput')`);
    console.log('chat open:',chatOpen);
    if(!chatOpen){throw new Error('чат не открылся')}

    if(process.env.DRY){
      const got=await c.eval(`chat.topic`);
      const exp='dnevnik'+crypto.createHash('sha256').update(CODE+TOPIC_SALT).digest('base64url').replace(/[+/=]/g,'').slice(0,24);
      console.log('DRY topic page:',got);
      console.log('DRY topic node:',exp);
      console.log('DRY topic match:',got===exp);
      console.log('DRY messages on server:',(await (await fetch('https://ntfy.sh/'+exp+'/json?poll=1&since=all')).text()).split('\n').filter(Boolean).length);
      return;
    }
    const msg='тест-'+Date.now();
    await c.eval(`(()=>{document.querySelector('#chatInput').value=${JSON.stringify(msg)};document.querySelector('#chatSend').click()})()`);
    await sleep(2500);
    const after=JSON.parse(await c.eval(`(()=>{const l=document.querySelector('#chatList');return JSON.stringify({text:(l.textContent||'').slice(-120),msgs:l.querySelectorAll('.msg').length,state:document.querySelector('#chatState').textContent})})()`));
    console.log('after send:',JSON.stringify(after,null,1));
    const shot=await c.send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(OUT,'chat.png'),Buffer.from(shot.data,'base64'));

    // офлайн: те же сообщения остаются, состояние переключается
    await c.send('Network.enable');
    await c.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await sleep(900);
    const off=JSON.parse(await c.eval(`(()=>{const b=document.querySelector('#offlineBanner');return JSON.stringify({online:navigator.onLine,banner:b.className+' | '+b.textContent,msgs:document.querySelectorAll('#chatList .msg').length})})()`));
    await c.eval(`chatPoll()`);
    await sleep(700);
    const offState=await c.eval(`document.querySelector('#chatState').textContent`);
    console.log('OFFLINE CHAT',JSON.stringify({...off,state:offState},null,1));
    await c.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    // независимая проверка: расшифровываем последнее сообщение на сервере ключом из кода
    const topic='dnevnik'+crypto.createHash('sha256').update(CODE+TOPIC_SALT).digest('base64url').replace(/[+/=]/g,'').slice(0,24);
    const key=crypto.pbkdf2Sync(CODE,Buffer.from(SALTK,'base64'),120000,32,'sha256');
    const r=await fetch('https://ntfy.sh/'+topic+'/json?poll=1&since=all');
    const lines=(await r.text()).split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(x=>x&&x.event==='message');
    const last=lines[lines.length-1];
    if(!last){console.log('SERVER: сообщений не найдено');process.exit(1)}
    const plaintextSeen=lines.some(l=>String(l.message).includes(msg));
    const[ivS,ctS]=String(last.message).split('.');
    const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(ivS,'base64'));
    const tag=Buffer.from(ctS,'base64').subarray(-16);
    d.setAuthTag(tag);
    const body=Buffer.concat([d.update(Buffer.from(ctS,'base64').subarray(0,-16)),d.final()]).toString('utf8');
    console.log('SERVER payload sample:',String(last.message).slice(0,48)+'…');
    console.log('SERVER plaintext leak:',plaintextSeen);
    console.log('SERVER decrypted:',body);
  }finally{chrome.kill()}
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
