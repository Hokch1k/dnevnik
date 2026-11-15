const http=require('http');
const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const port=Number(process.env.PORT||8123);
const mime={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.apk':'application/vnd.android.package-archive','.css':'text/css; charset=utf-8'};

http.createServer((req,res)=>{
  let u=decodeURIComponent((req.url||'/').split('?')[0]);
  if(u==='/')u='/index.html';
  const fp=path.resolve(root,'.'+u);
  if(!fp.startsWith(root)){res.writeHead(403);return res.end('forbidden')}
  fs.readFile(fp,(e,b)=>{
    if(e){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('not found')}
    res.writeHead(200,{'Content-Type':mime[path.extname(fp).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(b);
  });
}).listen(port,'127.0.0.1',()=>console.log('dev server http://127.0.0.1:'+port));
