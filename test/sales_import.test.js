import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import * as XLSX from 'xlsx';
import express from 'express';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {initSalesCatalog,saveSalesItems} from '../src/sales_catalog.js';
import {canonicalImportJson,initSalesImports,startSalesImport,readSalesImport,uploadSalesBatch,previewSalesImport,applySalesImport,cancelSalesImport,validateImportItems} from '../src/sales_import.js';
import {normalizeCatalogRowsFromWorkbook} from '../src/sales_import_file.js';
import {salesImportRouter} from '../src/sales_import_routes.js';
const company={company_id:'A',modules:{ventas:true}},other={...company,company_id:'B'};
const digest=x=>createHash('sha256').update(canonicalImportJson(x)).digest('hex');
const normalized=items=>items.flatMap((_,i)=>i%500?[]:validateImportItems(items.slice(i,i+500)));
const product=(codigo,precio=100)=>({codigo,nombre:'Producto '+codigo,precio});
const workbook=rows=>{const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'Lista');return XLSX.write(wb,{bookType:'xlsx',type:'base64'});};
test('importación transaccional y recuperable con PostgreSQL',async t=>{
 const pg=new PGlite();let failCommit=false;
 const query=(q,a)=>{if(failCommit&&q.startsWith("UPDATE panel_sales_imports SET state='APPLIED'"))throw Error('fallo de auditoría');return pg.query(q,a);};
 const db={query,connect:async()=>({query,release(){}})};let counter=0;
 const draft=async items=>startSalesImport(db,company,{requestId:'request-number-'+String(++counter).padStart(4,'0'),sourceHash:digest(normalized(items)),filename:'prueba.xlsx',total:items.length},7);
 const send=async(id,items)=>{for(let i=0;i<items.length;i+=500)await uploadSalesBatch(db,company,id,{index:i/500,items:items.slice(i,i+500)});};
 const catalog=async()=> (await pg.query("SELECT * FROM panel_sales_catalog WHERE company_id='A'")).rows[0];
 try{
  await pg.exec("CREATE TABLE panel_companies(company_id TEXT PRIMARY KEY); INSERT INTO panel_companies VALUES ('A'),('B');");
  await initSalesCatalog(db);await initSalesImports(db);
  await pg.query('INSERT INTO panel_sales_catalog(company_id,items) VALUES($1,$2),($3,$2)',['A',JSON.stringify([{id:'old',fila:2,codigo:'0001',nombre:'Anterior',precio:50,activo:'NO',marca:'Conservar',modoPrecio:'FIJO'}]),'B']);
  await t.test('1001 filas: reintentos y recarga no tocan catálogo hasta confirmar',async()=>{
   const items=[product('0001',125),...Array.from({length:1000},(_,i)=>product('N'+i))],d=await draft(items);
   const repeated=await startSalesImport(db,company,{requestId:'request-number-0001',sourceHash:digest(normalized(items)),filename:'prueba.xlsx',total:1001},7);assert.equal(repeated.id,d.id);
   await uploadSalesBatch(db,company,d.id,{index:0,items:items.slice(0,500)});assert.equal((await readSalesImport(db,company,d.id)).uploaded,500);
   await assert.rejects(previewSalesImport(db,company,d.id),/Faltan/);assert.equal((await catalog()).revision,1);
   await send(d.id,items);assert.equal((await readSalesImport(db,company,d.id)).uploaded,1001);
   const p=await previewSalesImport(db,company,d.id);assert.equal(p.created,1000);assert.equal(p.updated,1);assert.equal(p.preview.length,50);assert.equal(p.preview[0].after.activo,'NO');assert.equal(p.preview[0].after.marca,'Conservar');assert.equal((await catalog()).revision,1);
   const result=await applySalesImport(db,company,d.id,p,7);assert.equal(result.revision,2);
   assert.equal((await applySalesImport(db,company,d.id,p,7)).alreadyApplied,true);assert.equal((await catalog()).items.length,1001);assert.equal((await catalog()).items[0].id,'old');
   assert.equal((await pg.query("SELECT revision FROM panel_sales_catalog WHERE company_id='B'")).rows[0].revision,1);await assert.rejects(cancelSalesImport(db,company,d.id),/aplicada/);
  });
  await t.test('otra empresa y Gastro no acceden al borrador',async()=>{
   const d=await draft([product('X')]);
   for(const fn of [()=>readSalesImport(db,other,d.id),()=>previewSalesImport(db,other,d.id),()=>applySalesImport(db,other,d.id,{},2),()=>cancelSalesImport(db,other,d.id),()=>uploadSalesBatch(db,other,d.id,{index:0,items:[product('X')]})])await assert.rejects(fn,/empresa/);
   await assert.rejects(readSalesImport(db,{...company,modules:{gastro:true}},d.id),/Ventas/);await cancelSalesImport(db,company,d.id);
  });
  await t.test('cancelación conserva catálogo y bloquea aplicación',async()=>{
   const d=await draft([product('CANCEL')]);await send(d.id,[product('CANCEL')]);const before=await catalog();await cancelSalesImport(db,company,d.id);await cancelSalesImport(db,company,d.id);
   await assert.rejects(applySalesImport(db,company,d.id,{},7),/cerrada/);assert.deepEqual(await catalog(),before);
  });
  await t.test('edición intermedia invalida vista previa',async()=>{
   const items=[product('0001',500)],d=await draft(items);await send(d.id,items);const p=await previewSalesImport(db,company,d.id);
   await saveSalesItems(db,company,[{...(await catalog()).items[0],precio:300}],(await catalog()).revision);
   await assert.rejects(applySalesImport(db,company,d.id,p,7),/cambió/);assert.equal((await catalog()).items[0].precio,300);
   await applySalesImport(db,company,d.id,await previewSalesImport(db,company,d.id),7);assert.equal((await catalog()).items[0].precio,500);
  });
  await t.test('fallo de auditoría revierte catálogo y deja borrador',async()=>{
   const items=[product('FAIL')],d=await draft(items);await send(d.id,items);const p=await previewSalesImport(db,company,d.id),before=await catalog();failCommit=true;
   await assert.rejects(applySalesImport(db,company,d.id,p,7),/auditoría/);failCommit=false;assert.deepEqual(await catalog(),before);assert.equal((await readSalesImport(db,company,d.id)).state,'DRAFT');await cancelSalesImport(db,company,d.id);
  });
  await t.test('rechaza lote alterado, índice incorrecto y mezcla de archivos',async()=>{
   const d=await draft([product('CHECK')]);await send(d.id,[product('CHECK')]);await assert.rejects(send(d.id,[product('OTHER')]),/otro contenido/);
   await assert.rejects(uploadSalesBatch(db,company,d.id,{index:2,items:[product('CHECK')]}),/lote/);await cancelSalesImport(db,company,d.id);
   const e=await draft([product('ORIGINAL')]);await send(e.id,[product('CHANGED')]);await assert.rejects(previewSalesImport(db,company,e.id),/original/);await cancelSalesImport(db,company,e.id);
  });
  await t.test('duplicados entre lotes bloquean la carga',async()=>{
   const items=Array.from({length:501},(_,i)=>product('D'+(i===500?0:i))),d=await draft(items);await send(d.id,items);await assert.rejects(previewSalesImport(db,company,d.id),/repetido/);await cancelSalesImport(db,company,d.id);
  });
  await t.test('código ambiguo en catálogo no elige un producto arbitrariamente',async()=>{
   const before=await catalog();await pg.query("UPDATE panel_sales_catalog SET items=$1 WHERE company_id='A'",[JSON.stringify([product('DUP'),product('DUP')])]);
   const d=await draft([product('DUP')]);await send(d.id,[product('DUP')]);await assert.rejects(previewSalesImport(db,company,d.id),/más de un/);await cancelSalesImport(db,company,d.id);
   await pg.query("UPDATE panel_sales_catalog SET items=$1 WHERE company_id='A'",[JSON.stringify(before.items)]);
  });
 }finally{await pg.close();}
});
test('archivo: ceros iniciales, precios, columnas omitidas, filas inválidas y límite',()=>{
 const rows=normalizeCatalogRowsFromWorkbook(workbook([{CODIGO:'000123',NOMBRE:'Uno',PRECIO:1200.5}]));assert.equal(rows[0].codigo,'000123');assert.equal(rows[0].precio,1200.5);assert.equal(Object.hasOwn(rows[0],'activo'),false);
 assert.throws(()=>normalizeCatalogRowsFromWorkbook(workbook([{CODIGO:'X',PRECIO:2}])),/nombre/);
 for(const bad of [product(''),{...product('A'),precio:-1},{...product('A'),precio:Infinity},{...product('A'),activo:'OTRO'},{...product('A'),codigo:'a'.repeat(201)}])assert.throws(()=>validateImportItems([bad]));
 assert.throws(()=>normalizeCatalogRowsFromWorkbook(workbook(Array.from({length:10001},(_,i)=>({CODIGO:String(i),NOMBRE:'X',PRECIO:1})))),/10000/);
});
test('rutas deniegan consultas ajenas, usuarios sin edición y Gastro',async()=>{
 let allowed=false;const db={query:async()=>({rows:allowed?[{permissions:{view:true,editCatalog:false}}]:[]})};
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.session={uid:1,role:'USER'};next();});app.use('/company/:companyId/imports',salesImportRouter(db,async id=>({company_id:id,modules:{[id==='G'?'gastro':'ventas']:true}})));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const path of ['/company/A/imports','/company/B/imports/x','/company/G/imports'])assert.equal((await fetch(base+path)).status,403);allowed=true;
 for(const path of ['parse','x/preview','x/apply','x/cancel','x/batch'])assert.equal((await fetch(base+'/company/A/imports/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
 }finally{await new Promise(r=>server.close(r));}
 const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');assert.ok(source.indexOf("app.use('/api/company/:companyId/catalog/imports'")>source.indexOf('  authRequired,\n  companyAccessRequired,\n  requireConfiguredModule(getCompany)'));assert.match(source,/catalog\/import-file'.*409/);
});
test('UI descarta respuestas de otra empresa y escapa HTML',async()=>{
 const dom=new JSDOM('<div id="salesImport"></div>',{runScripts:'outside-only'}),w=dom.window;w.$=id=>w.document.getElementById(id);w.companyId='A';w.money=String;w.confirm=()=>true;
 w.eval(readFileSync(new URL('../public/sales_import.js',import.meta.url),'utf8'));const calls=[];w.api=(url,options)=>new Promise(resolve=>calls.push({url,options,resolve}));
 const l=w.loadSalesImports();calls[0].resolve({items:[]});await l;
 const view=w.reviewSalesImport('draft');calls[1].resolve({id:'draft',state:'DRAFT',uploaded:1,total:1});await new Promise(r=>setTimeout(r,0));
 w.companyId='B';const otherLoad=w.loadSalesImports();calls[3].resolve({items:[]});await otherLoad;calls[2].resolve({created:1,updated:0,unchanged:0,preview:[]});await view;assert.equal(w.$('salesImportDetail').textContent,'');
 const own=w.reviewSalesImport('own');calls[4].resolve({id:'own',state:'DRAFT',uploaded:1,total:1});await new Promise(r=>setTimeout(r,0));calls[5].resolve({created:1,updated:0,unchanged:0,preview:[{codigo:'X',nombre:'<img src=x>',after:{nombre:'<img src=x>',precio:2}}]});await own;assert.equal(w.$('salesImportDetail').querySelector('img'),null);assert.match(w.$('salesImportDetail').textContent,/<img src=x>/);dom.window.close();
});
test('huella independiente del orden de claves y CSV con códigos de ceros',()=>{
 assert.equal(canonicalImportJson([{codigo:'A',nombre:'Uno',precio:2}]),canonicalImportJson([{precio:2,nombre:'Uno',codigo:'A'}]));
 const rows=normalizeCatalogRowsFromWorkbook(Buffer.from('CODIGO,NOMBRE,PRECIO\n000123,Uno,1200\n').toString('base64'),'prueba.csv');assert.equal(rows[0].codigo,'000123');assert.equal(rows[0].precio,1200);
});
test('UI retoma una carga interrumpida, no aplica sin confirmación y bloquea doble clic',async()=>{
 const dom=new JSDOM('<div id="salesImport"></div><input id="catalogFile" type="file">',{runScripts:'outside-only',url:'https://panel.test'}),w=dom.window;
 w.$=id=>w.document.getElementById(id);w.companyId='A';w.salesBusy=false;w.money=String;w.invalidateSalesPricePreview=()=>{};w.fileToBase64=async()=> 'fake';w.TextEncoder=TextEncoder;
 const {webcrypto,randomUUID}=await import('node:crypto');Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});Object.defineProperty(w.crypto,'randomUUID',{value:randomUUID});
 Object.defineProperty(w.$('catalogFile'),'files',{value:[{name:'lista.csv',size:20}]});
 const items=normalized([product('0001')]),p={token:'T',catalogRevision:1,draftRevision:1,created:1,updated:0,unchanged:0,preview:[]};
 let batchAttempts=0,applies=0,reloaded=0,resolveApply;const requests=[];
 w.api=async(url,options)=>{const body=options?JSON.parse(options.body):null;requests.push({url,body});
  if(url.endsWith('/parse'))return {items,batchSize:500};
  if(url.endsWith('/batch')){if(++batchAttempts===1)throw Error('conexión interrumpida');return {};}
  if(url.endsWith('/preview'))return p;
  if(url.endsWith('/apply')){applies++;return new Promise(resolve=>resolveApply=resolve);}
  if(url.endsWith('/draft'))return {id:'draft',sourceHash:digest(items),state:'DRAFT',uploaded:1,total:1};
  if(body)return {id:'draft',state:'DRAFT'};
  return {items:[]};
 };
 w.loadCatalog=async()=>{reloaded++;};w.confirm=()=>false;
 w.eval(readFileSync(new URL('../public/sales_import.js',import.meta.url),'utf8'));
 await w.loadSalesImports();await w.importCatalogFile();assert.match(w.$('salesImportStatus').textContent,/interrumpida/);assert.equal(applies,0);
 await w.importCatalogFile();const starts=requests.filter(x=>x.body?.requestId);assert.equal(starts.length,2);assert.equal(starts[0].body.requestId,starts[1].body.requestId);assert.equal(starts[0].body.sourceHash,digest(items));
 await w.applySelectedSalesImport();assert.equal(applies,0);w.confirm=()=>true;
 const apply=w.applySelectedSalesImport();await w.applySelectedSalesImport();assert.equal(applies,1);resolveApply({created:1,updated:0});await apply;assert.equal(reloaded,1);dom.window.close();
});
