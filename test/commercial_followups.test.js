import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {initCommercialFollowups,createCommercialFollowup,updateCommercialFollowup,listCommercialFollowups,commercialFollowupHistory} from '../src/commercial_followups.js';

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
