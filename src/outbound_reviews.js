// Internal, tenant-scoped operator observations.
// No action changes a WhatsApp send, an order, a payment or a pending job.
const HASH=/^[a-f0-9]{64}$/;
const FINDINGS=new Set(['EN_REVISION','INDICIOS_DE_ACEPTACION','NO_SE_PUDO_VERIFICAR']);
const checkId=id=>{
 if(typeof id!=='string'||!HASH.test(id))throw Error('Identificador de entrega inválido.');
 return id;
};
const checkCompany=id=>{
 if(typeof id!=='string'||!id.trim()||id.length>120)throw Error('Empresa inválida.');
 return id;
};
export async function initOutboundReviewNotes(db){
 await db.query("CREATE TABLE IF NOT EXISTS panel_outbound_review_notes (id BIGSERIAL PRIMARY KEY,company_id TEXT NOT NULL,delivery_id TEXT NOT NULL,finding TEXT NOT NULL,note TEXT NOT NULL,actor TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CONSTRAINT chk_outbound_review_finding CHECK(finding IN ('EN_REVISION','INDICIOS_DE_ACEPTACION','NO_SE_PUDO_VERIFICAR')),CONSTRAINT chk_outbound_delivery_hash CHECK(delivery_id ~ '^[a-f0-9]{64}$'))");
 await db.query("CREATE INDEX IF NOT EXISTS idx_outbound_review_notes_tenant ON panel_outbound_review_notes(company_id,delivery_id,created_at DESC,id DESC)");
}
export async function addOutboundReviewNote(db,companyId,deliveryId,payload,actor){
 const company=checkCompany(companyId),id=checkId(deliveryId);
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||
   Object.keys(payload).some(k=>!['finding','note'].includes(k)))throw Error('Formulario inválido.');
 if(!FINDINGS.has(payload.finding))throw Error('Tipo de revisión inválido.');
 if(typeof payload.note!=='string'||payload.note.trim().length<10||payload.note.length>600||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(payload.note))throw Error('Describí la revisión realizada (10 a 600 caracteres).');
 const operator=String(actor||'').trim();
 if(!operator||operator.length>200)throw Error('Operador inválido.');
 const r=await db.query("INSERT INTO panel_outbound_review_notes(company_id,delivery_id,finding,note,actor) VALUES($1,$2,$3,$4,$5) RETURNING id,finding,note,actor,created_at",
  [company,id,payload.finding,payload.note.trim(),operator]);
 return {id:r.rows[0].id,resultado:r.rows[0].finding,observacion:r.rows[0].note,operador:r.rows[0].actor,fecha:r.rows[0].created_at};
}
export async function latestOutboundReviewNotes(db,companyId,deliveryIds){
 const company=checkCompany(companyId);
 if(!Array.isArray(deliveryIds)||deliveryIds.length>100||deliveryIds.some(x=>!HASH.test(x)))
   throw Error('Listado de entregas inválido.');
 if(!deliveryIds.length)return {};
 const r=await db.query("SELECT DISTINCT ON (delivery_id) delivery_id,finding,note,actor,created_at FROM panel_outbound_review_notes WHERE company_id=$1 AND delivery_id=ANY($2::text[]) ORDER BY delivery_id,created_at DESC,id DESC",[company,deliveryIds]);
 return Object.fromEntries(r.rows.map(x=>[x.delivery_id,{
  resultado:x.finding,observacion:x.note,operador:x.actor,fecha:x.created_at
 }]));
}
export async function outboundReviewHistory(db,companyId,deliveryId){
 const company=checkCompany(companyId),id=checkId(deliveryId);
 const r=await db.query("SELECT id,finding,note,actor,created_at FROM panel_outbound_review_notes WHERE company_id=$1 AND delivery_id=$2 ORDER BY created_at DESC,id DESC LIMIT 50",[company,id]);
 return r.rows.map(x=>({id:x.id,resultado:x.finding,observacion:x.note,operador:x.actor,fecha:x.created_at}));
}
