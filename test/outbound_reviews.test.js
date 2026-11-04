import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {initOutboundReviewNotes,addOutboundReviewNote,latestOutboundReviewNotes,outboundReviewHistory} from '../src/outbound_reviews.js';

const a='a'.repeat(64),b='b'.repeat(64);
const connect=async()=>{
 const pg=new PGlite();
 const db={query:(...args)=>pg.query(...args)};
 await initOutboundReviewNotes(db);
 return {pg,db};
};
test('revisiones auditadas quedan aisladas por empresa y entrega, sin alterar el estado del motor',async()=>{
 const {pg,db}=await connect();
 try{
  await addOutboundReviewNote(db,'empresa-A',a,{finding:'EN_REVISION',note:'Consulta inicial realizada con soporte.'},'operador-A');
  await addOutboundReviewNote(db,'empresa-A',a,{finding:'NO_SE_PUDO_VERIFICAR',note:'Meta no confirmó la aceptación del mensaje.'},'operador-B');
  await addOutboundReviewNote(db,'empresa-B',a,{finding:'INDICIOS_DE_ACEPTACION',note:'Se observó un identificador en consola.'},'operador-C');
  await addOutboundReviewNote(db,'empresa-A',b,{finding:'EN_REVISION',note:'Se investigó la segunda salida.'},'operador-A');
  const latest=await latestOutboundReviewNotes(db,'empresa-A',[a,b]);
  assert.equal(Object.keys(latest).length,2);
  assert.equal(latest[a].resultado,'NO_SE_PUDO_VERIFICAR');
  assert.equal(latest[b].resultado,'EN_REVISION');
  const other=await latestOutboundReviewNotes(db,'empresa-B',[a,b]);
  assert.equal(other[a].resultado,'INDICIOS_DE_ACEPTACION');
  assert.equal(other[b],undefined);
  assert.equal((await outboundReviewHistory(db,'empresa-A',a)).length,2);
  assert.equal((await outboundReviewHistory(db,'empresa-B',a)).length,1);
  assert.equal((await outboundReviewHistory(db,'empresa-B',b)).length,0);
  assert.deepEqual(await latestOutboundReviewNotes(db,'empresa-A',[]),{});
  const count=await pg.query("SELECT COUNT(*)::int AS n FROM panel_outbound_review_notes");
  assert.equal(count.rows[0].n,4);
 }finally{await pg.close();}
});
test('validación de identidades, campos, observaciones y hallazgos impide manipular la auditoría',async()=>{
 const {pg,db}=await connect();
 try{
  const base={finding:'EN_REVISION',note:'Revisión realizada con soporte.'};
  await assert.rejects(addOutboundReviewNote(db,'A','bad',base,'operator'),/Identificador/);
  await assert.rejects(addOutboundReviewNote(db,'A',a,{...base,finding:'ENTREGADO'},'operator'),/revisión inválido/);
  await assert.rejects(addOutboundReviewNote(db,'A',a,{...base,note:'corto'},'operator'),/10 a 600/);
  await assert.rejects(addOutboundReviewNote(db,'A',a,{...base,note:'Z'.repeat(601)},'operator'),/10 a 600/);
  await assert.rejects(addOutboundReviewNote(db,'A',a,{...base,overrideStatus:'SENT'},'operator'),/Formulario inválido/);
  await assert.rejects(addOutboundReviewNote(db,'A',a,base,''),/Operador inválido/);
  await assert.rejects(latestOutboundReviewNotes(db,'A',['not-a-hash']),/Listado de entregas inválido/);
  assert.deepEqual(await outboundReviewHistory(db,'A',a),[]);
  assert.equal((await pg.query("SELECT COUNT(*)::int AS n FROM panel_outbound_review_notes")).rows[0].n,0);
 }finally{await pg.close();}
});
test('rutas del panel exigen permiso de empresa, la revisión no reenvía mensajes ni modifica pedidos',()=>{
 const server=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 const section=server.slice(server.indexOf("app.get('/api/company/:companyId/outbound/review'"),server.indexOf("app.get('/api/company/:companyId/commercial/reminders'"));
 assert.match(section,/outbound\/review',authRequired,companyAccessRequired/);
 assert.match(section,/outbound\/:deliveryId\/observation',authRequired,canOperate/);
 assert.match(section,/outbound\/:deliveryId\/history',authRequired,companyAccessRequired/);
 assert.match(section,/postMotor\('\/admin\/outbound\/review\/company'/);
 assert.match(section,/items\.some\(x=>x\.id===req\.params\.deliveryId\)/);
 assert.doesNotMatch(section,/whatsapp\.|sendText\(|sendAudio\(|markProcessed\(|markOutboundSent\(/);
 assert.match(server,/No se modificó ningún envío/);
});
test('interfaz compilable con filtros por empresa, historial escapado y sin botones de reenvío',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(html,/id="outboundTable"/);
 assert.match(html,/id="outboundProtectionStatus"/);
 assert.match(html,/id="outboundStatus"/);
 assert.match(html,/if\(cid!==companyId\|\|seq!==outboundLoadSeq\)return/);
 assert.match(html,/esc\(x\.sourceWamid\|\|'No disponible'\)/);
 assert.match(html,/esc\(x\.observacion\)/);
 assert.match(html,/loadOutboundHistory\(/);
 assert.doesNotMatch(html,/onclick="resendOutbound/);
 const embedded=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(embedded);
 assert.doesNotThrow(()=>new Script(embedded[1],{filename:'public/index.html'}));
});
