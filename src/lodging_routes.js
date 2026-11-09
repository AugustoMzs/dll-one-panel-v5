import {Router} from 'express';
import {lodgingCatalog,saveCabins} from './lodging.js';
// Company authentication, membership and module guard are applied before this router.
export function lodgingRouter(db){
 const router=Router({mergeParams:true});
 router.use(async(req,res,next)=>{res.set('Cache-Control','no-store');try{
  const access=req.session?.role==='SUPERADMIN'?{permissions:{}}:(await db.query('SELECT permissions FROM panel_user_companies WHERE company_id=$1 AND user_id=$2',[req.params.companyId,req.session?.uid])).rows[0];
  req.lodgingCanEdit=!!access&&access.permissions?.view!==false&&access.permissions?.editCatalog!==false;next();
 }catch{res.status(503).json({ok:false,error:'No se pudieron verificar los permisos.'});}});
 router.get('/',async(req,res)=>{try{res.json({ok:true,canEdit:req.lodgingCanEdit,...await lodgingCatalog(db,req.params.companyId)});}catch{res.status(503).json({ok:false,error:'No se pudo consultar el catálogo.'});}});
 router.post('/',async(req,res)=>{
  if(!req.lodgingCanEdit)return res.status(403).json({ok:false,error:'No tenés permiso para editar.'});
  if(req.moduleCompany?.service_state!=='ACTIVE')return res.status(403).json({ok:false,error:'Servicio pausado.'});
  try{res.json({ok:true,...await saveCabins(db,req.params.companyId,req.body||{})});}catch(e){res.status(400).json({ok:false,error:e.code?'No se pudo guardar el catálogo.':e.message});}
 });return router;
}
