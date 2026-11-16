// Проверка новых функций чата: ответы, анти-спам, мут/бан, экран бана, код с копированием,
// ИИ-сообщения (ожидание и ответ), анонимность. Отправки перехватываются.
// Запуск: node tools/features-check.js "<код класса>"
const {spawn}=require('child_process');
const fs=require('fs');
const path=require('path');
const os=require('os');

const CHROME=process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_BASE=process.env.URL_BASE||'http://127.0.0.1:8123/index.html';
const CODE=process.argv[2]||'';
const OUT=path.join(os.tmpdir(),'kilo');
const PORT=9355;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function httpJson(u){return new Promise((res,rej)=>{require('http').get(u,r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(e)}})}).on('error',rej)})}
class Client{
  constructor(u){this.ws=new WebSocket(u);this.id=0;this.pending=new Map();
    this.ws.onmessage=ev=>{const m=JSON.parse(ev.data);
      if(m.id&&this.pending.has(m.id)){const{resolve,reject}=this.pending.get(m.id);this.pending.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result);}
      else if(m.method==='Runtime.exceptionThrown'){console.log('EXC',String((m.params.exceptionDetails.exception||{}).description||'').slice(0,200));}};}
  open(){return new Promise((r,j)=>{this.ws.onopen=r;this.ws.onerror=j})}
  send(method,params){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{resolve:res,reject:rej});this.ws.send(JSON.stringify({id,method,params:params||{}}))})}
  async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text+' '+(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||''));return r.result.value}
}

(async()=>{
  if(!CODE){console.error('нужен код класса');process.exit(2)}
  fs.mkdirSync(OUT,{recursive:true});
  const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+path.join(OUT,'feat-'+Date.now()),'about:blank'],{stdio:'ignore'});
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
      await c.eval(`(()=>{document.querySelector('#n_nick').value='Тест';document.querySelector('#n_go').click()})()`);await sleep(1200);
    }
    await c.eval(`(()=>{wsStop();chat.topic='dnevnikFeat'+Math.random().toString(36).slice(2,8);chat.msgs=[];chatSave();renderChatMessages();window.__sent=[];const o=window.fetch;window.fetch=function(u,opt){if(opt&&opt.method==='POST'&&String(u).indexOf('ntfy.sh')>=0){window.__sent.push(opt.body);return Promise.resolve(new Response('{"id":"x"}',{status:200}))}return o.apply(this,arguments)}})()`);

    // ответ на сообщение
    await c.eval(`(()=>{document.querySelector('#chatInput').value='первое';document.querySelector('#chatSend').click()})()`);
    await sleep(300);
    await c.eval(`(()=>{const el=document.querySelector('.msg');el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))})()`);
    await sleep(200);
    await c.eval(`document.querySelector('#msgMenu [data-act="reply"]').click()`);
    await sleep(200);
    console.log('reply bar:',await c.eval(`document.querySelector('#replyBar').style.display!=='none'`));
    await c.eval(`(()=>{document.querySelector('#chatInput').value='ответ';document.querySelector('#chatSend').click()})()`);
    await sleep(400);
    console.log('quote rendered:',await c.eval(`document.querySelectorAll('.quote').length>0`));

    // анти-спам
    const spam=await c.eval(`(async()=>{let ok=0;for(let i=0;i<9;i++){document.querySelector('#chatInput').value='спам'+i;document.querySelector('#chatSend').click();await new Promise(r=>setTimeout(r,60))}return chat.msgs.filter(m=>m.t&&m.t.indexOf('спам')===0).length})()`);
    console.log('antispam capped:',spam<=6,spam);

    // код с копированием
    await c.eval("(()=>{chat.msgs.push({u:'code1',d:'ai',n:'Gemini',t:'Пример:\\n```python\\nprint(1)\\n```',ts:Date.now()});renderChatMessages(true)})()");
    await sleep(200);
    console.log('code block:',await c.eval(`!!document.querySelector('.code pre code')`));
    console.log('copy button:',await c.eval(`!!document.querySelector('[data-copy]')`));

    // ИИ: запрос и ответ
    await c.eval(`(()=>{sendTimes=[];chat.aiCool=0;document.querySelector('#chatInput').value='ai 2+2';document.querySelector('#chatSend').click()})()`);
    await sleep(400);
    const aiId=await c.eval(`(chat.msgs.find(m=>m.d==='ai'&&m.pending)||{}).u||''`);
    console.log('ai pending:',!!aiId);
    if(aiId){
      await c.eval(`(()=>{const m={u:${JSON.stringify(aiId)},d:'ai',n:'Gemini',t:'4',model:'gemini-2.5-flash-lite',ts:Date.now()};applyChatObject(m).then(()=>{chatSave();renderChatMessages(true)})})()`);
      await sleep(300);
      console.log('ai answered:',await c.eval(`(chat.msgs.find(x=>x.u===${JSON.stringify(aiId)})||{}).t`));
    }

    // мут и бан
    await c.eval(`(()=>{applyChatObject({op:'mute',d:DEV,on:true,by:'админ',ts:Date.now()});chatSave()})()`);
    await sleep(200);
    const before=await c.eval(`chat.msgs.length`);
    await c.eval(`(()=>{document.querySelector('#chatInput').value='после мута';document.querySelector('#chatSend').click()})()`);
    await sleep(300);
    console.log('mute blocks:',await c.eval(`chat.msgs.length===${before}`));
    await c.eval(`(()=>{applyChatObject({op:'mute',d:DEV,on:false,by:'админ',ts:Date.now()});applyChatObject({op:'ban',d:DEV,on:true,by:'Ваня',reason:'спам в чате',ts:Date.now()});chatSave()})()`);
    await sleep(300);
    console.log('ban screen:',await c.eval(`document.querySelector('#banScreen').style.display==='flex'`));
    console.log('ban reason on screen:',await c.eval(`document.querySelector('#banWhy').textContent`));
    await c.eval(`(()=>{applyChatObject({op:'ban',d:DEV,on:false,ts:Date.now()});chatSave()})()`);
    await sleep(200);
    console.log('unban hides screen:',await c.eval(`document.querySelector('#banScreen').style.display==='none'`));

    // анонимность
    await c.eval(`(()=>{sendTimes=[];chat.anon=true;document.querySelector('#chatInput').value='тайна';document.querySelector('#chatSend').click()})()`);
    await sleep(300);
    console.log('anon message:',await c.eval(`(()=>{const m=chat.msgs.filter(x=>x.t==='тайна').pop();if(!m)return false;const el=document.querySelector('[data-u="'+m.u+'"]');return !!(m.anon&&el&&el.classList.contains('anon'))})()`));
  }finally{chrome.kill()}
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
