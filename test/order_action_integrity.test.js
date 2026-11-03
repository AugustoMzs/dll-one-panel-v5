import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {initOrderActions,transitionOrder,listOrderActions,allowedOrderAction} from '../src/order_actions.js';
import {editDirectOrder,initOrderEdits} from '../src/order_edits.js';

async function setup(){
  const pg=new PGlite();
  await pg.exec("CREATE TABLE panel_orders(company_id TEXT NOT NULL,order_id TEXT NOT NULL,order_state TEXT NOT NULL,payment_state TEXT NOT NULL,delivery_type TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',delivery_address TEXT NOT NULL DEFAULT '',delivery_cost NUMERIC NOT NULL DEFAULT 0,preparing_at TIMESTAMPTZ,ready_at TIMESTAMPTZ,out_for_delivery_at TIMESTAMPTZ,delivered_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(company_id,order_id)); CREATE TABLE panel_receipts(id TEXT PRIMARY KEY,company_id TEXT NOT NULL,order_id TEXT NOT NULL,state TEXT NOT NULL,reviewed_by TEXT,reviewed_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());");
  const db={query:(...args)=>pg.query(...args),connect:async()=>({query:(...args)=>pg.query(...args),release(){}})};
  await initOrderActions(db);
  await initOrderEdits(db);
  const rows=[['A','100','ESPERANDO_PAGO','PENDIENTE','DELIVERY'],['A','101','PENDIENTE_PREPARACION','EFECTIVO_AL_RETIRAR','RETIRO'],['B','100','PENDIENTE_PREPARACION','PENDIENTE','RETIRO']];
  for(const row of rows)await pg.query('INSERT INTO panel_orders(company_id,order_id,order_state,payment_state,delivery_type) VALUES($1,$2,$3,$4,$5)',row);
  await pg.query("INSERT INTO panel_receipts(id,company_id,order_id,state) VALUES('R1','A','100','PENDIENTE'),('R2','B','100','PENDIENTE')");
  return {pg,db};
}

test('comprobante, pedido y auditoría confirman juntos; otro tenant queda intacto',async()=>{
  const {pg,db}=await setup();
  try{
    const r=await transitionOrder(db,'A','100','CONFIRMAR_PAGO','operador A');
    assert.equal(r.changed,true);
    assert.equal(r.row.payment_state,'CONFIRMADO');
    assert.equal(r.row.order_state,'PENDIENTE_PREPARACION');
    const receipts=(await pg.query("SELECT company_id,state FROM panel_receipts WHERE id IN ('R1','R2') ORDER BY id")).rows;
    assert.deepEqual(receipts.map(x=>x.state),['CERRADO_PAGO','PENDIENTE']);
    const audit=await listOrderActions(db,'A','100');
    assert.equal(audit.length,1);
    assert.equal(audit[0].accion,'CONFIRMAR_PAGO');
    assert.equal(audit[0].antes.estadoPago,'PENDIENTE');
    assert.equal(audit[0].despues.estadoPago,'CONFIRMADO');
    assert.equal((await listOrderActions(db,'B','100')).length,0);
  }finally{await pg.close();}
});
test('repetir acción confirmada no duplica auditoría, no informa segundo cambio',async()=>{
  const {pg,db}=await setup();
  try{
    await transitionOrder(db,'A','100','CONFIRMAR_PAGO','A');
    const repeat=await transitionOrder(db,'A','100','CONFIRMAR_PAGO','A');
    assert.equal(repeat.changed,false);
    assert.equal((await listOrderActions(db,'A','100')).length,1);
  }finally{await pg.close();}
});
test('no puede saltarse preparación, entregar antes del envío ni regresar estados terminales',async()=>{
  const {pg,db}=await setup();
  try{
    await assert.rejects(transitionOrder(db,'A','101','ENTREGADO','A'),/transición no permitida/);
    await assert.rejects(transitionOrder(db,'A','101','EN_CAMINO','A'),/transición no permitida/);
    await transitionOrder(db,'A','101','PREPARANDO','A');
    await transitionOrder(db,'A','101','LISTO_RETIRO','A');
    await transitionOrder(db,'A','101','ENTREGADO','A');
    await assert.rejects(transitionOrder(db,'A','101','PREPARANDO','A'),/transición no permitida/);
    await assert.rejects(transitionOrder(db,'A','101','CANCELADO','A'),/transición no permitida/);
    assert.equal((await listOrderActions(db,'A','101')).length,3);
    assert.equal(allowedOrderAction({order_state:'LISTO_RETIRO',delivery_type:'DELIVERY'},'ENTREGADO'),false);
    assert.equal(allowedOrderAction({order_state:'LISTO_RETIRO',delivery_type:'DELIVERY'},'EN_CAMINO'),true);
  }finally{await pg.close();}
});
test('una operación fallida revierte estado y comprobante y no pierde el anterior',async()=>{
  const {pg,db}=await setup();
  try{
    await pg.exec('DROP TABLE panel_order_action_audit');
    await assert.rejects(transitionOrder(db,'A','100','CONFIRMAR_PAGO','A'),/panel_order_action_audit/);
    const order=(await pg.query("SELECT order_state,payment_state FROM panel_orders WHERE company_id='A' AND order_id='100'")).rows[0];
    const receipt=(await pg.query("SELECT state FROM panel_receipts WHERE id='R1'")).rows[0];
    assert.equal(order.payment_state,'PENDIENTE');assert.equal(order.order_state,'ESPERANDO_PAGO');
    assert.equal(receipt.state,'PENDIENTE');
  }finally{await pg.close();}
});
test('un cambio de estado invalida la revisión de una edición administrativa antigua',async()=>{
  const {pg,db}=await setup();
  try{
    const revision=(await pg.query("SELECT updated_at FROM panel_orders WHERE company_id='A' AND order_id='101'")).rows[0].updated_at.toISOString();
    await transitionOrder(db,'A','101','PREPARANDO','A');
    await assert.rejects(editDirectOrder(db,'A','101',{revision,observaciones:'No cambiar pedido'},'B'),/cambió en otra sesión/);
  }finally{await pg.close();}
});
test('operación ajena no puede afectar otro tenant; notas y acciones se validan',async()=>{
  const {pg,db}=await setup();
  try{
    await assert.rejects(transitionOrder(db,'B','101','PREPARANDO','B'),/Pedido no encontrado/);
    await assert.rejects(transitionOrder(db,'A','101','INVALIDA','A'),/transición no permitida/);
    await assert.rejects(transitionOrder(db,'A','101','PREPARANDO','A','x'.repeat(2001)),/Observaciones inválidas/);
    assert.equal((await listOrderActions(db,'A','101')).length,0);
  }finally{await pg.close();}
});
test('la notificación ocurre fuera de la transacción y no se duplica la edición de recibos',()=>{
 const server=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 const dbCode=readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
 assert.match(dbCode,/transitionOrder\(pool,companyId,orderId,action,operator,notes\)/);
 assert.match(server,/if \(result.changed\)/);
 assert.doesNotMatch(server,/if\(result.changed && \['CONFIRMAR_PAGO'/);
});
