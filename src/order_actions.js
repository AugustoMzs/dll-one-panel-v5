// Cambios de estado atómicos y auditados por empresa. No envía WhatsApp dentro de la transacción.
import {randomUUID} from 'node:crypto';

export async function initOrderActions(db) {
  await db.query("CREATE TABLE IF NOT EXISTS panel_order_action_audit(id TEXT PRIMARY KEY,company_id TEXT NOT NULL,order_id TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,before_data JSONB NOT NULL,after_data JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await db.query("CREATE INDEX IF NOT EXISTS idx_panel_order_action_audit_tenant ON panel_order_action_audit(company_id,order_id,created_at DESC)");
}

const invalid=(reason)=>{
  const err=new Error(reason);
  err.code='INVALID_ORDER_TRANSITION';
  return err;
};
const normalize=(s)=>String(s||'').trim().toUpperCase();
export function allowedOrderAction(row, action) {
  const state=normalize(row?.order_state);
  const payment=normalize(row?.payment_state);
  const delivery=normalize(row?.delivery_type);
  const act=normalize(action);
  if (act==='CONFIRMAR_PAGO') return state!=='CANCELADO';
  if (act==='RECHAZAR_PAGO') return ['ESPERANDO_PAGO','PENDIENTE_PREPARACION'].includes(state) && ['PENDIENTE','COMPROBANTE_RECIBIDO','RECHAZADO'].includes(payment);
  if (act==='PENDIENTE_PREPARACION') return ['ESPERANDO_PAGO','PENDIENTE_PREPARACION'].includes(state);
  if (act==='PREPARANDO') return state==='PENDIENTE_PREPARACION';
  if (act==='LISTO_RETIRO') return state==='PREPARANDO';
  if (act==='EN_CAMINO') return state==='LISTO_RETIRO' && delivery==='DELIVERY';
  if (act==='ENTREGADO') return (delivery==='DELIVERY' && state==='EN_CAMINO') ||
    (delivery!=='DELIVERY' && state==='LISTO_RETIRO');
  if (act==='CANCELADO') return state!=='ENTREGADO' && state!=='CANCELADO';
  return false;
}
function snapshot(row) {
  return {
    estadoPedido:row.order_state,
    estadoPago:row.payment_state,
    notas:row.notes,
    preparandoEl:row.preparing_at,
    listoEl:row.ready_at,
    salioEl:row.out_for_delivery_at,
    entregadoEl:row.delivered_at
  };
}
export async function transitionOrder(db, companyId, orderId, action, operator='', notes='') {
  const cid=String(companyId||'').trim(), oid=String(orderId||'').trim();
  const act=normalize(action),actor=String(operator||'').trim();
  if(!cid||!oid||!actor)throw Error('Operación incompleta.');
  if(typeof notes!=='string'||notes.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(notes))throw Error('Observaciones inválidas.');
  if(actor.length>200)throw Error('Operador inválido.');
  const newNotes=notes.trim();
  const client=await db.connect();
  let finished=false;
  try{
    await client.query('BEGIN');
    const found=await client.query('SELECT * FROM panel_orders WHERE company_id=$1 AND order_id=$2 FOR UPDATE',[cid,oid]);
    const row=found.rows[0];
    if(!row)throw Error('Pedido no encontrado.');
    if(!allowedOrderAction(row,act)){
      // Repetir una acción que ya quedó aplicada no cambia el pedido ni genera otro aviso.
      const same = (act==='CONFIRMAR_PAGO'&&normalize(row.payment_state)==='CONFIRMADO') ||
        (act==='CANCELADO'&&normalize(row.order_state)==='CANCELADO') ||
        (act===normalize(row.order_state)&&act!=='RECHAZAR_PAGO');
      if(same && !newNotes){
        await client.query('COMMIT');finished=true;return {ok:true,changed:false,action:act,operator:actor,row};
      }
      throw invalid('El pedido cambió de estado. Actualizá antes de continuar; transición no permitida.');
    }
    const before=snapshot(row),after={...before};
    const now=new Date();
    if(act==='CONFIRMAR_PAGO'){
      after.estadoPago='CONFIRMADO';
      if(!normalize(row.order_state)||normalize(row.order_state)==='ESPERANDO_PAGO')
        after.estadoPedido='PENDIENTE_PREPARACION';
    } else if(act==='RECHAZAR_PAGO'){
      after.estadoPago='RECHAZADO';after.estadoPedido='ESPERANDO_PAGO';
    } else if(act==='PENDIENTE_PREPARACION') after.estadoPedido='PENDIENTE_PREPARACION';
    else if(act==='PREPARANDO'){after.estadoPedido='PREPARANDO';after.preparandoEl ||= now;}
    else if(act==='LISTO_RETIRO'){after.estadoPedido='LISTO_RETIRO';after.listoEl ||= now;}
    else if(act==='EN_CAMINO'){after.estadoPedido='EN_CAMINO';after.salioEl ||= now;}
    else if(act==='ENTREGADO'){after.estadoPedido='ENTREGADO';after.entregadoEl ||= now;}
    else if(act==='CANCELADO')after.estadoPedido='CANCELADO';
    if(newNotes) after.notas=newNotes;
    const changed=Object.keys(before).some(k=>String(before[k]??'')!==String(after[k]??''));
    if(!changed){
      await client.query('COMMIT');finished=true;return {ok:true,changed:false,action:act,operator:actor,row};
    }
    const updated=await client.query(
      "UPDATE panel_orders SET payment_state=$3,order_state=$4,notes=$5,preparing_at=$6,ready_at=$7,out_for_delivery_at=$8,delivered_at=$9,updated_at=GREATEST(NOW(),updated_at+interval '1 millisecond') WHERE company_id=$1 AND order_id=$2 RETURNING *",
      [cid,oid,after.estadoPago,after.estadoPedido,after.notas,after.preparandoEl,after.listoEl,after.salioEl,after.entregadoEl]
    );
    // El comprobante debe avanzar junto al estado del pedido, nunca en una segunda operación sin transacción.
    if(['CONFIRMAR_PAGO','RECHAZAR_PAGO','CANCELADO'].includes(act)){
      await client.query(
        "UPDATE panel_receipts SET state=$3,reviewed_by=$4,reviewed_at=NOW(),updated_at=NOW() WHERE company_id=$1 AND order_id=$2 AND state='PENDIENTE'",
        [cid,oid,act==='CONFIRMAR_PAGO'?'CERRADO_PAGO':'ARCHIVADO',actor]
      );
    }
    await client.query(
      'INSERT INTO panel_order_action_audit(id,company_id,order_id,actor,action,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [randomUUID(),cid,oid,actor,act,JSON.stringify(before),JSON.stringify(after)]
    );
    await client.query('COMMIT');finished=true;
    return {ok:true,changed:true,action:act,operator:actor,row:updated.rows[0]};
  }catch(error){
    if(!finished) await client.query('ROLLBACK');
    throw error;
  }finally{client.release();}
}
export async function listOrderActions(db,companyId,orderId){
  const result=await db.query(
    'SELECT id,action,actor,before_data,after_data,created_at FROM panel_order_action_audit WHERE company_id=$1 AND order_id=$2 ORDER BY created_at DESC LIMIT 50',
    [companyId,orderId]
  );
  return result.rows.map(x=>({id:x.id,accion:x.action,operador:x.actor,antes:x.before_data,despues:x.after_data,fecha:x.created_at}));
}
