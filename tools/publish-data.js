// Публикует текущий data.json в ntfy (зашифровано ключом расписания), частями по 3500 символов,
// чтобы сообщения проходили лимит ntfy и расписание грузилось там, где GitHub недоступен.
// Запуск: node tools/publish-data.js
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

const DATA_TOPIC='dnevnikDataHsPJjwoQ5z';
const KEY=Buffer.from('YD5ijw9LbAdrCqqz3XTj3ox9I6Sp6tmfewNK0+s/YNg=','base64');
const CHUNK=3500;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  const file=path.join(__dirname,'..','data.json');
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!Array.isArray(data.days)||!data.days.length)throw new Error('data.json: пустой список days');
  const iv=crypto.randomBytes(12);
  const c=crypto.createCipheriv('aes-256-gcm',KEY,iv);
  const ct=Buffer.concat([c.update(JSON.stringify(data),'utf8'),c.final(),c.getAuthTag()]);
  const payload=iv.toString('base64')+'.'+ct.toString('base64');
  const gid=Date.now().toString(36);
  const total=Math.ceil(payload.length/CHUNK);
  for(let i=0;i<total;i++){
    const body=JSON.stringify({gid:gid,i:i,total:total,data:payload.slice(i*CHUNK,(i+1)*CHUNK)});
    const r=await fetch('https://ntfy.sh/'+DATA_TOPIC,{method:'POST',body:body,headers:{'Content-Type':'text/plain;charset=utf-8'}});
    if(!r.ok)throw new Error('ntfy: http '+r.status);
    if(i<total-1)await sleep(400);
  }
  console.log('опубликовано: '+data.days.length+' дней, обновлено '+data.updated+', частей '+total+', id '+gid);
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
