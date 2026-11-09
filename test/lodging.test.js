import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {initLodging,saveCabins,lodgingCatalog,validateCabins,lodgingReply,lodgingChat} from '../src/lodging.js';
import {assignModule,configuredModule,requestedModule} from '../src/module_access.js';
const pg=new PGlite(),db={query:(...a)=>pg.query(...a)};await initLodging(db);test.after(()=>pg.close());
const cabin=(id,n)=>({id,name:'Cabaña '+n,capacity:n,description:'Cocina y jardín',rate:'ARS 50.000 por noche, consultar temporada',active:true,photos:[]});
const items=[cabin('cabana02',2),cabin('cabana04',4),cabin('cabana06',6)];
test('Cabañas es un módulo exclusivo y no habilita pantallas ajenas',()=>{
 const modules=assignModule({ventas:true,MODULO_GASTRO:'SI'},'cabanas');assert.equal(configuredModule({modules},'cabanas'),true);assert.equal(configuredModule({modules},'ventas'),false);assert.equal(requestedModule('/lodging'),'cabanas');assert.equal(configuredModule({modules:{cabanas:true,salud:true}},'cabanas'),false);
});
test('capacidad, IDs, imágenes y límites se validan antes de persistir',()=>{
 assert.equal(validateCabins(items).length,3);for(const bad of [{capacity:0},{capacity:2.5},{active:'true'},{photos:[{mime:'image/svg+xml',base64:'AAAA'}]},{photos:[{mime:'image/png',base64:'YWJjZGVmZ2g='}]}])assert.throws(()=>validateCabins([{...items[0],...bad}]));assert.throws(()=>validateCabins([items[0],items[0]]));
});
test('filtra 2/4/6, no inventa tarifa ni disponibilidad, rechaza IDs externos',()=>{
 const r=lodgingReply({action:'OPTIONS',guests:4,ids:[]},items);assert.ok(!r.response.includes('Cabaña 2'));assert.match(r.response,/Cabaña 4/);assert.match(r.response,/confirmación/);assert.match(r.response,/50.000/);
 assert.match(lodgingReply({action:'OPTIONS',guests:7,ids:[]},items).response,/No tengo/);
 assert.throws(()=>lodgingReply({action:'DETAIL',guests:null,ids:['otraempresa']},items));
 assert.match(lodgingReply({action:'RESERVE',guests:4,ids:[]},items).response,/Todavía no hay una reserva confirmada/);
 assert.match(lodgingReply({action:'OPTIONS',guests:null,ids:[]},items).response,/cuántas/);
});
test('guardado aislado por empresa y control de ediciones concurrentes',async()=>{
 await saveCabins(db,'A',{items,revision:0});assert.deepEqual((await lodgingCatalog(db,'B')).items,[]);await assert.rejects(()=>saveCabins(db,'A',{items:[],revision:0}),/cambió/);assert.equal((await lodgingCatalog(db,'A')).items.length,3);
});
test('contexto privado por empresa y contacto, IA fallida no borra historial',async()=>{
 const a={company_id:'A',company_name:'A'},b={company_id:'B',company_name:'B'},input={waId:'5492604000000',text:'somos cuatro'};let prompt;
 const interpret=async p=>{prompt=p;return {action:'OPTIONS',guests:4,ids:[]};};
 await lodgingChat(db,a,input,interpret);await lodgingChat(db,a,{...input,text:'la primera'},interpret);assert.match(prompt,/somos cuatro/);
 await lodgingChat(db,b,{...input,text:'hola'},interpret);assert.ok(!prompt.includes('somos cuatro'));assert.ok(!prompt.includes('Cocina y jardín'));
 await assert.rejects(()=>lodgingChat(db,a,input,async()=>{throw Error('429');}));const row=(await pg.query('SELECT history FROM panel_lodging_chats WHERE company_id=$1',['A'])).rows[0];assert.equal(row.history.length,2);
});
test('texto y selección de fotos pertenecen solo a opciones activas, respuesta cabe en WhatsApp',()=>{
 const x={...items[0],photos:[{id:'foto1'}]};const r=lodgingReply({action:'DETAIL',guests:2,ids:[x.id]},[x]);assert.deepEqual(r.photos,[{cabinId:x.id,photoId:'foto1'}]);assert.throws(()=>lodgingReply({action:'DETAIL',guests:2,ids:[x.id]},[{...x,active:false}]));
 const long=items.map(x=>({...x,description:'a'.repeat(1500),rate:'b'.repeat(300)}));assert.ok(lodgingReply({action:'OPTIONS',guests:2,ids:[]},long).response.length<4096);
});
