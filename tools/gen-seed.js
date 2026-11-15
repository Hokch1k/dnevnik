#!/usr/bin/env node
// Вставляет содержимое data.json внутрь index.html (между маркерами SEED_START/SEED_END).
// Нужно, чтобы приложение показывало расписание сразу при первом запуске без интернета.
const fs=require('fs');
const path=require('path');

const root=__dirname+'/..';
const htmlPath=path.join(root,'index.html');
const dataPath=path.join(root,'data.json');

const data=JSON.parse(fs.readFileSync(dataPath,'utf8'));
if(!Array.isArray(data.days)||!data.days.length)throw new Error('data.json: пустой список days');

const json=JSON.stringify(data);
const html=fs.readFileSync(htmlPath,'utf8');
const re=/(<!--SEED_START-->)([\s\S]*?)(<!--SEED_END-->)/;
if(!re.test(html))throw new Error('index.html: не найдены маркеры SEED_START / SEED_END');

const out=html.replace(re,(_,a,b,c)=>a+'\n<script type="application/json" id="seed">'+json+'</script>\n'+c);
fs.writeFileSync(htmlPath,out,'utf8');
console.log('seed: '+data.days.length+' дней, обновлено '+data.updated+', '+json.length+' байт');
