import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {initEvents,saveEvent,registerAttendee,eventAttendees,changeAttendee} from '../src/events.js';
const pg=new PGlite();let queue=Promise.resolve();const db={query:(...a)=>pg.query(...a),connect:async()=>{let release;const previous=queue;queue=new Promise(r=>release=r);await previous;return {query:(...a)=>pg.query(...a),release};}};
await pg.exec("CREATE TABLE panel_companies(company_id TEXT PRIMARY KEY);INSERT INTO panel_companies VALUES('A'),('B')");await initEvents(db);test.after(()=>pg.close());
const event={id:'event-release-001',revision:null,name:'Prueba sin clientes reales',location:'Lugar de prueba',start:'2027-12-01T20:00',capacity:1,status:'OPEN',price:1000,notes:''};
const attendee={name:'Persona Prueba',dni:'12345678',contact:'WA-5492604000000',requestId:'request-release-001'};
test('Eventos: cupo, reintento idempotente, pago pendiente e aislamiento',async()=>{
 await saveEvent(db,'A',event);const a=await registerAttendee(db,'A',event.id,attendee,'TEST');assert.equal(a.payment_state,'PENDING');assert.equal(Number(a.amount_cents),100000);
 const repeat=await registerAttendee(db,'A',event.id,attendee,'TEST');assert.equal(a.id,repeat.id);
 await assert.rejects(()=>registerAttendee(db,'A',event.id,{...attendee,dni:'23456789',requestId:'request-release-002'},'TEST'),/cupos/);
 await assert.rejects(()=>eventAttendees(db,'B',event.id),/empresa/);
 await assert.rejects(()=>changeAttendee(db,'A',event.id,{id:a.id,state:'CHECKED_IN',revision:a.revision},'TEST'));
 assert.equal((await eventAttendees(db,'A',event.id)).items.length,1);
});
