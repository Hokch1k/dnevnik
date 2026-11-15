const fs=require('fs');
const head=fs.readFileSync('split.head','utf8');
const mid=fs.readFileSync('split.mid','utf8');
const tail=fs.readFileSync('split.tail','utf8');
const marker="$('#chatBtn').onclick=openChat;";
const cleaned=tail.startsWith(marker)?tail.slice(marker.length):tail;
fs.writeFileSync('index.html',head+mid+cleaned,'utf8');
console.log('assembled bytes',fs.statSync('index.html').size,'tail had marker:',tail.startsWith(marker));
