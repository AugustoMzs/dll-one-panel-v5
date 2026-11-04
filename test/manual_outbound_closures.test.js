import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {initOutboundClosures,validateClosureInput,registerClosureRequest,setClosureResult,listClosureRequests} from '../src/outbound_closures.js';

const delivery='a'.repeat(64);
const requestId='cafed000-0000-4000-8000-000000000001';
const form=(request=requestId)=>({
 requestId:request,note:'El cliente confirmó el estado y se revisó el pedido con el responsable.',
 verifiedBusinessState:true,verifiedCustomerContact:true,confirmation:'CERRAR_SIN_REENVIO'
});
const setup=async()=>{
 const pg=new PGlite();
 const db={query:(...args)=>pg.query(...args)};
 await initOutboundClosures(db);
 return {pg,db};
};
test('el panel deja una intención auditada ANTES de enviar al motor, idempotente por UUID',async()=>{
 const {pg,db}=await setup();
 try{
  const a=validateClosureInput('empresa-A',delivery,form(),123);
  const saved=await registerClosureRequest(db,a);
  assert.equal(saved.status,'REQUESTED');
  const repeated=await registerClosureRequest(db,a);
  assert.equal(repeated.id,requestId);
  assert.equal((await listClosureRequests(db,'empresa-A')).length,1);
  assert.equal((await listClosureRequests(db,'empresa-B')).length,0);
  assert.equal(await setClosureResult(db,requestId,'REVIEW_REQUIRED'),'REVIEW_REQUIRED');
  assert.equal(await setClosureResult(db,requestId,'COMPLETED'),'COMPLETED');
  assert.equal(await setClosureResult(db,requestId,'REVIEW_REQUIRED'),'COMPLETED');
  assert.equal((await listClosureRequests(db,'empresa-A'))[0].status,'COMPLETED');
  await assert.rejects(registerClosureRequest(db,{...a,companyId:'empresa-B'}),/otra solicitud/);
  await assert.rejects(registerClosureRequest(db,{...a,note:'Texto distinto de observación'}),/otra solicitud/);
  const n=await pg.query('SELECT COUNT(*)::int AS n FROM panel_outbound_closures');
  assert.equal(n.rows[0].n,1);
 }finally{await pg.close();}
});
test('solicitudes inválidas no se registran ni permiten cerrar automáticamente',async()=>{
 const {pg,db}=await setup();
 try{
  for(const payload of [
    {...form(),confirmation:'REENVIAR'},
    {...form(),verifiedBusinessState:false},
    {...form(),verifiedCustomerContact:false},
    {...form(),note:'breve'},
    {...form(),note:'x'.repeat(601)},
    {...form(),superadmin:true},
    {...form(),requestId:'no-uuid'}
  ])assert.throws(()=>validateClosureInput('A',delivery,payload,123));
  assert.throws(()=>validateClosureInput('A','bad',form(),123));
  assert.throws(()=>validateClosureInput('A',delivery,form(),0));
  assert.equal((await listClosureRequests(db,'A')).length,0);
 }finally{await pg.close();}
});
test('la API exige superadmin y verifica observación anterior antes de tocar el motor',()=>{
 const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 const start=source.indexOf("app.post('/api/company/:companyId/outbound/:deliveryId/manual-close'");
 const end=source.indexOf("app.get('/api/company/:companyId/outbound/:deliveryId/history'",start);
 assert.ok(start>0&&end>start);
 const section=source.slice(start,end);
 assert.match(section,/requireSuperadmin/);
 assert.match(section,/review\.manualCloseEnabled!==true/);
 assert.match(section,/audit\[input\.deliveryId\]/);
 assert.match(section,/await registerClosureRequest\(pool,input\)/);
 assert.match(section,/await postMotor\('\/admin\/outbound\/review\/company\/manual-close'/);
 assert.match(section,/await setClosureResult\(pool,request\.id,'COMPLETED'\)/);
 assert.match(section,/await setClosureResult\(pool,request\.id,'REVIEW_REQUIRED'\)/);
 assert.doesNotMatch(section,/whatsapp\.|sendText\(|sendAudio\(|graph\(/);
});
test('la UI solo enseña cierre a superadmin cuando el motor lo habilita y preserva el UUID de reintento',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1]));
 assert.match(html,/r\.manualCloseEnabled===true&&String\(currentUser\?\.role/);
 assert.match(html,/outboundCloseAllowed\?/);
 assert.match(html,/verifiedCustomerContact:true/);
 assert.match(html,/CERRAR_SIN_REENVIO/);
 assert.match(html,/card\.dataset\.requestId\|\|\(card\.dataset\.requestId=crypto\.randomUUID\(\)\)/);
 assert.match(html,/executeOutboundClose\(button,item\)/);
 assert.match(html,/id="outboundClosures"/);
});
