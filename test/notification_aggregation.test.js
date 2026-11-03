import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {getNotifications,initNotifications} from '../src/notifications.js';

async function fixture(){
  const pg=new PGlite();
  await pg.exec("CREATE TABLE panel_conversation_messages(id BIGSERIAL PRIMARY KEY,company_id TEXT NOT NULL,client_id TEXT NOT NULL,sender_type TEXT NOT NULL); CREATE TABLE panel_chat_state(company_id TEXT,client_id TEXT,mode TEXT,customer_name TEXT,updated_at TIMESTAMPTZ DEFAULT NOW()); CREATE TABLE panel_orders(id BIGSERIAL PRIMARY KEY,company_id TEXT,order_id TEXT,order_state TEXT,payment_state TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW()); CREATE TABLE panel_delivery_quotes(company_id TEXT,quote_id TEXT,state TEXT,updated_at TIMESTAMPTZ DEFAULT NOW()); CREATE TABLE panel_receipts(company_id TEXT,state TEXT,updated_at TIMESTAMPTZ DEFAULT NOW());");
  const db={query:(...a)=>pg.query(...a)};
  await initNotifications(db);
  const orders=[['A','P1','PENDIENTE_PREPARACION','PENDIENTE'],['A','P2','ENTREGADO','CONFIRMADO'],['A','P3','ENTREGADO','COMPROBANTE_RECIBIDO'],['A','P4','CANCELADO','PENDIENTE'],['A','P5','PREPARANDO','CONFIRMADO'],['B','P6','PENDIENTE_PREPARACION','PENDIENTE']];
  for(const x of orders)await pg.query('INSERT INTO panel_orders(company_id,order_id,order_state,payment_state) VALUES($1,$2,$3,$4)',x);
  for(const x of [['A','Q1','PENDIENTE'],['A','Q2','PENDIENTE'],['A','Q3','COTIZADA'],['B','Q4','PENDIENTE']])await pg.query('INSERT INTO panel_delivery_quotes(company_id,quote_id,state) VALUES($1,$2,$3)',x);
  await pg.query("INSERT INTO panel_receipts(company_id,state) VALUES('A','PENDIENTE'),('A','CERRADO_PAGO'),('B','PENDIENTE')");
  return{pg,db};
}
test('contadores comerciales agregados conservan filtros y aislamiento de empresas',async()=>{
 const {pg,db}=await fixture();
 try{
  const a=await getNotifications(db,'A','USER:1');
  assert.deepEqual(a.counts,{receipts:1,conversations:0,unread:0,human:0,orders:3,delivery:2,payments:2});
  const b=await getNotifications(db,'B','USER:1');
  assert.deepEqual(b.counts,{receipts:1,conversations:0,unread:0,human:0,orders:1,delivery:1,payments:1});
  const none=await getNotifications(db,'C','USER:1');
  assert.equal(none.counts.orders,0);
  assert.equal(none.counts.delivery,0);
  assert.equal(none.counts.payments,0);
 }finally{await pg.close();}
});
test('el cálculo no devuelve registros completos de pedidos o cotizaciones',async()=>{
 const {pg,db}=await fixture();
 try{
  const queries=[];
  const tracked={query:(sql,args)=>{queries.push(String(sql));return db.query(sql,args);}};
  const a=await getNotifications(tracked,'A','USER:1');
  assert.equal(a.counts.orders,3);
  const orders=queries.find(x=>x.includes('FROM panel_orders')&&x.includes('pending_orders'));
  const quotes=queries.find(x=>x.includes('FROM panel_delivery_quotes')&&x.includes('pending_quotes'));
  assert.ok(orders);assert.ok(quotes);
  assert.match(orders,/COUNT\(\*\)/);
  assert.match(quotes,/COUNT\(\*\)/);
  assert.doesNotMatch(orders,/SELECT order_id, customer_name/);
  assert.doesNotMatch(quotes,/SELECT quote_id,customer_name/);
 }finally{await pg.close();}
});
