// Проверка списка пользователей: присутствие приходит по WebSocket.
const {spawn}=require('child_process');
const fs=require('fs');
const path=require('path');
const os=require('os');
const CHROME=process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_BASE=process.env.URL_BASE||'http://127.0.0.1:8123/index.html';
const CODE=process.argv[2]||'';
const PORT=9337;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function httpJson(u){return new Promise((res,rej)=>{require('http').get(u,r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(e)}})}).on('error',rej)})}
class C{constructor(u){this.ws=new WebSocket(u);this.id=0;this.p=new Map();this.ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const{resolve,reject}=this.p.get(m.id);this.p.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result);}}}
  open(){return new Promise((r,j)=>{this.ws.onopen=r;this.ws.onerror=j})}
  send(m,p){const id=++this.id;return new Promise((res,rej)=>{this.p.set(id,{resolve:res,reject:rej});this.ws.send(JSON.stringify({id,method:m,params:p||{}}))})}
  async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value}}
(async()=>{
  const profile=path.join(os.tmpdir(),'kilo','pres-profile-'+Date.now());
  const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--remote-debugging-port='+PORT,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
  try{
    let v=null;for(let i=0;i<40&&!v;i++){try{v=await httpJson('http://127.0.0.1:'+PORT+'/json/version')}catch(e){await sleep(250)}}
    const page=(await httpJson('http://127.0.0.1:'+PORT+'/json/list')).find(t=>t.type==='page');
    const c=new C(page.webSocketDebuggerUrl);await c.open();
    await c.send('Page.enable');await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
    await c.send('Page.navigate',{url:URL_BASE});await sleep(2600);
    await c.eval(`document.querySelector('#chatBtn').click()`);await sleep(400);
    await c.eval(`(()=>{document.querySelector('#u_code').value=${JSON.stringify(CODE)};document.querySelector('#u_go').click()})()`);await sleep(2400);
    if(await c.eval(`!!document.querySelector('#n_nick')`)){await c.eval(`(()=>{document.querySelector('#n_nick').value='Проверка';document.querySelector('#n_go').click()})()`);await sleep(1500)}
    console.log('chatWS state:',await c.eval(`chatWS?chatWS.readyState:-1`));
    await c.eval(`chatPing(true)`);await sleep(2500);
    console.log('pres entries:',await c.eval(`Object.keys(chat.pres).length`));
    await c.eval(`usersSheet()`);await sleep(2500);
    console.log('users text:',await c.eval(`document.querySelector('#usersBox').textContent.replace(/\\s+/g,' ').trim().slice(0,200)`));
    const shot=await c.send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(os.tmpdir(),'kilo','users.png'),Buffer.from(shot.data,'base64'));
  }finally{chrome.kill()}
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
