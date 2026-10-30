import {createHash,randomUUID} from 'node:crypto';
import {isSales,normalizeSalesItem} from './sales_catalog.js';
export const IMPORT_LIMIT=10000, BATCH_SIZE=500;
export const canonicalImportJson=x=>JSON.stringify(x,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);
const hash=x=>createHash('sha256').update(canonicalImportJson(x)).digest('hex');
const fail=message=>{throw Error(message);};
function sales(company){if(!isSales(company))fail('Esta sección requiere ONE Ventas.');}
export async function initSalesImports(db){
 await db.query(`CREATE TABLE IF NOT EXISTS panel_sales_imports (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL, request_id TEXT NOT NULL, source_hash TEXT NOT NULL, filename TEXT NOT NULL,
 total INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'DRAFT', revision INTEGER NOT NULL DEFAULT 0,
 actor TEXT NOT NULL, result JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(company_id,request_id));`);
 await db.query(`CREATE TABLE IF NOT EXISTS panel_sales_import_batches (
 import_id TEXT NOT NULL REFERENCES panel_sales_imports(id), batch_index INTEGER NOT NULL,
 digest TEXT NOT NULL, items JSONB NOT NULL, PRIMARY KEY(import_id,batch_index));`);
}
async function tx(db,fn){const c=await db.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
async function get(c,company,id,lock=false){sales(company);const r=(await c.query('SELECT * FROM panel_sales_imports WHERE id=$1 AND company_id=$2'+(lock?' FOR UPDATE':''),[id,company.company_id])).rows[0];if(!r)fail('Importación no encontrada para esta empresa.');return r;}
function summary(r,batches=[]){return {id:r.id,filename:r.filename,sourceHash:r.source_hash,total:r.total,state:r.state,revision:r.revision,result:r.result,batches:batches.map(b=>b.batch_index),uploaded:batches.reduce((n,b)=>n+b.items.length,0)};}
export async function listSalesImports(db,company){sales(company);return (await db.query("SELECT id,filename,source_hash,total,state,revision,result,created_at FROM panel_sales_imports WHERE company_id=$1 ORDER BY (state='DRAFT') DESC, created_at DESC LIMIT 20",[company.company_id])).rows;}
export async function startSalesImport(db,company,input,actor){
 sales(company);
 if(!/^[a-zA-Z0-9_-]{16,100}$/.test(input.requestId||''))fail('Identificador de carga inválido.');
 if(!Number.isInteger(input.total)||input.total<1||input.total>IMPORT_LIMIT)fail('La carga admite entre 1 y 10000 filas.');
 if(!/^[a-f0-9]{64}$/.test(input.sourceHash||''))fail('Huella del archivo inválida.');
 const filename=String(input.filename||'Catálogo').slice(0,200);
 return tx(db,async c=>{
  await c.query('SELECT company_id FROM panel_companies WHERE company_id=$1 FOR UPDATE',[company.company_id]);
  const existing=(await c.query('SELECT * FROM panel_sales_imports WHERE company_id=$1 AND request_id=$2',[company.company_id,input.requestId])).rows[0];
  if(existing){if(existing.total!==input.total||existing.filename!==filename||existing.source_hash!==input.sourceHash)fail('El identificador ya corresponde a otra carga.');return summary(existing);}
  const n=(await c.query("SELECT COUNT(*) AS n FROM panel_sales_imports WHERE company_id=$1 AND state='DRAFT'",[company.company_id])).rows[0];
  if(Number(n.n)>=10)fail('Hay 10 cargas pendientes. Cancelá una antes de iniciar otra.');
  const r=(await c.query('INSERT INTO panel_sales_imports(id,company_id,request_id,filename,total,actor,source_hash) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[randomUUID(),company.company_id,input.requestId,filename,input.total,String(actor),input.sourceHash])).rows[0];return summary(r);
 });
}
export async function readSalesImport(db,company,id){const r=await get(db,company,id);const b=(await db.query('SELECT batch_index,items FROM panel_sales_import_batches WHERE import_id=$1 ORDER BY batch_index',[id])).rows;return summary(r,b);}
export function validateImportItems(inputs){
 if(!Array.isArray(inputs)||!inputs.length||inputs.length>BATCH_SIZE)fail('Cada lote debe contener entre 1 y 500 filas.');
 const fields={codigo:200,nombre:200,descripcion:2000,tipoItem:200,modoPrecio:200,unidad:200,categoria:200,marca:200,activo:10};
 return inputs.map((input,i)=>{
  if(!input||typeof input!=='object'||Array.isArray(input))fail('Fila inválida.');
  const item={};for(const [k,max] of Object.entries(fields))if(Object.hasOwn(input,k)){
   if(typeof input[k]!=='string'||input[k].length>max)fail(`Fila ${i+1}: campo ${k} inválido o demasiado largo.`);item[k]=input[k].trim();
  }
  if(!item.codigo||!item.nombre)fail(`Fila ${i+1}: completá código y nombre. Cada producto necesita un código estable.`);
  if(typeof input.precio!=='number')fail(`Fila ${i+1}: precio inválido.`);item.precio=input.precio;
  if(item.activo&&!['SI','NO'].includes(item.activo.toUpperCase()))fail('Activo debe ser SI o NO.');
  normalizeSalesItem(item);return item;
 });
}
export async function uploadSalesBatch(db,company,id,input){
 const items=validateImportItems(input.items),digest=hash(items);
 return tx(db,async c=>{
  const r=await get(c,company,id,true);if(r.state!=='DRAFT')fail('La carga ya está cerrada.');
  const i=input.index,number=Math.ceil(r.total/BATCH_SIZE);
  if(!Number.isInteger(i)||i<0||i>=number||items.length!==Math.min(BATCH_SIZE,r.total-i*BATCH_SIZE))fail('Número o tamaño de lote inválido.');
  const old=(await c.query('SELECT digest FROM panel_sales_import_batches WHERE import_id=$1 AND batch_index=$2',[id,i])).rows[0];
  if(old){if(old.digest!==digest)fail('Ese lote ya tiene otro contenido. Cancelá la carga y comenzá otra.');return {duplicate:true};}
  await c.query('INSERT INTO panel_sales_import_batches(import_id,batch_index,digest,items) VALUES($1,$2,$3,$4)',[id,i,digest,JSON.stringify(items)]);
  await c.query('UPDATE panel_sales_imports SET revision=revision+1,updated_at=NOW() WHERE id=$1',[id]);return {duplicate:false};
 });
}
async function plan(c,company,r,lock=false){
 if(r.state!=='DRAFT')fail('La carga ya está cerrada.');
 const batches=(await c.query('SELECT batch_index,items FROM panel_sales_import_batches WHERE import_id=$1 ORDER BY batch_index',[r.id])).rows;
 const incoming=batches.flatMap(b=>b.items);
 if(incoming.length!==r.total)fail('Faltan lotes. Volvé a seleccionar el mismo archivo para completar la carga.');
 if(hash(incoming)!==r.source_hash)fail('Los lotes no corresponden al archivo original. Cancelá esta carga y volvé a cargar el archivo completo.');
 const row=(await c.query('SELECT * FROM panel_sales_catalog WHERE company_id=$1'+(lock?' FOR UPDATE':''),[company.company_id])).rows[0];
 if(!row)fail('Primero cargá el catálogo existente para conservar sus productos.');
 const items=structuredClone(row.items),byCode=new Map(),seen=new Set();
 for(let i=0;i<items.length;i++){const code=String(items[i].codigo||'').trim();if(code){if(byCode.has(code))byCode.set(code,-1);else byCode.set(code,i);}}
 let nextRow=items.reduce((n,x)=>Math.max(n,Number(x.fila)||1),1),created=0,updated=0,unchanged=0;const preview=[];
 for(const input of incoming){
  if(seen.has(input.codigo))fail('Código repetido en la carga: '+input.codigo);seen.add(input.codigo);
  const index=byCode.get(input.codigo);if(index===-1)fail('El catálogo tiene más de un producto con el código '+input.codigo);
  const old=index===undefined?null:items[index];
  const item=normalizeSalesItem(input,old);
  if(!old)item.id='SALE-'+hash([company.company_id,r.id,input.codigo]).slice(0,32);
  item.fila=old?.fila||++nextRow;
  const changed=!old||canonicalImportJson(old)!==canonicalImportJson(item);
  if(!old){items.push(item);created++;}else if(changed){items[index]=item;updated++;}else unchanged++;
  if(preview.length<50)preview.push({codigo:item.codigo,nombre:item.nombre,action:!old?'NUEVO':changed?'ACTUALIZAR':'SIN CAMBIOS',before:old,after:item});
 }
 const token=hash([company.company_id,r.id,r.revision,row.revision,items]);
 return {items,token,catalogRevision:row.revision,draftRevision:r.revision,created,updated,unchanged,total:incoming.length,preview};
}
export async function previewSalesImport(db,company,id){return tx(db,async c=>{const r=await get(c,company,id,true);const {items,...p}=await plan(c,company,r);return p;});}
export async function applySalesImport(db,company,id,input,actor){return tx(db,async c=>{
 const r=await get(c,company,id,true);
 if(r.state==='APPLIED')return {...r.result,alreadyApplied:true};
 const p=await plan(c,company,r,true);
 if(input.token!==p.token||input.catalogRevision!==p.catalogRevision||input.draftRevision!==p.draftRevision)fail('El catálogo o la carga cambió. Generá una nueva vista previa antes de confirmar.');
 const changed=p.created+p.updated;
 if(changed)await c.query('UPDATE panel_sales_catalog SET items=$2,revision=revision+1,updated_at=NOW() WHERE company_id=$1',[company.company_id,JSON.stringify(p.items)]);
 const result={created:p.created,updated:p.updated,unchanged:p.unchanged,revision:p.catalogRevision+(changed?1:0),appliedBy:String(actor),appliedAt:new Date().toISOString()};
 await c.query("UPDATE panel_sales_imports SET state='APPLIED',result=$2,updated_at=NOW() WHERE id=$1",[id,JSON.stringify(result)]);return result;
 });}
export async function cancelSalesImport(db,company,id){return tx(db,async c=>{const r=await get(c,company,id,true);if(r.state==='APPLIED')fail('La carga ya fue aplicada y no se puede cancelar.');await c.query("UPDATE panel_sales_imports SET state='CANCELLED',updated_at=NOW() WHERE id=$1",[id]);return {state:'CANCELLED'};});}
