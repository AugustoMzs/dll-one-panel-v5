import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const base=fileURLToPath(new URL('../ops/backup/backup_crypto.mjs',import.meta.url));
const script=fileURLToPath(new URL('../ops/backup/backup.sh',import.meta.url));
const docker=fileURLToPath(new URL('../ops/backup/Dockerfile',import.meta.url));
const run=(args,key)=>spawnSync(process.execPath,[base,...args],{
 encoding:'utf8',env:{...process.env,BACKUP_AES256_KEY:key},timeout:15000
});
test('off-volume backup AES-256-GCM roundtrip, independent nonces, no plaintext outside scratch',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dll-backup-'));
 try{
  const plain=join(dir,'source.dump'),enc1=join(dir,'first.aes'),enc2=join(dir,'second.aes'),out=join(dir,'restored.dump');
  const input=Buffer.concat([Buffer.from('PostgreSQL archival fixture - public test only: '),randomBytes(512*1024)]);
  await writeFile(plain,input);
  const key=randomBytes(32).toString('base64');
  assert.equal(run(['encrypt',plain,enc1],key).status,0);
  assert.equal(run(['encrypt',plain,enc2],key).status,0);
  const first=await readFile(enc1),second=await readFile(enc2);
  assert.notDeepEqual(first,second);
  assert.ok(!first.includes(input.subarray(0,30)));
  assert.equal((await stat(enc1)).mode&0o777,0o600);
  assert.equal(run(['decrypt',enc1,out],key).status,0);
  assert.deepEqual(await readFile(out),input);
  assert.equal((await stat(out)).mode&0o777,0o600);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('tamper, wrong key and truncation fail closed and never leave a restored file',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dll-backup-tamper-'));
 try{
  const plain=join(dir,'src.dump'),enc=join(dir,'encrypted.aes'),output=join(dir,'restore.dump');
  await writeFile(plain,randomBytes(65536));
  const key=randomBytes(32).toString('base64');
  assert.equal(run(['encrypt',plain,enc],key).status,0);
  assert.notEqual(run(['decrypt',enc,output],randomBytes(32).toString('base64')).status,0);
  await assert.rejects(access(output));
  const data=await readFile(enc);data[100]^=255;
  await writeFile(enc,data);
  assert.notEqual(run(['decrypt',enc,output],key).status,0);
  await assert.rejects(access(output));
  await writeFile(enc,data.subarray(0,30));
  assert.notEqual(run(['decrypt',enc,output],key).status,0);
  await assert.rejects(access(output));
  assert.notEqual(run(['encrypt',plain,output],'not-a-base64-key').status,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('backup cron syntax, fail-closed variables and restore target restricted to disposable instance',async()=>{
 const validate=spawnSync('sh',['-n',script],{encoding:'utf8',timeout:5000});
 assert.equal(validate.status,0,validate.stderr);
 const sh=await readFile(script,'utf8'),image=await readFile(docker,'utf8');
 assert.match(sh,/pg_dump --dbname="\$DATABASE_URL"/);
 assert.match(sh,/backup_crypto\.mjs encrypt/);
 assert.match(sh,/backup_crypto\.mjs decrypt/);
 assert.match(sh,/sha256sum/);
 assert.match(sh,/pg_restore --host="\$work" --port=55432/);
 assert.match(sh,/su-exec postgres initdb/);
 assert.match(sh,/tables_restored=/);
 assert.match(sh,/\.verified\.txt/);
 assert.doesNotMatch(sh,/pg_restore[^\n]*DATABASE_URL/);
 assert.match(image,/FROM postgres:18-alpine/);
 assert.match(image,/aws-cli/);
 assert.match(image,/su-exec/);
 assert.match(image,/backup\.sh/);
});
