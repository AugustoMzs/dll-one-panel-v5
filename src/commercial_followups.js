// Native commercial follow-ups: tenant-scoped, transactional and never sends outbound messages.
import { randomUUID } from 'node:crypto';

const STATES=new Set(['ABIERTA','CONTACTAR','EN_ESPERA','GANADA','PERDIDA']);
function text(value,max,label,{required=false}={}){
 if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw Error('Valor inválido: '+label);
 const out=value.trim();if(required&&!out)throw Error('Falta '+label);
 return out;
}
function nextDate(v){
 if(v===null||v==='')return null;
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(v)||!Number.isFinite(Date.parse(v)))throw Error('Fecha de seguimiento inválida.');
 const date=new Date(v);
 if(date.getTime()>Date.now()+2*365*86400000||date.getTime()<Date.now()-365*86400000)throw Error('Fecha de seguimiento fuera de rango.');
 return date.toISOString();
}
function expiryDate(value){
 if(value===null||value==='')return null;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value)||!Number.isFinite(Date.parse(value)))
   throw Error('Fecha de vencimiento inválida.');
 const parsed=new Date(value);
 if(parsed.getTime()<Date.now()-365*86400000 || parsed.getTime()>Date.now()+2*365*86400000)
   throw Error('Fecha de vencimiento fuera de rango.');
 return parsed.toISOString();
}
function money(value){
 if(value===null||value===''||value===undefined)return null;
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>999999999999.99||!/^[0-9]{1,12}(?:\.[0-9]{1,2})?$/.test(String(value)))throw Error('Importe inválido.');
 return value;
}
const cleanState=s=>{
 if(typeof s!=='string'||!STATES.has(s))throw Error('Estado comercial inválido.');
 return s;
};
function normalize(row){
 return {id:row.id,clienteId:row.client_id,nombre:row.customer_name,asunto:row.subject,observaciones:row.notes,
 estado:row.state,importe:row.amount==null?null:Number(row.amount),
 seguimientoEl:row.followup_at,venceEl:row.expires_at??null,esPresupuesto:row.is_quote===true||row.expires_at!=null,revision:row.revision,creadoEl:row.created_at,actualizadoEl:row.updated_at};
}
export async function initCommercialFollowups(db){
 await db.query("CREATE TABLE IF NOT EXISTS panel_commercial_followups (id TEXT PRIMARY KEY,company_id TEXT NOT NULL,client_id TEXT NOT NULL DEFAULT '',customer_name TEXT NOT NULL,subject TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'ABIERTA',amount NUMERIC(14,2),followup_at TIMESTAMPTZ,revision INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CONSTRAINT chk_commercial_followup_state CHECK(state IN ('ABIERTA','CONTACTAR','EN_ESPERA','GANADA','PERDIDA')),CONSTRAINT chk_commercial_followup_amount CHECK(amount IS NULL OR (amount>=0 AND amount<=999999999999.99)))");
 await db.query("ALTER TABLE panel_commercial_followups ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ");
 await db.query("ALTER TABLE panel_commercial_followups ADD COLUMN IF NOT EXISTS is_quote BOOLEAN NOT NULL DEFAULT FALSE");
 await db.query("CREATE INDEX IF NOT EXISTS idx_panel_commercial_followups_company_date ON panel_commercial_followups(company_id,state,followup_at,created_at DESC)");
 await db.query("CREATE INDEX IF NOT EXISTS idx_panel_commercial_followups_expiry ON panel_commercial_followups(company_id,expires_at) WHERE state IN ('ABIERTA','CONTACTAR','EN_ESPERA')");
 await db.query("CREATE TABLE IF NOT EXISTS panel_commercial_followup_audit (id TEXT PRIMARY KEY,company_id TEXT NOT NULL,followup_id TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,before_data JSONB,after_data JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 await db.query("CREATE INDEX IF NOT EXISTS idx_panel_commercial_followup_audit_tenant ON panel_commercial_followup_audit(company_id,followup_id,created_at DESC)");
}
export async function listCommercialFollowups(db,companyId,filter='PENDIENTES',offset=0){
 const cid=text(companyId,120,'empresa',{required:true});
 if(!['PENDIENTES','TODOS','GANADA','PERDIDA','SEGUIMIENTOS_ATRASADOS','PRESUPUESTOS_VENCIDOS','POR_VENCER'].includes(filter))throw Error('Filtro inválido.');
 if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw Error('Página inválida.');
 const active="AND state IN ('ABIERTA','CONTACTAR','EN_ESPERA')";
 const where=filter==='PENDIENTES'?active:
   filter==='TODOS'?'':
   filter==='SEGUIMIENTOS_ATRASADOS'?active+' AND followup_at IS NOT NULL AND followup_at<NOW()':
   filter==='PRESUPUESTOS_VENCIDOS'?active+' AND expires_at IS NOT NULL AND expires_at<NOW()':
   filter==='POR_VENCER'?active+" AND expires_at>=NOW() AND expires_at<NOW()+interval '48 hours'":
   'AND state=$2';
 const params=['GANADA','PERDIDA'].includes(filter)?[cid,filter]:[cid];
 const selectionParams=[...params,offset];
 const offsetParam='$'+selectionParams.length;
 const [result,total]=await Promise.all([
  db.query("SELECT * FROM panel_commercial_followups WHERE company_id=$1 "+where+
    " ORDER BY followup_at ASC NULLS LAST,created_at DESC,id ASC LIMIT 100 OFFSET "+offsetParam,selectionParams),
  db.query("SELECT COUNT(*)::int AS n FROM panel_commercial_followups WHERE company_id=$1 "+where,params)
 ]);
 return {items:result.rows.map(normalize),total:Number(total.rows[0]?.n||0),limit:100,offset};
}
export async function createCommercialFollowup(db,companyId,input,actor){
 const cid=text(companyId,120,'empresa',{required:true}),operator=text(actor,200,'operador',{required:true});
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Formulario inválido.');
 if(Object.keys(input).some(k=>!['clienteId','nombre','asunto','observaciones','importe','seguimientoEl','venceEl','esPresupuesto'].includes(k)))throw Error('Campo no autorizado.');
 if(Object.hasOwn(input,'esPresupuesto')&&typeof input.esPresupuesto!=='boolean')throw Error('Indicador de presupuesto inválido.');
 const isQuote=input.esPresupuesto===true || Boolean(input.venceEl);
 const obj={clienteId:text(input.clienteId??'',120,'cliente'),nombre:text(input.nombre,200,'nombre',{required:true}),
 asunto:text(input.asunto,250,'asunto',{required:true}),observaciones:text(input.observaciones??'',1500,'observaciones'),
 importe:money(input.importe),seguimientoEl:nextDate(input.seguimientoEl??null),venceEl:expiryDate(input.venceEl??null)};
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  const id=randomUUID();
  // Solo presupuestos nuevos sin fecha explícita heredan la vigencia configurada en su empresa.
  if(isQuote && !obj.venceEl){
    const company=(await client.query('SELECT config FROM panel_companies WHERE company_id=$1',[cid])).rows[0];
    if(!company)throw Error('Empresa no encontrada.');
    const rawDays=company.config?.VALIDEZ_PRESUPUESTO_DIAS??0;
    const days=Number(rawDays);
    if(!Number.isSafeInteger(days)||days<0||days>365)throw Error('Vigencia del negocio inválida.');
    if(days>0)obj.venceEl=new Date(Date.now()+days*86400000).toISOString();
  }
  const result=await client.query(
   "INSERT INTO panel_commercial_followups(id,company_id,client_id,customer_name,subject,notes,amount,followup_at,expires_at,is_quote) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
   [id,cid,obj.clienteId,obj.nombre,obj.asunto,obj.observaciones,obj.importe,obj.seguimientoEl,obj.venceEl,isQuote]);
  const created=normalize(result.rows[0]);
  await client.query("INSERT INTO panel_commercial_followup_audit(id,company_id,followup_id,actor,action,before_data,after_data) VALUES($1,$2,$3,$4,'CREADA',NULL,$5)",[randomUUID(),cid,id,operator,JSON.stringify(created)]);
  await client.query('COMMIT');
  return created;
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export async function updateCommercialFollowup(db,companyId,id,input,actor){
 const cid=text(companyId,120,'empresa',{required:true}),fid=text(id,120,'oportunidad',{required:true}),operator=text(actor,200,'operador',{required:true});
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Actualización inválida.');
 if(Object.keys(input).some(k=>!['revision','estado','observaciones','seguimientoEl','venceEl'].includes(k)))throw Error('Campo no autorizado.');
 if(!Number.isSafeInteger(input.revision)||input.revision<0)throw Error('Recargá la oportunidad.');
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  const result=await client.query("SELECT * FROM panel_commercial_followups WHERE company_id=$1 AND id=$2 FOR UPDATE",[cid,fid]);
  const row=result.rows[0];
  if(!row)throw Error('Oportunidad no encontrada para esta empresa.');
  if(row.revision!==input.revision){const err=Error('Otro operador modificó la oportunidad. Recargá antes de continuar.');err.code='STALE_FOLLOWUP';throw err;}
  if(!Object.keys(input).some(k=>['estado','observaciones','seguimientoEl','venceEl'].includes(k)))throw Error('No se solicitaron cambios.');
  const estado=Object.hasOwn(input,'estado')?cleanState(input.estado):row.state;
  const notas=Object.hasOwn(input,'observaciones')?text(input.observaciones,1500,'observaciones'):row.notes;
  const fecha=Object.hasOwn(input,'seguimientoEl')?nextDate(input.seguimientoEl):row.followup_at;
  const vencimiento=Object.hasOwn(input,'venceEl')?expiryDate(input.venceEl):row.expires_at;
  const normalizedDate=value=>value?new Date(value).toISOString():null;
  const before=normalize(row);
  if(estado===row.state&&notas===row.notes&&normalizedDate(fecha)===normalizedDate(row.followup_at)&&normalizedDate(vencimiento)===normalizedDate(row.expires_at)){
    await client.query('COMMIT');return {changed:false,item:before};
  }
  const updated=await client.query(
   "UPDATE panel_commercial_followups SET state=$3,notes=$4,followup_at=$5,expires_at=$6,is_quote=$7,revision=revision+1,updated_at=NOW() WHERE company_id=$1 AND id=$2 RETURNING *",
   [cid,fid,estado,notas,fecha,vencimiento,row.is_quote===true||vencimiento!=null]);
  const item=normalize(updated.rows[0]);
  await client.query("INSERT INTO panel_commercial_followup_audit(id,company_id,followup_id,actor,action,before_data,after_data) VALUES($1,$2,$3,$4,'ACTUALIZADA',$5,$6)",[randomUUID(),cid,fid,operator,JSON.stringify(before),JSON.stringify(item)]);
  await client.query('COMMIT');
  return {changed:true,item};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export async function commercialFollowupHistory(db,companyId,id){
 const result=await db.query("SELECT actor,action,before_data,after_data,created_at FROM panel_commercial_followup_audit WHERE company_id=$1 AND followup_id=$2 ORDER BY created_at DESC LIMIT 50",[companyId,id]);
 return result.rows.map(x=>({operador:x.actor,accion:x.action,antes:x.before_data,despues:x.after_data,fecha:x.created_at}));
}

export async function getCommercialReminders(db,companyId){
 const cid=text(companyId,120,'empresa',{required:true});
 // Recordatorios visibles en el panel. Nunca envía mensajes, ni cambia estados de ventas.
 const result=await db.query(
   "SELECT COUNT(*) FILTER (WHERE followup_at IS NOT NULL AND followup_at<NOW())::int AS overdue_followups, "+
   "COUNT(*) FILTER (WHERE followup_at>=NOW() AND followup_at<NOW()+interval '48 hours')::int AS upcoming_followups, "+
   "COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at<NOW())::int AS expired_quotes, "+
   "COUNT(*) FILTER (WHERE expires_at>=NOW() AND expires_at<NOW()+interval '48 hours')::int AS expiring_quotes "+
   "FROM panel_commercial_followups WHERE company_id=$1 AND state IN ('ABIERTA','CONTACTAR','EN_ESPERA')",
   [cid]
 );
 const r=result.rows[0]||{};
 return {seguimientosAtrasados:Number(r.overdue_followups||0),seguimientosProximos48h:Number(r.upcoming_followups||0),presupuestosVencidos:Number(r.expired_quotes||0),presupuestosPorVencer48h:Number(r.expiring_quotes||0)};
}
