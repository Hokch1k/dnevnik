// Проверка админки, правок расписания, шаблона недели и модерации чата.
// Публикация перехватывается (fetch подменяется), сервер не получает тестовые данные.
// Запуск: node tools/admin-check.js "<код класса>" "<код админа>"
const {spawn}=require('child_process');
const fs=require('fs');
const path=require('path');
const os=require('os');
const crypto=require('crypto');

const CHROME=process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_BASE=process.env.URL_BASE||'http://127.0.0.1:8123/index.html';
const CODE=process.argv[2]||'';
const ACODE=process.argv[3]||'';
const OUT=path.join(os.tmpdir(),'kilo');
const PORT=9335;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const SCHED_KEY=Buffer.from('YD5ijw9LbAdrCqqz3XTj3ox9I6Sp6tmfewNK0+s/YNg=','base64');

function httpJson(url){return new Promise((res,rej)=>{require('http').get(url,r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(e)}})}).on('error',rej)})}
class Client{
  constructor(u){this.ws=new WebSocket(u);this.id=0;this.pending=new Map();
    this.ws.onmessage=ev=>{const m=JSON.parse(ev.data);
      if(m.id&&this.pending.has(m.id)){const{resolve,reject}=this.pending.get(m.id);this.pending.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result);}
      else if(m.method==='Runtime.consoleAPICalled'){const a=(m.params.args||[]).map(x=>x.value||x.description||'').join(' ');if(m.params.type!=='log')console.log('PAGE',m.params.type,a.slice(0,200));}
      else if(m.method==='Runtime.exceptionThrown'){console.log('PAGE EXC',String((m.params.exceptionDetails.exception||{}).description||m.params.exceptionDetails.text).slice(0,300));}};}
  open(){return new Promise((r,j)=>{this.ws.onopen=r;this.ws.onerror=j})}
  send(method,params){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{resolve:res,reject:rej});this.ws.send(JSON.stringify({id,method,params:params||{}}))})}
  async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value}
  async shot(f){const r=await this.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(f,Buffer.from(r.data,'base64'))}
}
function decSched(str){
  const[ivS,ctS]=str.split('.');
  const d=crypto.createDecipheriv('aes-256-gcm',SCHED_KEY,Buffer.from(ivS,'base64'));
  const raw=Buffer.from(ctS,'base64');
  d.setAuthTag(raw.subarray(-16));
  return JSON.parse(Buffer.concat([d.update(raw.subarray(0,-16)),d.final()]).toString('utf8'));
}

(async()=>{
  if(!CODE||!ACODE){console.error('нужны код класса и код админа');process.exit(2)}
  fs.mkdirSync(OUT,{recursive:true});
  const profile=path.join(OUT,'admin-profile-'+Date.now());
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

    // перехват публикаций в расписание
    await c.eval(`(()=>{window.__posts=[];const o=window.fetch;window.fetch=function(u,opt){const url=String(u);if(url.indexOf('dnevnikSched')>=0&&opt&&opt.method==='POST'){window.__posts.push(opt.body);return Promise.resolve(new Response('{"id":"x"}',{status:200}))}return o.apply(this,arguments)}})()`);

    // шаблон недели: 23 и 24 ноября
    const tmpl=JSON.parse(await c.eval(`(()=>{go('2026-11-23');const a=document.querySelectorAll('.card').length;const t1=document.querySelector('#ttl').textContent;go('2026-11-24');const b=document.querySelectorAll('.card').length;const t2=document.querySelector('#ttl').textContent;go('2026-11-21');const weekend=document.querySelector('#list').textContent.trim().slice(0,30);return JSON.stringify({mon:a,monTitle:t1,tue:b,tueTitle:t2,weekend:weekend})})()`));
    console.log('TEMPLATE',JSON.stringify(tmpl));

    // админка: неверный код
    await c.eval(`adminEntry()`);
    await sleep(300);
    console.log('admin login shown:',await c.eval(`!!document.querySelector('#a_code')`));
    await c.eval(`(()=>{document.querySelector('#a_code').value='nope';document.querySelector('#a_go').click()})()`);
    await sleep(800);
    console.log('wrong admin code rejected:',await c.eval(`!!document.querySelector('#a_code')`));

    await c.eval(`(()=>{document.querySelector('#a_code').value=${JSON.stringify(ACODE)};document.querySelector('#a_go').click()})()`);
    await sleep(1000);
    console.log('admin panel:',await c.eval(`!!document.querySelector('#a_days')`));
    await c.eval(`document.querySelector('#a_days').click()`);
    await sleep(500);
    const days=JSON.parse(await c.eval(`(()=>{const b=[...document.querySelectorAll('[data-date]')];return JSON.stringify({count:b.length,labels:b.slice(0,3).map(x=>x.textContent.trim().slice(0,40))})})()`));
    console.log('DAYS',JSON.stringify(days));
    await c.shot(path.join(OUT,'admin-days.png'));

    // правим 1 декабря
    await c.eval(`adminDaySheet('2026-12-01')`);
    await sleep(500);
    const hwInputs=await c.eval(`document.querySelectorAll('#lrows [data-f="hw"]').length`);
    console.log('editor hw inputs:',hwInputs);
    await c.eval(`(()=>{const i=document.querySelectorAll('#lrows [data-f="hw"]');i[0].value='ТЕСТ-АДМИН правка';document.querySelector('#d_save').click()})()`);
    await sleep(900);
    const after=JSON.parse(await c.eval(`(()=>{go('2026-12-01');const cards=[...document.querySelectorAll('.card')];return JSON.stringify({cards:cards.length,firstHw:(cards[0]||{}).textContent,title:document.querySelector('#ttl').textContent})})()`));
    console.log('AFTER EDIT',JSON.stringify({cards:after.cards,firstHw:after.firstHw.slice(0,80),title:after.title}));
    const rawPosts=JSON.parse(await c.eval(`JSON.stringify(window.__posts)`));
    console.log('captured posts:',rawPosts.length);
    if(rawPosts.length){
      const plain=decSched(rawPosts[rawPosts.length-1]);
      console.log('SCHED PAYLOAD day:',plain.days[0].date,'hw0:',plain.days[0].lessons[0]&&plain.days[0].lessons[0].hw);
      console.log('SCHED plaintext leak on wire:',String(rawPosts[rawPosts.length-1]).indexOf('ТЕСТ')>=0);
    }

    // пользователи
    await c.eval(`(()=>{document.querySelector('#chatBtn').click()})()`);
    await sleep(400);
    if(await c.eval(`!!document.querySelector('#u_code')`)){
      await c.eval(`(()=>{document.querySelector('#u_code').value=${JSON.stringify(CODE)};document.querySelector('#u_go').click()})()`);
      await sleep(2200);
      if(await c.eval(`!!document.querySelector('#n_nick')`)){
        await c.eval(`(()=>{document.querySelector('#n_nick').value='Админ';document.querySelector('#n_go').click()})()`);
        await sleep(1200);
      }
    }
    await c.eval(`usersSheet()`);
    await sleep(1200);
    const users=await c.eval(`document.querySelector('#usersBox').textContent.replace(/\\s+/g,' ').trim().slice(0,160)`);
    console.log('USERS:',users);
    await c.shot(path.join(OUT,'admin-users.png'));
  }finally{chrome.kill()}
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
