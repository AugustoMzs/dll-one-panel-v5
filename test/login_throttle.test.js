import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {initLoginThrottle,loginThrottleKey,consumeLoginAttempt,clearLoginAttempts} from '../src/login_throttle.js';

const secret='a-secure-test-secret-of-more-than-24-chars';
async function setup(){
 const pg=new PGlite();
 const db={query:(...a)=>pg.query(...a)};
 await initLoginThrottle(db);
 return {db,pg};
}
test('los intentos se limitan de forma atómica después de 20 consultas',async()=>{
 const {db,pg}=await setup();
 try{
 const key=loginThrottleKey('admin','origin-A',secret);
 for(let n=1;n<=20;n++){
   const x=await consumeLoginAttempt(db,key);
   assert.equal(x.allowed,true,'La petición válida '+n+' debe admitirse.');
   assert.equal(x.windowMinutes,10);
 }
 const blocked=await consumeLoginAttempt(db,key);
 assert.equal(blocked.allowed,false);
 assert.ok(blocked.retryAfterSeconds>0);
 assert.ok(blocked.retryAfterSeconds<=600);
 const row=(await db.query('SELECT * FROM panel_login_attempts WHERE rate_key=$1',[key])).rows[0];
 assert.equal(row.attempts,21);
 assert.doesNotMatch(JSON.stringify(row),/admin|origin-A/);
 }finally{await pg.close();}
});
test('ninguna empresa o usuario hereda el bloqueo de otro login/origen',async()=>{
 const {db,pg}=await setup();
 try{
 const a=loginThrottleKey('Admin','origin-A',secret);
 const same=loginThrottleKey('admin','origin-A',secret);
 const differentOrigin=loginThrottleKey('admin','origin-B',secret);
 const differentLogin=loginThrottleKey('operador','origin-A',secret);
 assert.equal(a,same);
 assert.notEqual(a,differentOrigin);
 assert.notEqual(a,differentLogin);
 for(let n=0;n<21;n++)await consumeLoginAttempt(db,a);
 assert.equal((await consumeLoginAttempt(db,differentOrigin)).allowed,true);
 assert.equal((await consumeLoginAttempt(db,differentLogin)).allowed,true);
 }finally{await pg.close();}
});
test('login correcto reinicia la protección y final de ventana permite otra vez',async()=>{
 const {db,pg}=await setup();
 try{
 const key=loginThrottleKey('admin','source',secret);
 for(let n=0;n<21;n++)await consumeLoginAttempt(db,key);
 await clearLoginAttempts(db,key);
 assert.equal((await consumeLoginAttempt(db,key)).allowed,true);
 await db.query("UPDATE panel_login_attempts SET attempts=50, window_end=NOW()-interval '1 second' WHERE rate_key=$1",[key]);
 assert.equal((await consumeLoginAttempt(db,key)).allowed,true);
 assert.equal((await db.query('SELECT attempts FROM panel_login_attempts WHERE rate_key=$1',[key])).rows[0].attempts,1);
 }finally{await pg.close();}
});
test('límite usa clave secreta y el login no revela errores de infraestructura',()=>{
 assert.throws(()=>loginThrottleKey('admin','source','short'),/clave/);
 const server=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 assert.match(server,/await consumeLoginAttempt\(pool,attemptKey\)/);
 assert.match(server,/await clearLoginAttempts\(pool,attemptKey\)/);
 assert.match(server,/res\.status\(429\)/);
 assert.match(server,/res\.set\('Retry-After'/);
 assert.match(server,/password\.length>4096/);
});
