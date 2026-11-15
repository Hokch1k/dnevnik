// Проверка фото/видео в чате: изображение сжимается, уходит вложением в ntfy (PUT),
// сообщение расшифровывается, а в ленте появляется картинка.
// Отправка идёт в отдельную тестовую тему, чтобы не мусорить в чате класса.
// Запуск: node tools/attach-check.js "<код класса>"
const {spawn}=require('child_process');
const fs=require('fs');
const path=require('path');
const os=require('os');
const crypto=require('crypto');

const CHROME=process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_BASE=process.env.URL_BASE||'http://127.0.0.1:8123/index.html';
const CODE=process.argv[2]||'';
const OUT=path.join(os.tmpdir(),'kilo');
const PORT=9341;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const CHAT_SALT=Buffer.from('1Dl+G/fnUz7kNueMLfIvfg==','base64');

function httpJson(url){return new Promise((res,rej)=>{require('http').get(url,r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(e)}})}).on('error',rej)})}
class Client{
  constructor(u){this.ws=new WebSocket(u);this.id=0;this.pending=new Map();
    this.ws.onmessage=ev=>{const m=JSON.parse(ev.data);
      if(m.id&&this.pending.has(m.id)){const{resolve,reject}=this.pending.get(m.id);this.pending.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result);}
      else if(m.method==='Runtime.exceptionThrown'){console.log('PAGE EXC',String((m.params.exceptionDetails.exception||{}).description||m.params.exceptionDetails.text).slice(0,300));}};}
  open(){return new Promise((r,j)=>{this.ws.onopen=r;this.ws.onerror=j})}
  send(method,params){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{resolve:res,reject:rej});this.ws.send(JSON.stringify({id,method,params:params||{}}))})}
  async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value}
  async shot(f){const r=await this.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(f,Buffer.from(r.data,'base64'))}
}
function decChat(str){
  const key=crypto.pbkdf2Sync(CODE,CHAT_SALT,120000,32,'sha256');
  const[ivS,ctS]=str.split('.');
  const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(ivS,'base64'));
  const raw=Buffer.from(ctS,'base64');
  d.setAuthTag(raw.subarray(-16));
  return JSON.parse(Buffer.concat([d.update(raw.subarray(0,-16)),d.final()]).toString('utf8'));
}

(async()=>{
  if(!CODE){console.error('нужен код класса');process.exit(2)}
  fs.mkdirSync(OUT,{recursive:true});
  const profile=path.join(OUT,'attach-profile-'+Date.now());
  const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
  try{
    let v=null;for(let i=0;i<40&&!v;i++){try{v=await httpJson('http://127.0.0.1:'+PORT+'/json/version')}catch(e){await sleep(250)}}
    if(!v)throw new Error('chrome не запустился');
    const page=(await httpJson('http://127.0.0.1:'+PORT+'/json/list')).find(t=>t.type==='page');
    const c=new Client(page.webSocketDebuggerUrl);await c.open();
    await c.send('Page.enable');await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
    await c.send('Page.navigate',{url:URL_BASE});
    await sleep(2400);

    await c.eval(`openChat()`);
    await sleep(400);
    if(await c.eval(`!!document.querySelector('#u_code')`)){
      await c.eval(`(()=>{document.querySelector('#u_code').value=${JSON.stringify(CODE)};document.querySelector('#u_go').click()})()`);
      await sleep(2200);
    }
    if(await c.eval(`!!document.querySelector('#n_nick')`)){
      await c.eval(`(()=>{document.querySelector('#n_nick').value='Фотограф';document.querySelector('#n_go').click()})()`);
      await sleep(1200);
    }
    console.log('chat ready:',await c.eval(`!!chat.key`));
    console.log('attach button:',await c.eval(`!!document.querySelector('#chatAttach')`));

    const topic='dnevnikAttachTest'+Math.random().toString(36).slice(2,10);
    const res=JSON.parse(await c.eval(`(async()=>{
      wsStop();
      chat.topic=${JSON.stringify(topic)};
      const cv=document.createElement('canvas');cv.width=240;cv.height=160;
      const g=cv.getContext('2d');g.fillStyle='#2f6fed';g.fillRect(0,0,240,160);g.fillStyle='#fff';g.font='28px sans-serif';g.fillText('ТЕСТ',70,90);
      const blob=await new Promise(r=>cv.toBlob(r,'image/png'));
      const file=new File([blob],'тест картинка.png',{type:'image/png'});
      await chatSendFiles([file]);
      const m=chat.msgs[chat.msgs.length-1];
      return JSON.stringify({att:m&&m.att?m.att:null,img:!!document.querySelector('#chatList img.att'),topic:chat.topic});
    })()`));
    console.log('UPLOAD',JSON.stringify({name:res.att&&res.att.name,type:res.att&&res.att.type,size:res.att&&res.att.size,img:res.img}));

    await sleep(1500);
    const evUrl='https://ntfy.sh/'+encodeURIComponent(topic)+'/json?poll=1&since=10m';
    const r=await fetch(evUrl);
    const lines=(await r.text()).split('\n').filter(Boolean);
    const evs=lines.map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(x=>x&&x.event==='message');
    console.log('events on server:',evs.length);
    if(evs.length){
      const ev=evs[evs.length-1];
      const m=decChat(ev.message);
      console.log('decrypted message ok:',!!m.u);
      console.log('attachment on server:',!!ev.attachment,'type:',ev.attachment&&ev.attachment.type,'size:',ev.attachment&&ev.attachment.size);
      console.log('file reachable:',ev.attachment?((await fetch(ev.attachment.url)).ok):false);

      // приём «как с сервера»: чистим ленту и прогоняем событие через ingestEvents
      const inbound=JSON.parse(await c.eval(`(async()=>{
        chat.msgs=chat.msgs.filter(x=>!x.att);chatSave();renderChatMessages();
        await ingestEvents([${JSON.stringify(ev)}]);
        return JSON.stringify({imgs:document.querySelectorAll('#chatList img.att').length,src:(document.querySelector('#chatList img.att')||{}).getAttribute?document.querySelector('#chatList img.att').getAttribute('src'):null});
      })()`));
      console.log('INBOUND IMAGE',JSON.stringify({imgs:inbound.imgs,src:String(inbound.src||'').slice(-24)}));
    }
    await c.shot(path.join(OUT,'attach-chat.png'));
  }finally{chrome.kill()}
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
