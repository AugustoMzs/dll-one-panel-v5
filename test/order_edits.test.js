import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {initOrderEdits,editDirectOrder,listOrderEdits,editableOrderState} from '../src/order_edits.js';

async function setup(){
 const pg=new PGlite();
 await pg.exec("CREATE TABLE panel_orders(company_id TEXT NOT NULL,order_id TEXT NOT NULL,order_state TEXT NOT NULL,delivery_type TEXT NOT NULL,delivery_address TEXT NOT NULL,notes TEXT NOT NULL,delivery_cost NUMERIC(14,2) NOT NULL DEFAULT 0,total NUMERIC(14,2) NOT NULL DEFAULT 2000,payment_state TEXT NOT NULL DEFAULT 'PENDIENTE',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(company_id,order_id))");
 const db={query:(...args)=>pg.query(...args),connect:async()=>({query:(...args)=>pg.query(...args),release(){}})};
 await initOrderEdits(db);
 const rows=[['A','P-1','PREPARANDO','RETIRO','',0],['A','P-2','PREPARANDO','DELIVERY','Calle 100',500],['A','P-3','ENTREGADO','RETIRO','',0],['B','P-1','PREPARANDO','RETIRO','',0]];
 for(const [c,id,state,type,address,cost] of rows)await pg.query('INSERT INTO panel_orders(company_id,order_id,order_state,delivery_type,delivery_address,notes,delivery_cost) VALUES($1,$2,$3,$4,$5,$6,$7)',[c,id,state,type,address,'',cost]);
 const revision=async(c,id)=>(await pg.query('SELECT updated_at FROM panel_orders WHERE company_id=$1 AND order_id=$2',[c,id])).rows[0].updated_at.toISOString();
 return {db,pg,revision};
}
test('edita solo el pedido autorizado, crea auditoría y no altera dinero',async()=>{
 const {pg,db,revision}=await setup();
 try{
 const old=await revision('A','P-1');
 const result=await editDirectOrder(db,'A','P-1',{revision:old,tipoEntrega:'DELIVERY',direccion:'Belgrano 123',observaciones:'Llamar al llegar'},'Operador A');
 assert.equal(result.changed,true);
 const order=(await pg.query("SELECT * FROM panel_orders WHERE company_id='A' AND order_id='P-1'")).rows[0];
 assert.equal(order.delivery_type,'DELIVERY');assert.equal(order.delivery_address,'Belgrano 123');
 assert.equal(Number(order.total),2000);assert.equal(order.payment_state,'PENDIENTE');assert.equal(Number(order.delivery_cost),0);
 assert.equal((await pg.query("SELECT delivery_type FROM panel_orders WHERE company_id='B' AND order_id='P-1'")).rows[0].delivery_type,'RETIRO');
 const history=await listOrderEdits(db,'A','P-1');
 assert.equal(history.length,1);assert.equal(history[0].operador,'Operador A');assert.equal(history[0].antes.tipoEntrega,'RETIRO');
 assert.deepEqual(await listOrderEdits(db,'B','P-1'),[]);
 const unchanged=await editDirectOrder(db,'A','P-1',{revision:(await revision('A','P-1')),tipoEntrega:'DELIVERY',direccion:'Belgrano 123',observaciones:'Llamar al llegar'},'Operador A');
 assert.equal(unchanged.changed,false);assert.equal((await listOrderEdits(db,'A','P-1')).length,1);
 }finally{await pg.close();}
});
test('concurrencia: no se pisan ediciones anteriores ni se agregan logs erróneos',async()=>{
 const {pg,db,revision}=await setup();
 try{
 const old=await revision('A','P-1');
 await editDirectOrder(db,'A','P-1',{revision:old,observaciones:'Primera edición'},'A');
 await assert.rejects(editDirectOrder(db,'A','P-1',{revision:old,observaciones:'Segunda edición'},'B'),/cambió en otra sesión/);
 assert.equal((await listOrderEdits(db,'A','P-1')).length,1);
 }finally{await pg.close();}
});
test('rechaza pedidos terminales, costos de delivery y dirección inválida',async()=>{
 const {pg,db,revision}=await setup();
 try{
 assert.equal(editableOrderState('EN_CAMINO'),false);
 await assert.rejects(editDirectOrder(db,'A','P-3',{revision:await revision('A','P-3'),observaciones:'No'},'Admin'),/despachado/);
 await assert.rejects(editDirectOrder(db,'A','P-2',{revision:await revision('A','P-2'),tipoEntrega:'RETIRO'},'Admin'),/costo de envío/);
 await assert.rejects(editDirectOrder(db,'A','P-1',{revision:await revision('A','P-1'),tipoEntrega:'DELIVERY',direccion:''},'Admin'),/dirección/);
 await assert.rejects(editDirectOrder(db,'A','P-1',{revision:await revision('A','P-1'),observaciones:'A'.repeat(2001)},'Admin'),/Valor inválido/);
 await assert.rejects(editDirectOrder(db,'A','P-1',{revision:await revision('A','P-1'),observaciones:'Hola',total:0},'Admin'),/no autorizado/);
 await assert.rejects(editDirectOrder(db,'A','NO-EXISTE',{revision:await revision('A','P-1'),observaciones:'Hola'},'Admin'),/no encontrado/);
 assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM panel_order_edits')).rows[0].n,0);
 }finally{await pg.close();}
});
test('el endpoint exige permisos y la interfaz no toca Dashboard',()=>{
 const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(source,/pedidos\/:orderId\/edit'[\s\S]{0,65}authRequired, canOperate/);
 assert.match(source,/pedidos\/:orderId\/edits'[\s\S]{0,65}authRequired, companyAccessRequired/);
 assert.match(source,/"\/api\/company\/:companyId\/pedidos",\s*authRequired, companyAccessRequired/);
 assert.match(ui,/id="orderEditDialog"/);assert.match(ui,/openOrderEditByButton/);
 assert.match(ui,/requestedCompany!==companyId/);
});
