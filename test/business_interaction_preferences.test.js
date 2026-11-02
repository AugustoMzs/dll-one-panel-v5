import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {initBusinessProfiles,getBusinessProfile,saveBusinessProfile} from '../src/business_profile.js';

const company=(id,config={})=>({company_id:id,company_name:'Negocio '+id,phone_number_id:id==='A'?'111':'222',modules:{ventas:true},config});
const dbAdapter=pg=>({query:(...args)=>pg.query(...args),connect:async()=>({query:(...args)=>pg.query(...args),release(){}})});

test('configuraciones comerciales: guardado real, revisión y aislamiento entre empresas',async()=>{
 const pg=new PGlite(),db=dbAdapter(pg);
 try{
  await pg.exec("CREATE TABLE panel_companies(company_id TEXT PRIMARY KEY,company_name TEXT,phone_number_id TEXT,modules JSONB,config JSONB); CREATE TABLE panel_pickup_settings(company_id TEXT PRIMARY KEY,address TEXT,updated_at TIMESTAMPTZ DEFAULT NOW()); CREATE TABLE panel_native_companies(company_id TEXT PRIMARY KEY,connected BOOLEAN,revision INTEGER);");
  await initBusinessProfiles(db);
  for(const c of [company('A'),company('B')])await pg.query('INSERT INTO panel_companies VALUES($1,$2,$3,$4,$5)',[c.company_id,c.company_name,c.phone_number_id,JSON.stringify(c.modules),JSON.stringify(c.config)]);
  const a0=await getBusinessProfile(db,company('A'));
  assert.equal(a0.config.PEDIR_NOMBRE_CLIENTE,false);
  assert.equal(a0.config.MENSAJE_BIENVENIDA,'');
  assert.equal(a0.config.MENSAJE_DERIVACION_HUMANA,'');
  const a1=await saveBusinessProfile(db,'A',{revision:0,MENSAJE_BIENVENIDA:'¡Bienvenidos!',MENSAJE_DERIVACION_HUMANA:'Te atenderá nuestro equipo.',PEDIR_NOMBRE_CLIENTE:true},false);
  assert.equal(a1.config.PEDIR_NOMBRE_CLIENTE,true);
  assert.equal(a1.config.MENSAJE_BIENVENIDA,'¡Bienvenidos!');
  assert.equal(a1.revision,1);
  assert.equal((await getBusinessProfile(db,(await db.query('SELECT * FROM panel_companies WHERE company_id=$1',['B'])).rows[0])).config.PEDIR_NOMBRE_CLIENTE,false);
  await assert.rejects(saveBusinessProfile(db,'A',{revision:0,PEDIR_NOMBRE_CLIENTE:false},false),/otra sesión/);
  await assert.rejects(saveBusinessProfile(db,'A',{revision:1,PEDIR_NOMBRE_CLIENTE:'true'},false),/SI o NO/);
  await assert.rejects(saveBusinessProfile(db,'A',{revision:1,MENSAJE_BIENVENIDA:'X'.repeat(351)},false),/Texto inválido/);
  assert.equal((await db.query('SELECT config FROM panel_companies WHERE company_id=$1',['A'])).rows[0].config.PEDIR_NOMBRE_CLIENTE,true);
  const a2=await saveBusinessProfile(db,'A',{revision:1,TELEFONO:'2625555555'},false);
  assert.equal(a2.config.PEDIR_NOMBRE_CLIENTE,true);
  assert.equal(a2.config.MENSAJE_BIENVENIDA,'¡Bienvenidos!');
 }finally{await pg.close();}
});

test('campos de Mi negocio conectados al formulario sin modificar Dashboard',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 for(const id of ['bizWelcome','bizAskName','bizHandoff'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/MENSAJE_BIENVENIDA:\$\('bizWelcome'\)/);
 assert.match(html,/PEDIR_NOMBRE_CLIENTE:\$\('bizAskName'\)/);
 assert.match(html,/MENSAJE_DERIVACION_HUMANA:\$\('bizHandoff'\)/);
});
