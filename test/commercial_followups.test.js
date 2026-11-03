import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {initCommercialFollowups,createCommercialFollowup,updateCommercialFollowup,listCommercialFollowups,commercialFollowupHistory,getCommercialReminders} from '../src/commercial_followups.js';

async function setup(){
  const pg=new PGlite();
  const db={query:(...a)=>pg.query(...a),connect:async()=>({query:(...a)=>pg.query(...a),release(){}})};
  await initCommercialFollowups(db);
  return {pg,db};
}
const input=(name='Claudia')=>({nombre:name,clienteId:'549260000001',asunto:'Presupuesto de servicios',observaciones:'Consultar stock',importe:1234.5,seguimientoEl:new Date(Date.now()+3*86400000).toISOString()});

test('alta y actualización son nativas, auditadas y no cruzan negocios',async()=>{
 const {pg,db}=await setup();
 try{
   const a=await createCommercialFollowup(db,'empresa-A',input(),'operador-A');
   const b=await createCommercialFollowup(db,'empresa-B',input('Berta'),'operador-B');
   assert.equal(a.revision,0);
   assert.equal((await listCommercialFollowups(db,'empresa-A')).total,1);
   assert.equal((await listCommercialFollowups(db,'empresa-B')).items[0].nombre,'Berta');
   assert.equal((await listCommercialFollowups(db,'empresa-A')).items[0].nombre,'Claudia');
   await assert.rejects(updateCommercialFollowup(db,'empresa-B',a.id,{revision:0,estado:'GANADA'},'operador-B'),/no encontrada/);
   const updated=await updateCommercialFollowup(db,'empresa-A',a.id,{revision:0,estado:'CONTACTAR',observaciones:'Enviar propuesta',seguimientoEl:null},'operador-A');
   assert.equal(updated.changed,true);
   assert.equal(updated.item.revision,1);
   assert.equal(updated.item.estado,'CONTACTAR');
   assert.equal(updated.item.seguimientoEl,null);
   assert.equal((await commercialFollowupHistory(db,'empresa-A',a.id)).length,2);
   assert.equal((await commercialFollowupHistory(db,'empresa-B',a.id)).length,0);
   assert.equal((await commercialFollowupHistory(db,'empresa-B',b.id)).length,1);
   await assert.rejects(updateCommercialFollowup(db,'empresa-A',a.id,{revision:0,estado:'GANADA'},'operador-A'),/modificó/);
   assert.equal((await listCommercialFollowups(db,'empresa-A')).items[0].estado,'CONTACTAR');
   const again=await updateCommercialFollowup(db,'empresa-A',a.id,{revision:1,estado:'CONTACTAR',observaciones:'Enviar propuesta',seguimientoEl:null},'operador-A');
   assert.equal(again.changed,false);
   assert.equal((await commercialFollowupHistory(db,'empresa-A',a.id)).length,2);
 }finally{await pg.close();}
});

test('filtros y conteos se calculan por empresa, sin traer más de 100 filas',async()=>{
 const {pg,db}=await setup();
 try{
   const ids=[];
   for(let i=0;i<4;i++)ids.push((await createCommercialFollowup(db,'A',input('Nombre '+i),'o')).id);
   await updateCommercialFollowup(db,'A',ids[0],{revision:0,estado:'GANADA'},'o');
   await updateCommercialFollowup(db,'A',ids[1],{revision:0,estado:'PERDIDA'},'o');
   await createCommercialFollowup(db,'B',input('Otra empresa'),'o');
   assert.equal((await listCommercialFollowups(db,'A','PENDIENTES')).total,2);
   assert.equal((await listCommercialFollowups(db,'A','TODOS')).total,4);
   assert.equal((await listCommercialFollowups(db,'A','GANADA')).total,1);
   assert.equal((await listCommercialFollowups(db,'A','PERDIDA')).total,1);
   assert.equal((await listCommercialFollowups(db,'B','TODOS')).total,1);
   await assert.rejects(listCommercialFollowups(db,'A','INCORRECTO'),/Filtro inválido/);
 }finally{await pg.close();}
});

test('validación estricta de dinero, texto, fecha, campos y versiones',async()=>{
 const {pg,db}=await setup();
 try{
   await assert.rejects(createCommercialFollowup(db,'A',{...input(),importe:-1},'o'),/Importe inválido/);
   await assert.rejects(createCommercialFollowup(db,'A',{...input(),importe:1.123},'o'),/Importe inválido/);
   await assert.rejects(createCommercialFollowup(db,'A',{...input(),nombre:''},'o'),/Falta nombre/);
   await assert.rejects(createCommercialFollowup(db,'A',{...input(),asunto:'a'.repeat(251)},'o'),/Valor inválido/);
   await assert.rejects(createCommercialFollowup(db,'A',{...input(),seguimientoEl:'not-date'},'o'),/Fecha de seguimiento/);
   await assert.rejects(createCommercialFollowup(db,'A',{...input(),secret:'x'},'o'),/no autorizado/);
   const a=await createCommercialFollowup(db,'A',input(),'o');
   await assert.rejects(updateCommercialFollowup(db,'A',a.id,{revision:0,estado:'IMPAGO'},'o'),/Estado comercial/);
   await assert.rejects(updateCommercialFollowup(db,'A',a.id,{revision:0,observaciones:'x',importe:1},'o'),/no autorizado/);
   await assert.rejects(updateCommercialFollowup(db,'A',a.id,{revision:-1,estado:'GANADA'},'o'),/Recargá/);
   assert.equal((await commercialFollowupHistory(db,'A',a.id)).length,1);
 }finally{await pg.close();}
});

test('API exige permisos, interfaz escapa contenido y no envía WhatsApp automáticamente',()=>{
 const server=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(server,/commercial\/followups',authRequired,canOperate/);
 assert.match(server,/commercial\/followups',authRequired,companyAccessRequired/);
 assert.match(server,/commercial\/followups\/:id',authRequired,canOperate/);
 assert.match(html,/id="commercial"/);
 assert.match(html,/loadCommercialFollowups/);
 assert.match(html,/esc\(o\.asunto\)/);
 assert.match(html,/esc\(o\.nombre\)/);
 assert.doesNotMatch(server,/commercial\/followups[\s\S]{0,500}postMotor\(/);
});

test('el JavaScript principal incrustado en el panel compila',async()=>{
 const {Script}=await import('node:vm');
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
 assert.equal(scripts.length,1);
 assert.doesNotThrow(()=>new Script(scripts[0][1],{filename:'public/index.html'}));
});

test('100 registros por página, orden estable y conteo total por empresa',async()=>{
 const {pg,db}=await setup();
 try{
   await pg.exec("INSERT INTO panel_commercial_followups(id,company_id,customer_name,subject,state,notes) SELECT 'bulk-'||g::text,'A','Cliente '||g::text,'Presupuesto','ABIERTA','' FROM generate_series(1,105) g");
   await createCommercialFollowup(db,'B',input('B'),'operador');
   const first=await listCommercialFollowups(db,'A','PENDIENTES',0);
   const second=await listCommercialFollowups(db,'A','PENDIENTES',100);
   assert.equal(first.total,105);assert.equal(first.limit,100);assert.equal(first.offset,0);
   assert.equal(first.items.length,100);
   assert.equal(second.total,105);assert.equal(second.items.length,5);assert.equal(second.offset,100);
   const ids=new Set([...first.items,...second.items].map(x=>x.id));
   assert.equal(ids.size,105);
   assert.equal((await listCommercialFollowups(db,'B','PENDIENTES',0)).total,1);
   await assert.rejects(listCommercialFollowups(db,'A','PENDIENTES',-100),/Página inválida/);
   await assert.rejects(listCommercialFollowups(db,'A','PENDIENTES','100'),/Página inválida/);
 }finally{await pg.close();}
});
test('la interfaz puede avanzar, retroceder, cambiar filtros y descartar páginas antiguas',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 assert.match(html,/id="commercialPrevious"/);
 assert.match(html,/id="commercialNext"/);
 assert.match(html,/function commercialChangePage/);
 assert.match(html,/offset!==commercialOffset/);
 assert.match(html,/commercialOffset=0;loadCommercialFollowups/);
 assert.match(source,/listCommercialFollowups\(pool,req\.params\.companyId,String\(req\.query\.filter\|\|'PENDIENTES'\),Number\(offsetText\)\)/);
});


test('vencimientos y recordatorios internos se calculan por empresa y con el estado vigente',async()=>{
 const {pg,db}=await setup();
 const days=n=>new Date(Date.now()+n*86400000).toISOString();
 try{
  const overdue=await createCommercialFollowup(db,'A',{...input('Caducado'),seguimientoEl:days(-1),venceEl:days(-0.5)},'operador-A');
  const upcoming=await createCommercialFollowup(db,'A',{...input('Por vencer'),seguimientoEl:days(0.25),venceEl:days(0.5)},'operador-A');
  const none=await createCommercialFollowup(db,'A',{...input('Sin vencimiento'),seguimientoEl:null,venceEl:null},'operador-A');
  await createCommercialFollowup(db,'B',{...input('Solo B'),seguimientoEl:days(-1),venceEl:days(-1)},'operador-B');
  assert.equal(none.venceEl,null);
  assert.ok(overdue.venceEl);
  const a=await getCommercialReminders(db,'A');
  assert.deepEqual(a,{seguimientosAtrasados:1,seguimientosProximos48h:1,presupuestosVencidos:1,presupuestosPorVencer48h:1});
  assert.deepEqual(await getCommercialReminders(db,'B'),{seguimientosAtrasados:1,seguimientosProximos48h:0,presupuestosVencidos:1,presupuestosPorVencer48h:0});
  assert.equal((await listCommercialFollowups(db,'A','SEGUIMIENTOS_ATRASADOS')).items[0].id,overdue.id);
  assert.equal((await listCommercialFollowups(db,'A','PRESUPUESTOS_VENCIDOS')).items[0].id,overdue.id);
  assert.equal((await listCommercialFollowups(db,'A','POR_VENCER')).items[0].id,upcoming.id);
  const edited=await updateCommercialFollowup(db,'A',overdue.id,{revision:0,venceEl:days(5),seguimientoEl:null},'operador-A');
  assert.equal(edited.item.revision,1);
  assert.equal(edited.item.seguimientoEl,null);
  assert.equal((await getCommercialReminders(db,'A')).presupuestosVencidos,0);
  await assert.rejects(updateCommercialFollowup(db,'A',overdue.id,{revision:0,venceEl:null},'operador-B'),/modificó/);
  assert.equal((await commercialFollowupHistory(db,'A',overdue.id)).length,2);
  await updateCommercialFollowup(db,'A',upcoming.id,{revision:0,estado:'GANADA'},'operador-A');
  assert.equal((await getCommercialReminders(db,'A')).presupuestosPorVencer48h,0);
  assert.equal((await getCommercialReminders(db,'B')).presupuestosVencidos,1);
 }finally{await pg.close();}
});
test('vencimiento inválido nunca modifica oportunidad ni auditoría',async()=>{
 const {pg,db}=await setup();
 try{
  await assert.rejects(createCommercialFollowup(db,'A',{...input(),venceEl:'no-fecha'},'operador'),/Fecha de vencimiento inválida/);
  await assert.rejects(createCommercialFollowup(db,'A',{...input(),venceEl:new Date(Date.now()+3*365*86400000).toISOString()},'operador'),/fuera de rango/);
  const a=await createCommercialFollowup(db,'A',{...input(),venceEl:null},'operador');
  await assert.rejects(updateCommercialFollowup(db,'A',a.id,{revision:0,venceEl:'incorrecto'},'operador'),/Fecha de vencimiento inválida/);
  await assert.rejects(updateCommercialFollowup(db,'B',a.id,{revision:0,venceEl:null},'operador'),/no encontrada/);
  assert.equal((await commercialFollowupHistory(db,'A',a.id)).length,1);
  assert.equal((await listCommercialFollowups(db,'A','TODOS')).total,1);
 }finally{await pg.close();}
});
test('el panel muestra vencimientos reales, alertas aisladas y no envía WhatsApp',async()=>{
 const {Script}=await import('node:vm');
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const server=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 assert.match(html,/id="commercialExpiry"/);
 assert.match(html,/class="commercial-expiry"/);
 assert.match(html,/id="commercialOverdue"/);
 assert.match(html,/id="commercialExpired"/);
 assert.match(html,/id="commercialExpiring"/);
 assert.match(html,/offset!==commercialOffset/);
 assert.match(server,/commercial\/reminders',authRequired,companyAccessRequired/);
 assert.doesNotMatch(server,/commercial\/reminders[\s\S]{0,500}postMotor\(/);
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1]));
});

test('vigencia por empresa se aplica únicamente a presupuestos nuevos y no sobreescribe fecha explícita',async()=>{
 const {pg,db}=await setup();
 try{
  await pg.exec("CREATE TABLE panel_companies(company_id TEXT PRIMARY KEY, config JSONB NOT NULL DEFAULT '{}'::jsonb)");
  for(const [id,days] of [['A',7],['B',0]]){
    await pg.query("INSERT INTO panel_companies(company_id,config) VALUES($1,$2)",[id,JSON.stringify({VALIDEZ_PRESUPUESTO_DIAS:days})]);
  }
  const from=Date.now();
  const automatic=await createCommercialFollowup(db,'A',{...input('Presupuesto nuevo'),esPresupuesto:true,venceEl:null},'A');
  const expiryMs=new Date(automatic.venceEl).getTime();
  assert.ok(expiryMs>=from+7*86400000-2000&&expiryMs<=Date.now()+7*86400000+2000);
  assert.equal(automatic.esPresupuesto,true);
  const plain=await createCommercialFollowup(db,'A',{...input('Oportunidad regular'),venceEl:null},'A');
  assert.equal(plain.venceEl,null);assert.equal(plain.esPresupuesto,false);
  const b=await createCommercialFollowup(db,'B',{...input('B presupuesto'),esPresupuesto:true,venceEl:null},'B');
  assert.equal(b.venceEl,null);assert.equal(b.esPresupuesto,true);
  const manual=new Date(Date.now()+2*86400000).toISOString();
  const specified=await createCommercialFollowup(db,'A',{...input('Fecha explícita'),esPresupuesto:true,venceEl:manual},'A');
  assert.equal(new Date(specified.venceEl).toISOString(),manual);
  assert.equal((await listCommercialFollowups(db,'B','TODOS')).total,1);
  assert.equal((await listCommercialFollowups(db,'A','TODOS')).total,3);
  assert.equal((await commercialFollowupHistory(db,'A',automatic.id))[0].despues.esPresupuesto,true);
 }finally{await pg.close();}
});
test('preferencias dañadas y tipos inválidos no producen presupuestos automáticos',async()=>{
 const {pg,db}=await setup();
 try{
  await pg.exec("CREATE TABLE panel_companies(company_id TEXT PRIMARY KEY, config JSONB)");
  await pg.query('INSERT INTO panel_companies(company_id,config) VALUES($1,$2)',['A',JSON.stringify({VALIDEZ_PRESUPUESTO_DIAS:700})]);
  await assert.rejects(createCommercialFollowup(db,'A',{...input(),esPresupuesto:true,venceEl:null},'o'),/Vigencia del negocio inválida/);
  await assert.rejects(createCommercialFollowup(db,'A',{...input(),esPresupuesto:'true'},'o'),/Indicador de presupuesto inválido/);
  await assert.rejects(createCommercialFollowup(db,'B',{...input(),esPresupuesto:true},'o'),/Empresa no encontrada/);
  assert.equal((await listCommercialFollowups(db,'A','TODOS')).total,0);
 }finally{await pg.close();}
});
