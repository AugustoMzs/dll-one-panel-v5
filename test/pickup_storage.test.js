import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {getPickup,savePickup} from '../src/pickup.js';

const db=new PGlite();
await db.exec('CREATE TABLE panel_pickup_settings(company_id TEXT PRIMARY KEY,address TEXT,updated_at TIMESTAMPTZ DEFAULT NOW())');
test.after(()=>db.close());
test.beforeEach(()=>db.exec('TRUNCATE panel_pickup_settings'));
test('guardar y editar dirección usa el valor vigente sin afectar otra empresa',async()=>{
 const a={company_id:'A',config:{DIRECCION:'Snapshot viejo 280'}},b={company_id:'B',config:{DIRECCION:'Otra 3'}};
 await savePickup(db,'A',' Nueva 123 ');await savePickup(db,'B','Empresa B 456');
 assert.deepEqual(await getPickup(db,a),{companyId:'A',address:'Nueva 123'});
 await savePickup(db,'A','Nueva 999');assert.equal((await getPickup(db,a)).address,'Nueva 999');assert.equal((await getPickup(db,b)).address,'Empresa B 456');
});
test('borrar dirección guardada no recupera la dirección antigua de la configuración',async()=>{
 const a={company_id:'A',config:{DIRECCION:'Vieja 280'}};
 await savePickup(db,'A','Nueva 123');await savePickup(db,'A','');assert.deepEqual(await getPickup(db,a),{companyId:'A',address:''});
});
test('primera instalación usa la dirección configurada hasta que haya un valor guardado',async()=>{
 assert.deepEqual(await getPickup(db,{company_id:'A',config:{DIRECCION:' Guardada 15 '}}),{companyId:'A',address:'Guardada 15'});
 assert.deepEqual(await getPickup(db,{company_id:'B'}),{companyId:'B',address:''});
});
