// Проверка личных сообщений: свой код, вход по коду друга, отправка и приём.
// Запуск: node tools/dm-check.js "<код класса>"
const {spawn}=require('child_process');
const fs=require('fs');
const path=require('path');
const os=require('os');
const crypto=require('crypto');

const CHROME=process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_BASE=process.env.URL_BASE||'http://127.0.0.1:8123/index.html';
const CODE=process.argv[2]||'';
const OUT=path.join(os.tmpdir(),'kilo');
const PORT=9356;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const DM_SALT=Buffer.from('1Dl+G/fnUz7kNueMLfIvfg==','base64');

function httpJson(u){return new Promise((res,rej)=>{require('http').get(u,r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(e)}})}).on('error',rej)})}
class Client{
  constructor(u){this.ws=new WebSocket(u);this.id=0;this.pending=new Map();
    this.ws.onmessage=ev=>{const m=JSON.parse(ev.data);
      if(m.id&&this.pending.has(m.id)){const{resolve,reject}=this.pending.get(m.id);this.pending.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result);}
      else if(m.method==='Runtime.exceptionThrown'){console.log('EXC',String((m.params.exceptionDetails.exception||{}).description||'').slice(0,200));}};}
  open(){return new Promise((r,j)=>{this.ws.onopen=r;this.ws.onerror=j})}
  send(method,params){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{resolve:res,reject:rej});this.ws.send(JSON.stringify({id,method,params:params||{}}))})}
  async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error((r.exceptionDetails.exception&&r.exceptionDetails.exception.description)||r.exceptionDetails.text);return r.result.value}
}
function dmPair(a,b){return [String(a).toLowerCase(),String(b).toLowerCase()].sort().join('|')}
function dmTopicFor(a,b){const id=dmPair(a,b);let x=5381,y=52711;for(let i=0;i<id.length;i++){x=((x<<5)+x+id.charCodeAt(i))>>>0;y=((y<<7)-y+id.charCodeAt(i))>>>0}return 'dnevnikDM'+x.toString(36)+y.toString(36)}
function dmEncFor(a,b,obj){
  const key=crypto.pbkdf2Sync('dm:'+dmPair(a,b),DM_SALT,120000,32,'sha256');
  const iv=crypto.randomBytes(12);
  const c=crypto.createCipheriv('aes-256-gcm',key,iv);
  const ct=Buffer.concat([c.update(JSON.stringify(obj),'utf8'),c.final(),c.getAuthTag()]);
  return iv.toString('base64')+'.'+ct.toString('base64');
}
function dmEnc(code,obj){
  const key=crypto.pbkdf2Sync('dm:'+code,DM_SALT,120000,32,'sha256');
  const iv=crypto.randomBytes(12);
  const c=crypto.createCipheriv('aes-256-gcm',key,iv);
  const ct=Buffer.concat([c.update(JSON.stringify(obj),'utf8'),c.final(),c.getAuthTag()]);
  return iv.toString('base64')+'.'+ct.toString('base64');
}

(async()=>{
  if(!CODE){console.error('нужен код класса');process.exit(2)}
  fs.mkdirSync(OUT,{recursive:true});
  const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+path.join(OUT,'dm-'+Date.now()),'about:blank'],{stdio:'ignore'});
  try{
    let v=null;for(let i=0;i<40&&!v;i++){try{v=await httpJson('http://127.0.0.1:'+PORT+'/json/version')}catch(e){await sleep(250)}}
    const page=(await httpJson('http://127.0.0.1:'+PORT+'/json/list')).find(t=>t.type==='page');
    const c=new Client(page.webSocketDebuggerUrl);await c.open();
    await c.send('Page.enable');await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
    await c.send('Page.navigate',{url:URL_BASE});await sleep(2400);

    await c.eval(`openChat()`);await sleep(400);
    if(await c.eval(`!!document.querySelector('#u_code')`)){
      await c.eval(`(()=>{document.querySelector('#u_code').value=${JSON.stringify(CODE)};document.querySelector('#u_go').click()})()`);await sleep(2200);
    }
    if(await c.eval(`!!document.querySelector('#n_nick')`)){
      await c.eval(`(()=>{document.querySelector('#n_nick').value='ДМ-тест';document.querySelector('#n_go').click()})()`);await sleep(1200);
    }

    await c.eval(`dmSheet()`);await sleep(300);
    const myCode=await c.eval(`document.querySelector('#dm_me').value||''`);
    console.log('my username:',myCode);
    const me='user'+Math.random().toString(36).slice(2,7);
    const friend='friend'+Math.random().toString(36).slice(2,7);
    await c.eval(`(()=>{document.querySelector('#dm_me').value=${JSON.stringify(me)};document.querySelector('#dm_code').value=${JSON.stringify(friend)};document.querySelector('#dm_add').click()})()`);
    await sleep(500);
    console.log('dm opened:',await c.eval(`!!document.querySelector('#dmInput')`));

    await c.eval(`(()=>{document.querySelector('#dmInput').value='привет лично';document.querySelector('#dmSend').click()})()`);
    await sleep(1200);
    console.log('local dm msg:',await c.eval(`(dmMsgs(${JSON.stringify(friend)}).slice(-1)[0]||{}).t`));

    // входящее от «друга»
    const incoming={u:'in1',d:'friend-dev',n:friend,t:'ответ тебе',ts:Date.now()};
    const rr=await fetch('https://ntfy.sh/'+dmTopicFor(me,friend),{method:'POST',body:dmEncFor(me,friend,incoming)});
    console.log('post status:',rr.status,'topic:',dmTopicFor(me,friend));
    await sleep(4000);
    console.log('incoming dm:',await c.eval(`!!dmMsgs(${JSON.stringify(friend)}).find(x=>x.u==='in1')`));
  }finally{chrome.kill()}
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
