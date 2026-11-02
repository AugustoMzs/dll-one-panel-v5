// Edición administrativa de entrega y notas sin cambiar importes o estados de pago.
import {randomUUID} from 'node:crypto';
export async function initOrderEdits(db){
  await db.query("CREATE TABLE IF NOT EXISTS panel_order_edits(edit_id TEXT PRIMARY KEY,company_id TEXT NOT NULL,order_id TEXT NOT NULL,operator TEXT NOT NULL,before_data JSONB NOT NULL,after_data JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await db.query("CREATE INDEX IF NOT EXISTS idx_panel_order_edits_tenant ON panel_order_edits(company_id,order_id,created_at DESC)");
}
const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
function bounded(value,max,label){
  if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
    throw Error('Valor inválido: '+label);
  return value.trim();
}
export function editableOrderState(state){
  return !['ENTREGADO','CANCELADO','EN_CAMINO'].includes(String(state||'').trim().toUpperCase());
}
function snapshot(row){
  return {tipoEntrega:String(row.delivery_type||''),direccion:String(row.delivery_address||''),observaciones:String(row.notes||'')};
}
export async function editDirectOrder(db,companyId,orderId,data,operator){
  if(!String(companyId||'').trim()||!String(orderId||'').trim()||!String(operator||'').trim())throw Error('Datos incompletos.');
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Solicitud de edición inválida.');
  const allowed=new Set(['revision','tipoEntrega','direccion','observaciones']);
  if(Object.keys(data).some(key=>!allowed.has(key)))throw Error('Campo de edición no autorizado.');
  if(!['tipoEntrega','direccion','observaciones'].some(key=>own(data,key)))throw Error('No se solicitaron cambios.');
  if(typeof data.revision!=='string'||!data.revision||!Number.isFinite(Date.parse(data.revision)))throw Error('Recargá el pedido antes de editar.');
  const actor=bounded(operator,200,'operador');
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    const {rows}=await client.query(
      'SELECT * FROM panel_orders WHERE company_id=$1 AND order_id=$2 FOR UPDATE',
      [companyId,orderId]
    );
    const row=rows[0];
    if(!row)throw Error('Pedido no encontrado para esta empresa.');
    if(new Date(row.updated_at).getTime()!==Date.parse(data.revision)){
      const err=Error('El pedido cambió en otra sesión. Actualizá antes de guardar.');
      err.code='ORDER_CONFLICT';throw err;
    }
    if(!editableOrderState(row.order_state))throw Error('No se puede editar un pedido despachado, entregado o cancelado.');
    const before=snapshot(row);
    const tipoEntrega=own(data,'tipoEntrega')?bounded(data.tipoEntrega,30,'tipo de entrega').toUpperCase():before.tipoEntrega;
    if(!['RETIRO','DELIVERY'].includes(tipoEntrega))throw Error('El pedido debe tener retiro o delivery.');
    let direccion=own(data,'direccion')?bounded(data.direccion,500,'dirección'):before.direccion;
    const observaciones=own(data,'observaciones')?bounded(data.observaciones,2000,'observaciones'):before.observaciones;
    const changedDelivery=tipoEntrega!==before.tipoEntrega.toUpperCase();
    if(changedDelivery&&Number(row.delivery_cost||0)!==0)
      throw Error('Hay un costo de envío en el pedido. No cambies la modalidad sin conciliar antes el total.');
    if(tipoEntrega==='DELIVERY'&&!direccion)throw Error('Ingresá la dirección de entrega para delivery.');
    if(tipoEntrega==='RETIRO')direccion='';
    const after={tipoEntrega,direccion,observaciones};
    if(JSON.stringify(before)===JSON.stringify(after)){
      await client.query('COMMIT');
      return {ok:true,changed:false};
    }
    const update=await client.query(
      "UPDATE panel_orders SET delivery_type=$3,delivery_address=$4,notes=$5,updated_at=GREATEST(NOW(),updated_at+interval '1 millisecond') WHERE company_id=$1 AND order_id=$2 RETURNING updated_at",
      [companyId,orderId,tipoEntrega,direccion,observaciones]
    );
    await client.query(
      'INSERT INTO panel_order_edits(edit_id,company_id,order_id,operator,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(),companyId,orderId,actor,JSON.stringify(before),JSON.stringify(after)]
    );
    await client.query('COMMIT');
    return {ok:true,changed:true,actualizadoEl:update.rows[0].updated_at,before,after};
  }catch(err){
    await client.query('ROLLBACK');throw err;
  }finally{client.release();}
}
export async function listOrderEdits(db,companyId,orderId){
  const result=await db.query(
    "SELECT edit_id,operator,before_data,after_data,created_at FROM panel_order_edits WHERE company_id=$1 AND order_id=$2 ORDER BY created_at DESC LIMIT 30",
    [companyId,orderId]
  );
  return result.rows.map(x=>({id:x.edit_id,operador:x.operator,antes:x.before_data,despues:x.after_data,fecha:x.created_at}));
}
