const http=require('http');const https=require('https');
const PORT=process.env.PORT||9000;
const EPS=[
 {proto:'https',host:'115.159.159.11',port:443,hostHeader:'api.mixm.top',sni:'api.mixm.top'},
 {proto:'http',host:'115.159.159.11',port:80,hostHeader:'api.mixm.top'},
 {proto:'https',host:'115.159.159.11',port:443,hostHeader:'cloud.mixm.top',sni:'cloud.mixm.top'},
 {proto:'http',host:'115.159.159.11',port:80,hostHeader:'cloud.mixm.top'}
];
const PASS=['content-type','accept','authorization','idempotency-key','x-request-id','x-mixmapp-client','accept-language'];
const CORS={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS','access-control-allow-headers':'authorization,content-type,idempotency-key,x-request-id,x-mixmapp-client,accept,accept-language','access-control-max-age':'86400','cache-control':'no-store'};
function call(ep,method,url,headers,body){return new Promise((resolve)=>{
  const mod=ep.proto==='https'?https:http;
  const opt={host:ep.host,port:ep.port,method:method,path:url,headers:headers,timeout:15000};
  if(ep.sni)opt.servername=ep.sni;
  if(ep.proto==='https')opt.rejectUnauthorized=false;
  const req=mod.request(opt,(r)=>{
    const b=[];r.on('data',c=>b.push(c));
    r.on('end',()=>resolve({status:r.statusCode,type:r.headers['content-type']||'',loc:r.headers.location||'',buf:Buffer.concat(b)}));
  });
  req.on('timeout',()=>req.destroy(new Error('timeout')));
  req.on('error',(e)=>resolve({status:0,type:'',loc:'',buf:Buffer.from(e.message)}));
  if(body&&body.length)req.write(body);
  req.end();
});}
http.createServer(async (req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(204,CORS);res.end('');return;}
  const url=req.url||'/';
  if(url.indexOf('/mixmapp')!==0){res.writeHead(404,CORS);res.end('{"error":{"code":"NOT_FOUND"}}');return;}
  const chunks=[];req.on('data',c=>chunks.push(c));
  await new Promise((r)=>req.on('end',r));
  const body=Buffer.concat(chunks);
  const trace=[];
  let best=null;
  for(const ep of EPS){
    const headers={host:ep.hostHeader};
    for(const n of PASS){if(req.headers[n])headers[n]=req.headers[n];}
    const r=await call(ep,req.method,url,headers,body);
    trace.push({ep:ep.proto+'://'+ep.host+':'+ep.port,status:r.status,type:r.type,loc:r.loc,head:r.buf.toString('utf8').slice(0,120)});
    if(r.status>=200&&r.status<400&&r.type.indexOf('json')>=0){best=r;break;}
    if(!best||(best.status===0&&r.status>0))best=r;
  }
  if(best&&best.type.indexOf('json')>=0&&best.status<400){
    const out=Object.assign({},CORS,{'content-type':best.type||'application/json; charset=utf-8'});
    res.writeHead(best.status,out);res.end(best.buf);return;
  }
  res.writeHead(502,Object.assign({},CORS,{'content-type':'application/json; charset=utf-8'}));
  res.end(JSON.stringify({error:{code:'UPSTREAM_UNREACHABLE',message:'no json upstream'},trace:trace}));
}).listen(PORT,'0.0.0.0');
