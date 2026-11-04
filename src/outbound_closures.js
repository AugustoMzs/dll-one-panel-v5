import {randomUUID} from 'node:crypto';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hash=/^[a-f0-9]{64}$/;
const validText=(x,min,max,name)=>{
 if(typeof x!=='string'||x.trim().length<min||x.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x))
  throw Error(name+' inválido.');
 return x.trim();
};
export async function initOutboundClosures(db){
 await db.query("CREATE TABLE IF NOT EXISTS panel_outbound_closures (request_id UUID PRIMARY KEY,company_id TEXT NOT NULL,delivery_id TEXT NOT NULL,actor_uid BIGINT NOT NULL,note TEXT NOT NULL,request_status TEXT NOT NULL DEFAULT 'REQUESTED',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CONSTRAINT chk_outbound_closure_status CHECK(request_status IN ('REQUESTED','COMPLETED','REVIEW_REQUIRED')),CONSTRAINT chk_outbound_closure_id CHECK(delivery_id ~ '^[a-f0-9]{64}$'))");
 await db.query("CREATE INDEX IF NOT EXISTS idx_panel_outbound_closures_tenant ON panel_outbound_closures(company_id,created_at DESC)");
}
export function validateClosureInput(companyId,deliveryId,payload,actorUid){
 const company=validText(companyId,1,120,'Empresa');
 if(typeof deliveryId!=='string'||!hash.test(deliveryId))throw Error('Entrega inválida.');
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||
   Object.keys(payload).some(k=>!['requestId','note','verifiedBusinessState','verifiedCustomerContact','confirmation'].includes(k)))
    throw Error('Formulario inválido.');
 const requestId=payload.requestId||randomUUID();
 if(typeof requestId!=='string'||!uuid.test(requestId))throw Error('Solicitud inválida.');
 const note=validText(payload.note,20,600,'Justificación');
 if(payload.verifiedBusinessState!==true||payload.verifiedCustomerContact!==true||
   payload.confirmation!=='CERRAR_SIN_REENVIO')throw Error('Faltan las verificaciones obligatorias.');
 const uid=Number(actorUid);
 if(!Number.isSafeInteger(uid)||uid<=0)throw Error('Operador inválido.');
 return {companyId:company,deliveryId,requestId,note,actorUid:uid};
}
export async function registerClosureRequest(db,input){
 const {companyId,deliveryId,requestId,note,actorUid}=input;
 await db.query("INSERT INTO panel_outbound_closures(request_id,company_id,delivery_id,actor_uid,note) VALUES($1,$2,$3,$4,$5) ON CONFLICT(request_id) DO NOTHING",
   [requestId,companyId,deliveryId,actorUid,note]);
 const r=await db.query("SELECT request_id,company_id,delivery_id,actor_uid,note,request_status,created_at,updated_at FROM panel_outbound_closures WHERE request_id=$1",[requestId]);
 const row=r.rows[0];
 if(!row||row.company_id!==companyId||row.delivery_id!==deliveryId||Number(row.actor_uid)!==actorUid||row.note!==note)
   throw Error('El identificador ya corresponde a otra solicitud.');
 return {id:String(row.request_id),companyId,deliveryId,actorUid,note,status:row.request_status,createdAt:row.created_at};
}
export async function setClosureResult(db,requestId,status){
 if(!uuid.test(requestId)||!['COMPLETED','REVIEW_REQUIRED'].includes(status))throw Error('Resultado inválido.');
 const r=await db.query("UPDATE panel_outbound_closures SET request_status=CASE WHEN request_status='COMPLETED' THEN 'COMPLETED' ELSE $2 END,updated_at=NOW() WHERE request_id=$1 RETURNING request_status",[requestId,status]);
 if(!r.rowCount)throw Error('Solicitud desconocida.');
 return r.rows[0].request_status;
}
export async function listClosureRequests(db,companyId){
 const company=validText(companyId,1,120,'Empresa');
 const r=await db.query("SELECT request_id,delivery_id,actor_uid,note,request_status,created_at,updated_at FROM panel_outbound_closures WHERE company_id=$1 ORDER BY created_at DESC LIMIT 50",[company]);
 return r.rows.map(x=>({requestId:String(x.request_id),deliveryId:x.delivery_id,operatorId:String(x.actor_uid),
   note:x.note,status:x.request_status,createdAt:x.created_at,updatedAt:x.updated_at}));
}
