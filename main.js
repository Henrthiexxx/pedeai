const{app,BrowserWindow,ipcMain}=require('electron');
const path=require('path'),http=require('http'),fs=require('fs'),os=require('os');

const PORT=5570;
const ENTRY='index.html'; // troque se o entry for outro arquivo

const MIME={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.json':'application/json;charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml','.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.mp3':'audio/mpeg','.mp4':'video/mp4'};

function getLocalIp(){
  const nets=os.networkInterfaces();
  for(const k of Object.keys(nets))for(const n of nets[k])if(n.family==='IPv4'&&!n.internal)return n.address;
  return '127.0.0.1';
}

let serverInfo={baseUrl:'',pcBaseUrl:'',ip:'',port:PORT};
const SALES_DB_FILE='pedra-local-sales-db.json';
const CUSTOMERS_DB_FILE='pedra-local-customers-db.json';

function salesDbPath(){
  return path.join(app.getPath('userData'),SALES_DB_FILE);
}

function customersDbPath(){
  return path.join(app.getPath('userData'),CUSTOMERS_DB_FILE);
}

function readCustomersDb(){
  const file=customersDbPath();
  try{
    if(!fs.existsSync(file))return{version:1,stores:{}};
    const raw=fs.readFileSync(file,'utf-8');
    const parsed=JSON.parse(raw||'{}');
    if(!parsed||typeof parsed!=='object')return{version:1,stores:{}};
    if(!parsed.stores||typeof parsed.stores!=='object')parsed.stores={};
    if(!parsed.version)parsed.version=1;
    return parsed;
  }catch(e){
    console.error('[pedra] erro lendo db de clientes:',e);
    return{version:1,stores:{}};
  }
}

function writeCustomersDb(db){
  const file=customersDbPath();
  const payload=JSON.stringify(db,null,2);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,payload,'utf-8');
}

function getCustomerStore(db,storeId){
  const sid=String(storeId||'').trim();
  if(!sid)return{customers:{},aliases:{}};
  const entry=db.stores[sid];
  if(!entry||typeof entry!=='object')return{customers:{},aliases:{}};
  return{
    customers:entry.customers&&typeof entry.customers==='object'?entry.customers:{},
    aliases:entry.aliases&&typeof entry.aliases==='object'?entry.aliases:{}
  };
}

function readSalesDb(){
  const file=salesDbPath();
  try{
    if(!fs.existsSync(file))return{version:1,sales:[]};
    const raw=fs.readFileSync(file,'utf-8');
    const parsed=JSON.parse(raw||'{}');
    if(!parsed||typeof parsed!=='object')return{version:1,sales:[]};
    if(!Array.isArray(parsed.sales))parsed.sales=[];
    if(!parsed.version)parsed.version=1;
    return parsed;
  }catch(e){
    console.error('[pedra] erro lendo db local:',e);
    return{version:1,sales:[]};
  }
}

function writeSalesDb(db){
  const file=salesDbPath();
  const payload=JSON.stringify(db,null,2);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,payload,'utf-8');
}

function makeLocalSaleId(){
  return `sale_${Date.now()}_${Math.random().toString(36).slice(2,10)}`;
}

function startServer(rootDir){
  return new Promise((resolve,reject)=>{
    const server=http.createServer((req,res)=>{
      res.setHeader('Access-Control-Allow-Origin','*');
      res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Content-Type');
      if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}

      const urlObj=new URL(req.url,'http://x');
      let p=urlObj.pathname;

      if(p==='/__pedra/server-info'){
        res.setHeader('Content-Type','application/json');
        return res.end(JSON.stringify(serverInfo));
      }
      if(p==='/__pedra/store-context'){res.statusCode=204;return res.end()}

      if(p==='/')p='/'+ENTRY;
      const safe=path.normalize(p).replace(/^([\\\/]?\.\.[\\\/])+/,'');
      const filePath=path.join(rootDir,safe);
      if(!filePath.startsWith(rootDir)){res.statusCode=403;return res.end('Forbidden')}

      fs.readFile(filePath,(err,data)=>{
        if(err){res.statusCode=404;return res.end('Not Found')}
        res.setHeader('Content-Type',MIME[path.extname(filePath).toLowerCase()]||'application/octet-stream');
        res.end(data);
      });
    });
    server.on('error',reject);
    server.listen(PORT,'0.0.0.0',()=>{
      const ip=getLocalIp();
      const url=`http://${ip}:${PORT}/`;
      serverInfo={baseUrl:url,pcBaseUrl:url,ip,port:PORT};
      console.log('[pedra] servidor local em',url);
      resolve(serverInfo);
    });
  });
}

ipcMain.handle('pedra:get-server-info',()=>serverInfo);
ipcMain.handle('pedra:sales:add',(_event,salePayload={})=>{
  const db=readSalesDb();
  const nowIso=new Date().toISOString();
  const incoming={
    localSaleId:makeLocalSaleId(),
    createdAtLocal:nowIso,
    updatedAtLocal:nowIso,
    ...salePayload
  };
  const externalId=String(incoming.externalOrderId||'').trim();
  if(externalId){
    const idx=db.sales.findIndex(x=>String(x.externalOrderId||'').trim()===externalId);
    if(idx>=0){
      db.sales[idx]={
        ...db.sales[idx],
        ...incoming,
        localSaleId:db.sales[idx].localSaleId||incoming.localSaleId,
        createdAtLocal:db.sales[idx].createdAtLocal||incoming.createdAtLocal,
        updatedAtLocal:nowIso
      };
      writeSalesDb(db);
      return{ok:true,localSaleId:db.sales[idx].localSaleId,updated:true};
    }
  }
  const item=incoming;
  db.sales.push(item);
  writeSalesDb(db);
  return{ok:true,localSaleId:item.localSaleId};
});

ipcMain.handle('pedra:sales:list',(_event,query={})=>{
  const db=readSalesDb();
  const storeId=String(query.storeId||'').trim();
  const source=String(query.source||'').trim();
  const limit=Math.max(1,Math.min(5000,parseInt(query.limit,10)||500));
  const offset=Math.max(0,parseInt(query.offset,10)||0);
  let list=[...db.sales];
  if(storeId)list=list.filter(x=>String(x.storeId||'')===storeId);
  if(source)list=list.filter(x=>String(x.source||'')===source);
  list.sort((a,b)=>String(b.createdAtLocal||'').localeCompare(String(a.createdAtLocal||'')));
  return{
    ok:true,
    total:list.length,
    items:list.slice(offset,offset+limit)
  };
});

ipcMain.handle('pedra:sales:clear',()=>{
  const db={version:1,sales:[]};
  writeSalesDb(db);
  return{ok:true};
});

ipcMain.handle('pedra:customers:get',(_event,query={})=>{
  const sid=String(query.storeId||'').trim();
  if(!sid)return{ok:false,error:'storeId obrigatório',customers:{},aliases:{}};
  const db=readCustomersDb();
  const store=getCustomerStore(db,sid);
  return{ok:true,storeId:sid,customers:store.customers,aliases:store.aliases};
});

ipcMain.handle('pedra:customers:set',(_event,payload={})=>{
  const sid=String(payload.storeId||'').trim();
  if(!sid)return{ok:false,error:'storeId obrigatório'};
  const db=readCustomersDb();
  const current=getCustomerStore(db,sid);
  const next={
    customers:payload.customers&&typeof payload.customers==='object'?payload.customers:current.customers,
    aliases:payload.aliases&&typeof payload.aliases==='object'?payload.aliases:current.aliases,
    updatedAt:new Date().toISOString()
  };
  db.stores[sid]=next;
  writeCustomersDb(db);
  return{ok:true,storeId:sid};
});

ipcMain.handle('pedra:customers:clear',(_event,query={})=>{
  const sid=String(query.storeId||'').trim();
  const db=readCustomersDb();
  if(sid)delete db.stores[sid];
  else db.stores={};
  writeCustomersDb(db);
  return{ok:true,storeId:sid};
});

let win=null;
async function createWindow(){
  const rootDir=app.getAppPath();
  try{await startServer(rootDir)}catch(e){console.error('servidor local falhou:',e)}

  win=new BrowserWindow({
    width:1280,height:800,
    webPreferences:{
      preload:path.join(__dirname,'preload.js'),
      contextIsolation:true,
      nodeIntegration:false,
      sandbox:false
    }
  });

  if(serverInfo.baseUrl)win.loadURL(`http://127.0.0.1:${PORT}/${ENTRY}`);
  else win.loadFile(path.join(rootDir,ENTRY));
}

app.whenReady().then(createWindow);
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)createWindow()});
