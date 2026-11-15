// Проверка живой доставки чата (WebSocket), правки и удаления чужого сообщения.
// Запуск: node tools/ws-check.js "<код класса>"
const {spawn}=require('child_process');
const fs=require('fs');
const path=require('path');
const os=require('os');
const crypto=require('crypto');

const CHROME=process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_BASE=process.env.URL_BASE||'http://127.0.0.1:8123/index.html';
const CODE=process.argv[2]||'';
const OUT=path.join(os.tmpdir(),'kilo');
const PORT=9336;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const SALTK=Buffer.from('1Dl+G/fnUz7kNueMLfIvfg==','base64');
const TOPIC_SALT='dnevnik-chat-2026d';
const key=crypto.pbkdf2Sync(CODE,SALTK,120000,32,'sha256');
const topic='dnevnik'+crypto.createHash('sha256').update(CODE+TOPIC_SALT).digest('base64url').replace(/[+\/=]/g,'').slice(0,24);

function enc(obj){
  const iv=crypto.randomBytes(12);
  const c=crypto.createCipheriv('aes-256-gcm',key,iv);
  const ct=Buffer.concat([c.update(JSON.stringify(obj),'utf8'),c.final()]);
  return iv.toString('base64')+'.'+Buffer.concat([ct,c.getAuthTag()]).toString('base64');
}
async function post(obj){
  const r=await fetch('https://ntfy.sh/'+topic,{method:'POST',body:enc(obj)});
  return r.status;
}

function httpJson(url){return new Promise((res,rej)=>{require('http').get(url,r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(e)}})}).on('error',rej)})}
class Client{
  constructor(u){this.ws=new WebSocket(u);this.id=0;this.pending=new Map();
    this.ws.onmessage=ev=>{const m=JSON.parse(ev.data);
      if(m.id&&this.pending.has(m.id)){const{resolve,reject}=this.pending.get(m.id);this.pending.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result);}
      else if(m.method==='Runtime.exceptionThrown'){console.log('PAGE EXC',String((m.params.exceptionDetails.exception||{}).description||m.params.exceptionDetails.text).slice(0,200));}};}
  open(){return new Promise((r,j)=>{this.ws.onopen=r;this.ws.onerror=j})}
  send(method,params){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{resolve:res,reject:rej});this.ws.send(JSON.stringify({id,method,params:params||{}}))})}
  async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value}
  async shot(f){const r=await this.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(f,Buffer.from(r.data,'base64'))}
}

(async()=>{
  if(!CODE){console.error('нужен код класса');process.exit(2)}
  fs.mkdirSync(OUT,{recursive:true});
  const profile=path.join(OUT,'ws-profile-'+Date.now());
  const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
  try{
    let v=null;for(let i=0;i<40&&!v;i++){try{v=await httpJson('http://127.0.0.1:'+PORT+'/json/version')}catch(e){await sleep(250)}}
    if(!v)throw new Error('chrome не запустился');
    const page=(await httpJson('http://127.0.0.1:'+PORT+'/json/list')).find(t=>t.type==='page');
    const c=new Client(page.webSocketDebuggerUrl);await c.open();
    await c.send('Page.enable');await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
    await c.send('Page.navigate',{url:URL_BASE});
    await sleep(2600);

    await c.eval(`document.querySelector('#chatBtn').click()`);
    await sleep(400);
    await c.eval(`(()=>{document.querySelector('#u_code').value=${JSON.stringify(CODE)};document.querySelector('#u_go').click()})()`);
    await sleep(2400);
    if(await c.eval(`!!document.querySelector('#n_nick')`)){
      await c.eval(`(()=>{document.querySelector('#n_nick').value='Тестер';document.querySelector('#n_go').click()})()`);
      await sleep(1600);
    }
    console.log('chat open:',await c.eval(`!!document.querySelector('#chatInput')`));
    console.log('ws state:',await c.eval(`chatWS?chatWS.readyState:-1`));

    const u=Math.random().toString(36).slice(2,10);
    const status=await post({u:u,d:'node-device',n:'Node',t:'Живое сообщение',ts:Date.now()});
    console.log('post status',status);
    await sleep(4000);
    console.log('appeared:',await c.eval(`chat.msgs.some(m=>m.u===${JSON.stringify(u)})`));

    console.log('edit status',await post({op:'edit',u:u,t:'Изменённое сообщение',ts:Date.now()}));
    await sleep(3500);
    console.log('edited text:',await c.eval(`(chat.msgs.find(m=>m.u===${JSON.stringify(u)})||{}).t`));

    console.log('del status',await post({op:'del',u:u,ts:Date.now()}));
    await sleep(3500);
    console.log('deleted:',await c.eval(`!chat.msgs.some(m=>m.u===${JSON.stringify(u)})`));

    // меню действий по своему сообщению
    await c.eval(`(()=>{const i=document.querySelector('#chatInput');i.value='своё сообщение';document.querySelector('#chatSend').click()})()`);
    await sleep(2500);
    await c.eval(`document.querySelector('#chatList .msg.me .b').click()`);
    await sleep(600);
    console.log('actions sheet:',await c.eval(`!!document.querySelector('#m_edit')&&!!document.querySelector('#m_del')`));
    console.log('close btn in chat head:',await c.eval(`!!document.querySelector('#sheet [data-close]')`));
    await c.shot(path.join(OUT,'chat-actions.png'));
    await c.eval(`document.querySelector('#sheet [data-close]').click()`);
    await sleep(500);
    console.log('sheet closed:',await c.eval(`!document.querySelector('#sheet').classList.contains('open')`));

    const ownU=await c.eval(`(chat.msgs.filter(m=>m.d===DEV).pop()||{}).u`);
    if(ownU){
      await c.eval(`chatDelete(`+JSON.stringify(ownU)+`)`);
      await sleep(1800);
      console.log('own message deleted:',await c.eval(`!chat.msgs.some(m=>m.u===`+JSON.stringify(ownU)+`)`));
    }
  }finally{chrome.kill()}
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
