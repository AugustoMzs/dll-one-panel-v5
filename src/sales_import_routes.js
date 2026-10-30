import {Router} from 'express';
import {isSales} from './sales_catalog.js';
import {normalizeCatalogRowsFromWorkbook} from './sales_import_file.js';
import {BATCH_SIZE,validateImportItems,startSalesImport,listSalesImports,readSalesImport,uploadSalesBatch,previewSalesImport,applySalesImport,cancelSalesImport} from './sales_import.js';
// Global authentication/tenant guard runs first; enforce module and edit permission here too.
export function salesImportRouter(db,getCompany){
 const r=Router({mergeParams:true});
 r.use(async(req,res,next)=>{res.set('Cache-Control','no-store');try{
  if(!req.session)return res.sendStatus(401);
  const company=await getCompany(req.params.companyId);if(!company)return res.sendStatus(404);
  if(!isSales(company))return res.status(403).json({ok:false,error:'Esta sección requiere ONE Ventas.'});
  if(req.session.role!=='SUPERADMIN'){
   const a=(await db.query('SELECT permissions FROM panel_user_companies WHERE company_id=$1 AND user_id=$2',[company.company_id,req.session.uid])).rows[0];
   if(!a||a.permissions?.view===false||a.permissions?.editCatalog===false)return res.status(403).json({ok:false,error:'No tenés permiso para importar el catálogo.'});
  }
  req.importCompany=company;next();
 }catch{res.status(503).json({ok:false,error:'No se pudo verificar el acceso.'});}});
 const run=fn=>async(req,res)=>{try{res.json({ok:true,...await fn(req)});}catch(e){res.status(400).json({ok:false,error:e.code?'No se pudo completar la importación. Reintentá o recargá su estado.':e.message});}};
 r.post('/parse',run(req=>{
  const items=normalizeCatalogRowsFromWorkbook(req.body?.base64,req.body?.filename),seen=new Set(),clean=[];
  for(let i=0;i<items.length;i+=BATCH_SIZE)for(const x of validateImportItems(items.slice(i,i+BATCH_SIZE))){if(seen.has(x.codigo))throw Error('Código repetido en el archivo: '+x.codigo);seen.add(x.codigo);clean.push(x);}
  return {items:clean,batchSize:BATCH_SIZE};
 }));
 r.get('/',run(async req=>({items:await listSalesImports(db,req.importCompany)})));
 r.post('/',run(req=>startSalesImport(db,req.importCompany,req.body||{},req.session.uid)));
 r.get('/:id',run(req=>readSalesImport(db,req.importCompany,req.params.id)));
 r.post('/:id/batch',run(req=>uploadSalesBatch(db,req.importCompany,req.params.id,req.body||{})));
 r.post('/:id/preview',run(req=>previewSalesImport(db,req.importCompany,req.params.id)));
 r.post('/:id/apply',run(req=>applySalesImport(db,req.importCompany,req.params.id,req.body||{},req.session.uid)));
 r.post('/:id/cancel',run(req=>cancelSalesImport(db,req.importCompany,req.params.id)));
 return r;
}
