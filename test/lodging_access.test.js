import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';
import {lodgingRouter} from '../src/lodging_routes.js';import {requireConfiguredModule} from '../src/module_access.js';
let company={company_id:'A',modules:{cabanas:true},service_state:'ACTIVE'},member=true,edit=true,writes=0;
const db={query:async(sql)=>{if(sql.includes('panel_user_companies'))return {rows:member?[{permissions:{view:true,editCatalog:edit}}]:[]};if(sql.startsWith('SELECT items'))return {rows:[]};writes++;return {rows:[{revision:1}]};}};
const app=express();app.use(express.json());app.use('/company/:companyId',(req,res,next)=>{if(!member)return res.sendStatus(403);req.session={role:'ADMIN_EMPRESA',uid:1};next();},requireConfiguredModule(async()=>company));app.use('/company/:companyId/lodging',lodgingRouter(db));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/company/A/lodging`;test.after(()=>server.close());
test('lectura permitida, edición denegada, empresa ajena y módulo incorrecto bloqueados',async()=>{
 assert.equal((await fetch(url)).status,200);edit=false;assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:'{"items":[],"revision":0}'})).status,403);assert.equal(writes,0);
 member=false;assert.equal((await fetch(url)).status,403);member=true;company.modules={gastro:true};assert.equal((await fetch(url)).status,403);company.modules={cabanas:true};company.service_state='PAUSED';edit=true;assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403);assert.equal(writes,0);
});
