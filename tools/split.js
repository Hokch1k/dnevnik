const fs=require('fs');
const s=fs.readFileSync('index.html','utf8');
const start=s.indexOf('/* ---------- чат ---------- */');
const endMarker="$('#chatBtn').onclick=openChat;";
const end=s.indexOf(endMarker);
if(start<0||end<0){console.log('markers not found',start,end);process.exit(1)}
fs.writeFileSync('split.head',s.slice(0,start),'utf8');
fs.writeFileSync('split.tail',s.slice(end),'utf8');
console.log('head',start,'tail',s.length-end);
