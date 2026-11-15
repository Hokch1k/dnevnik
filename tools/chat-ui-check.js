// Проверка нового интерфейса чата: предпросмотр перед отправкой, одно сообщение на фото,
// лайтбокс по клику, меню по правой кнопке и долгому нажатию, правка внутри сообщения,
// удаление, запрет выделения текста. Отправки перехватываются, реальный чат не трогаем.
// Запуск: node tools/chat-ui-check.js "<код класса>"
const {spawn}=require('child_process');
const fs=require('fs');
const path=require('path');
const os=require('os');

const CHROME=process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_BASE=process.env.URL_BASE||'http://127.0.0.1:8123/index.html';
const CODE=process.argv[2]||'';
const OUT=path.join(os.tmpdir(),'kilo');
const PORT=9346;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function httpJson(url){return new Promise((res,rej)=>{require('http').get(url,r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(e)}})}).on('error',rej)})}
class Client{
  constructor(u){this.ws=new WebSocket(u);this.id=0;this.pending=new Map();
    this.ws.onmessage=ev=>{const m=JSON.parse(ev.data);
      if(m.id&&this.pending.has(m.id)){const{resolve,reject}=this.pending.get(m.id);this.pending.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result);}
      else if(m.method==='Runtime.exceptionThrown'){console.log('PAGE EXC',String((m.params.exceptionDetails.exception||{}).description||m.params.exceptionDetails.text).slice(0,300));}};}
  open(){return new Promise((r,j)=>{this.ws.onopen=r;this.ws.onerror=j})}
  send(method,params){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{resolve:res,reject:rej});this.ws.send(JSON.stringify({id,method,params:params||{}}))})}
  async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text+' '+(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||''));return r.result.value}
  async shot(f){const r=await this.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(f,Buffer.from(r.data,'base64'))}
}

(async()=>{
  if(!CODE){console.error('нужен код класса');process.exit(2)}
  fs.mkdirSync(OUT,{recursive:true});
  const profile=path.join(OUT,'ui-profile-'+Date.now());
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
      await c.eval(`(()=>{document.querySelector('#n_nick').value='Тест';document.querySelector('#n_go').click()})()`);
      await sleep(1200);
    }
    console.log('chat ready:',await c.eval(`!!chat.key`));

    // тестовая тема + перехват отправок
    await c.eval(`(()=>{wsStop();chat.topic='dnevnikUiTest'+Math.random().toString(36).slice(2,8);chat.msgs=[];chatSave();renderChatMessages();window.__sent=[];window.__puts=[];const o=window.fetch;window.fetch=function(u,opt){const url=String(u);if(opt&&opt.method==='POST'&&url.indexOf('ntfy.sh')>=0){window.__sent.push(opt.body);return Promise.resolve(new Response('{"id":"x"}',{status:200}))}if(opt&&opt.method==='PUT'&&url.indexOf('ntfy.sh')>=0){const nm=(opt.headers&&opt.headers.Filename)||'f';const sz=(opt.body&&opt.body.size)||1;window.__puts.push(nm);return Promise.resolve(new Response(JSON.stringify({attachment:{url:'https://ntfy.sh/file/ui.jpg',name:nm,type:'image/jpeg',size:sz}}),{status:200,headers:{'Content-Type':'application/json'}}))}return o.apply(this,arguments)}})()`);

    console.log('selection disabled:',await c.eval(`getComputedStyle(document.body).userSelect==='none'`));

    // выбор файла -> предпросмотр, отправки нет
    await c.eval(`(async()=>{
      const cv=document.createElement('canvas');cv.width=80;cv.height=60;cv.getContext('2d').fillRect(0,0,80,60);
      const blob=await new Promise(r=>cv.toBlob(r,'image/png'));
      const dt=new DataTransfer();dt.items.add(new File([blob],'ui.png',{type:'image/png'}));
      const inp=document.querySelector('#chatFile');inp.files=dt.files;inp.dispatchEvent(new Event('change'));
    })()`);
    await sleep(500);
    console.log('preview shown:',await c.eval(`document.querySelector('#attachPreview').style.display!=='none'`));
    console.log('no send before confirm:',await c.eval(`window.__puts.length===0`));

    await c.eval(`document.querySelector('#ap_send').click()`);
    await sleep(1200);
    console.log('sent after confirm:',await c.eval(`window.__puts.length===1`));

    // Ctrl+V на компьютере: тоже сначала предпросмотр
    await c.eval(`(async()=>{
      const cv=document.createElement('canvas');cv.width=40;cv.height=30;cv.getContext('2d').fillRect(0,0,40,30);
      const blob=await new Promise(r=>cv.toBlob(r,'image/png'));
      const dt=new DataTransfer();dt.items.add(new File([blob],'paste.png',{type:'image/png'}));
      const inp=document.querySelector('#chatInput');inp.focus();
      inp.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
    })()`);
    await sleep(400);
    console.log('paste preview:',await c.eval(`document.querySelector('#attachPreview').style.display!=='none'`));
    console.log('paste not sent yet:',await c.eval(`window.__puts.length===1`));
    await c.eval(`document.querySelector('#ap_cancel').click()`);
    await sleep(200);

    // Enter отправляет выбранное фото (компьютер)
    await c.eval(`(async()=>{
      const cv=document.createElement('canvas');cv.width=40;cv.height=30;cv.getContext('2d').fillRect(0,0,40,30);
      const blob=await new Promise(r=>cv.toBlob(r,'image/png'));
      const dt=new DataTransfer();dt.items.add(new File([blob],'enter.png',{type:'image/png'}));
      const inp=document.querySelector('#chatFile');inp.files=dt.files;inp.dispatchEvent(new Event('change'));
    })()`);
    await sleep(400);
    await c.eval(`document.querySelector('#chatInput').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`);
    await sleep(1000);
    console.log('enter sends photo:',await c.eval(`window.__puts.length===2`));

    // «кто печатает» и «кто в сети»
    await c.eval(`(async()=>{
      chat.typing={};
      const p=await chatEnc({op:'typing',d:'other-device',n:'Аня',ts:Date.now()});
      await ingestEvents([{id:'t1',event:'message',message:p}]);
    })()`);
    await sleep(300);
    console.log('typing shown:',await c.eval(`document.querySelector('#chatPresence').textContent.includes('Аня')`));
    console.log('typing again shown:',await c.eval(`/печатает/.test(document.querySelector('#chatPresence').textContent)`));
    await c.eval(`(()=>{chat.typing={};chat.pres['dev-x']={n:'Петя',ts:Date.now()};paintPresence()})()`);
    await sleep(200);
    console.log('online list:',await c.eval(`document.querySelector('#chatPresence').textContent`));

    // свайп по списку не меняет день
    await c.eval(`(go('2026-11-16'),window.__selBefore=S.sel)`);
    const swipe=await c.eval(`(()=>{const L=document.querySelector('#list');try{L.dispatchEvent(new Event('touchstart',{bubbles:true}));L.dispatchEvent(new Event('touchend',{bubbles:true}))}catch(e){}return S.sel})()`);
    console.log('swipe keeps day:',swipe===await c.eval(`window.__selBefore`));

    // эхо своего сообщения с сервера не должно дублировать
    const beforeEcho=await c.eval(`chat.msgs.length`);
    await c.eval(`(async()=>{
      const m=chat.msgs[chat.msgs.length-1];
      const payload=await chatEnc({u:m.u,d:m.d,n:m.n,t:m.t,ts:m.ts});
      await ingestEvents([{id:'e1',event:'message',message:payload,attachment:{url:m.att.url,name:m.att.name,type:m.att.type,size:m.att.size}}]);
    })()`);
    await sleep(600);
    console.log('no duplicate after echo:',await c.eval(`chat.msgs.length===${beforeEcho}`));

    // клик по фото -> лайтбокс
    await c.eval(`document.querySelector('#chatList img.att').click()`);
    await sleep(400);
    console.log('lightbox opened:',await c.eval(`!document.querySelector('#lightbox').hidden`));
    await c.eval(`document.querySelector('#lightbox').click()`);
    await sleep(300);
    console.log('lightbox closed:',await c.eval(`document.querySelector('#lightbox').hidden`));

    // ПКМ -> меню -> изменить текст
    await c.eval(`(()=>{const el=document.querySelector('.msg');el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))})()`);
    await sleep(300);
    console.log('menu shown:',await c.eval(`!!document.querySelector('#msgMenu')`));
    await c.eval(`document.querySelector('#msgMenu [data-act="replace"]').click()`);
    await sleep(400);
    console.log('menu closed:',await c.eval(`!document.querySelector('#msgMenu')`));

    // текст: отправляем текстовое сообщение и правим внутри ленты
    await c.eval(`(()=>{document.querySelector('#chatInput').value='привет';document.querySelector('#chatSend').click()})()`);
    await sleep(500);
    const u=await c.eval(`chat.msgs[chat.msgs.length-1].u`);
    await c.eval(`(()=>{const el=[...document.querySelectorAll('.msg')].pop();el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))})()`);
    await sleep(300);
    await c.eval(`document.querySelector('#msgMenu [data-act="edit"]').click()`);
    await sleep(400);
    console.log('inline editor:',await c.eval(`!!document.querySelector('#msgEdit')`));
    await c.eval(`(()=>{document.querySelector('#msgEdit').value='привет, изменено';document.querySelector('#me_save').click()})()`);
    await sleep(600);
    console.log('edited in place:',await c.eval(`chat.msgs.find(x=>x.u===${JSON.stringify(u)}).t==='привет, изменено'`));
    console.log('edit op sent:',await c.eval(`window.__sent.some(b=>b&&b.length>20)&&window.__sent.length>=2`));

    // долгое нажатие -> меню, удаление
    await c.eval(`(async()=>{const el=[...document.querySelectorAll('.msg')].pop();el.dispatchEvent(new Event('touchstart',{bubbles:true}));await new Promise(r=>setTimeout(r,650));})()`);
    await sleep(300);
    console.log('long-press menu:',await c.eval(`!!document.querySelector('#msgMenu')`));
    await c.eval(`document.querySelector('#msgMenu [data-act="del"]').click()`);
    await sleep(600);
    console.log('deleted:',await c.eval(`!chat.msgs.some(x=>x.u===${JSON.stringify(u)})`));
    await c.shot(path.join(OUT,'chat-ui.png'));
  }finally{chrome.kill()}
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
