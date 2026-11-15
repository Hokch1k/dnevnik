// Проверка админки: шаблон недели, инлайн-правка предмета/ДЗ, удаление и добавление урока,
// очистка чата и список пользователей. Публикации перехватываются (fetch подменяется),
// сервер не получает тестовые данные ни в расписание, ни в чат.
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
const CHAT_SALT=Buffer.from('1Dl+G/fnUz7kNueMLfIvfg==','base64');

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
function decChat(str){
  const key=crypto.pbkdf2Sync(CODE,CHAT_SALT,120000,32,'sha256');
  const[ivS,ctS]=str.split('.');
  const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(ivS,'base64'));
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

    // перехват всех POST в ntfy: расписание и чат
    await c.eval(`(()=>{window.__posts=[];window.__cposts=[];window.__puts=[];const o=window.fetch;window.fetch=function(u,opt){const url=String(u);if(opt&&opt.method==='POST'){if(url.indexOf('ntfy.sh')>=0){if(url.indexOf('dnevnikSched')>=0)window.__posts.push(opt.body);else window.__cposts.push({url:url,body:opt.body});return Promise.resolve(new Response('{"id":"x"}',{status:200}))}}if(opt&&opt.method==='PUT'&&url.indexOf('ntfy.sh')>=0){const nm=(opt.headers&&opt.headers.Filename)||'file';const sz=(opt.body&&opt.body.size)||1;window.__puts.push({name:nm,size:sz});return Promise.resolve(new Response(JSON.stringify({id:'p1',event:'message',attachment:{url:'https://ntfy.sh/file/test.jpg',name:nm,type:'image/jpeg',size:sz}}),{status:200,headers:{'Content-Type':'application/json'}}))}return o.apply(this,arguments)}})()`);

    // шаблон недели: 23 и 24 ноября
    const tmpl=JSON.parse(await c.eval(`(()=>{go('2026-11-23');const a=document.querySelectorAll('.card').length;const t1=document.querySelector('#ttl').textContent;go('2026-11-24');const b=document.querySelectorAll('.card').length;const t2=document.querySelector('#ttl').textContent;go('2026-11-21');const weekend=document.querySelector('#list').textContent.trim().slice(0,30);return JSON.stringify({mon:a,monTitle:t1,tue:b,tueTitle:t2,weekend:weekend})})()`));
    console.log('TEMPLATE',JSON.stringify(tmpl));
    console.log('template days have no hw:',await c.eval(`(go('2026-11-23'),document.querySelectorAll('.hw:not(.no)').length===0)`));

    // до входа карандашей нет
    console.log('no pencils before login:',await c.eval(`document.querySelectorAll('[data-aedit]').length===0`));

    // админка: неверный код
    await c.eval(`adminEntry()`);
    await sleep(300);
    console.log('admin login shown:',await c.eval(`!!document.querySelector('#a_code')`));
    await c.eval(`(()=>{document.querySelector('#a_code').value='nope';document.querySelector('#a_go').click()})()`);
    await sleep(800);
    console.log('wrong admin code rejected:',await c.eval(`!!document.querySelector('#a_code')`));

    await c.eval(`(()=>{document.querySelector('#a_code').value=${JSON.stringify(ACODE)};document.querySelector('#a_go').click()})()`);
    await sleep(1000);
    const panel=JSON.parse(await c.eval(`(()=>JSON.stringify({users:!!document.querySelector('#a_users'),clear:!!document.querySelector('#a_clear'),days:!!document.querySelector('#a_days')}))()`));
    console.log('ADMIN PANEL',JSON.stringify(panel));
    await c.shot(path.join(OUT,'admin-panel.png'));
    await c.eval(`closeSheet()`);
    await sleep(400);

    // правка ДЗ на 23 ноября (шаблонный день)
    await c.eval(`go('2026-11-23')`);
    await sleep(400);
    const pencils=JSON.parse(await c.eval(`(()=>JSON.stringify({edit:document.querySelectorAll('[data-aedit]').length,hw:document.querySelectorAll('[data-ahw]').length,del:document.querySelectorAll('[data-adel]').length,add:document.querySelectorAll('[data-aadd]').length}))()`));
    console.log('ADMIN CONTROLS',JSON.stringify(pencils));
    await c.shot(path.join(OUT,'admin-inline.png'));
    await c.eval(`document.querySelector('[data-ahw="0"]').click()`);
    await sleep(400);
    const hwSheet=await c.eval(`!!document.querySelector('#h_txt')`);
    console.log('hw sheet:',hwSheet);
    await c.eval(`(()=>{document.querySelector('#h_txt').value='ТЕСТ-АДМИН правка';document.querySelector('#h_save').click()})()`);
    await sleep(700);
    const after=JSON.parse(await c.eval(`(()=>{const cards=[...document.querySelectorAll('.card')];return JSON.stringify({cards:cards.length,firstHw:(cards[0]||{}).textContent,hwText:(document.querySelector('.hw')||{}).textContent})})()`));
    console.log('AFTER HW EDIT',JSON.stringify({cards:after.cards,hwText:String(after.hwText||'').slice(0,60)}));
    const rawPosts=JSON.parse(await c.eval(`JSON.stringify(window.__posts)`));
    console.log('captured sched posts:',rawPosts.length);
    if(rawPosts.length){
      const plain=decSched(rawPosts[rawPosts.length-1]);
      console.log('SCHED PAYLOAD day:',plain.days[0].date,'hw0:',plain.days[0].lessons[0]&&plain.days[0].lessons[0].hw);
      console.log('SCHED plaintext leak on wire:',String(rawPosts[rawPosts.length-1]).indexOf('ТЕСТ')>=0);
    }

    // удаление урока
    const beforeDel=await c.eval(`document.querySelectorAll('.card').length`);
    await c.eval(`document.querySelectorAll('[data-adel]')[document.querySelectorAll('[data-adel]').length-1].click()`);
    await sleep(700);
    const afterDel=await c.eval(`document.querySelectorAll('.card').length`);
    console.log('DELETE LESSON',beforeDel+' -> '+afterDel);

    // добавление урока на выбранное место (2-й) и проверка, что это попало в шаблон недели
    await c.eval(`document.querySelector('[data-aadd]').click()`);
    await sleep(400);
    await c.eval(`(()=>{document.querySelector('#l_pos').value='2';document.querySelector('#l_sub').value='Тест-предмет';document.querySelector('#l_time').value='15:00-15:40';document.querySelector('#l_save').click()})()`);
    await sleep(700);
    const addRes=JSON.parse(await c.eval(`(()=>{const cards=[...document.querySelectorAll('.card')];return JSON.stringify({count:cards.length,second:(cards[1]||{}).textContent.slice(0,60),last:(cards[cards.length-1]||{}).textContent.slice(0,40)})})()`));
    console.log('ADD LESSON',JSON.stringify(addRes));
    const tplRes=JSON.parse(await c.eval(`(()=>{go('2026-11-30');const t2=[...document.querySelectorAll('.card')][1];const n=document.querySelectorAll('.card').length;go('2026-11-24');const b=document.querySelectorAll('.card').length;return JSON.stringify({nextMonday:n,second:(t2||{}).textContent.slice(0,40),tuesday:b})})()`));
    console.log('TEMPLATE AFTER ADD',JSON.stringify(tplRes));

    // ГДЗ: текст
    await c.eval(`(go('2026-11-23'),document.querySelectorAll('[data-agdz]')[0].click())`);
    await sleep(350);
    console.log('gdz sheet:',await c.eval(`!!document.querySelector('#g_text')`));
    await c.eval(`(()=>{document.querySelector('#g_text').value='№ 385 — 12,5';document.querySelector('#g_save').click()})()`);
    await sleep(700);
    console.log('GDZ TEXT ON CARD:',await c.eval(`(document.querySelector('.gdz')||{}).textContent||''`));

    // ГДЗ: картинка
    await c.eval(`document.querySelectorAll('[data-agdz]')[0].click()`);
    await sleep(350);
    const putRes=await c.eval(`(async()=>{const cv=document.createElement('canvas');cv.width=120;cv.height=80;cv.getContext('2d').fillRect(0,0,120,80);const blob=await new Promise(r=>cv.toBlob(r,'image/png'));const dt=new DataTransfer();dt.items.add(new File([blob],'gdz.png',{type:'image/png'}));const inp=document.querySelector('#g_file');inp.files=dt.files;inp.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,500));return document.querySelector('#g_status').textContent})()`);
    console.log('GDZ UPLOAD STATUS:',putRes);
    await c.eval(`document.querySelector('#g_save').click()`);
    await sleep(700);
    const gdzRes=JSON.parse(await c.eval(`(()=>{const el=document.querySelector('.gdz');return JSON.stringify({text:(el||{}).textContent||'',img:!!document.querySelector('.gdzImg'),imgSrc:(document.querySelector('.gdzImg')||{}).src||''})})()`));
    console.log('GDZ ON CARD',JSON.stringify({img:gdzRes.img,src:String(gdzRes.imgSrc).slice(-18)}));
    const puts=JSON.parse(await c.eval(`JSON.stringify(window.__puts)`));
    console.log('PUT uploads:',puts.length,puts[0]?puts[0].name+' '+puts[0].size:'');
    const lastPost=JSON.parse(await c.eval(`JSON.stringify(window.__posts.slice(-1))`));
    if(lastPost.length){
      const plain=decSched(lastPost[0]);
      const g=plain.days[0].lessons[0]&&plain.days[0].lessons[0].gdz;
      console.log('GDZ PAYLOAD',JSON.stringify({text:g&&g.text,url:g&&g.url}));
    }

    // убрать картинку из ГДЗ (текст остаётся)
    await c.eval(`document.querySelectorAll('[data-agdz]')[0].click()`);
    await sleep(350);
    await c.eval(`document.querySelector('#g_unpick').click()`);
    await sleep(200);
    await c.eval(`document.querySelector('#g_save').click()`);
    await sleep(700);
    console.log('GDZ AFTER UNPICK',await c.eval(`JSON.stringify((()=>{const g=OV['2026-11-23'].lessons[0].gdz;return {text:g&&g.text,url:g&&g.url}})())`));

    // убрать ГДЗ целиком
    await c.eval(`document.querySelectorAll('[data-agdz]')[0].click()`);
    await sleep(350);
    await c.eval(`document.querySelector('#g_del').click()`);
    await sleep(700);
    console.log('GDZ REMOVED',await c.eval(`!document.querySelector('.gdz')`));

    // вход в чат по коду + ник
    await c.eval(`openChat()`);
    await sleep(400);
    if(await c.eval(`!!document.querySelector('#u_code')`)){
      await c.eval(`(()=>{document.querySelector('#u_code').value=${JSON.stringify(CODE)};document.querySelector('#u_go').click()})()`);
      await sleep(2200);
      if(await c.eval(`!!document.querySelector('#n_nick')`)){
        await c.eval(`(()=>{document.querySelector('#n_nick').value='Админ';document.querySelector('#n_go').click()})()`);
        await sleep(1200);
      }
    }
    console.log('chat ready:',await c.eval(`!!chat.key`));

    // очистка чата из админки
    await c.eval(`adminEntry()`);
    await sleep(400);
    await c.eval(`document.querySelector('#a_clear').click()`);
    await sleep(400);
    console.log('clear confirm shown:',await c.eval(`!!document.querySelector('#cf_ok')`));
    await c.eval(`document.querySelector('#cf_ok').click()`);
    await sleep(1200);
    console.log('chat msgs after clear:',await c.eval(`chat.msgs.length`));
    const cposts=JSON.parse(await c.eval(`JSON.stringify(window.__cposts)`));
    const clearPost=cposts.map(p=>{try{return decChat(p.body)}catch(e){return null}}).filter(x=>x&&x.op==='clear');
    console.log('clear op published:',clearPost.length>0);

    // пользователи
    await c.eval(`usersSheet()`);
    await sleep(1200);
    const users=await c.eval(`document.querySelector('#usersBox').textContent.replace(/\\s+/g,' ').trim().slice(0,160)`);
    console.log('USERS:',users);
    await c.shot(path.join(OUT,'admin-users.png'));
  }finally{chrome.kill()}
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
