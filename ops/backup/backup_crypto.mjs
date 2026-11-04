#!/usr/bin/env node
// DLL One backup envelope V1: authenticated AES-256-GCM, unique 96-bit nonce.
// Contents never appear in GitHub, logs, or an unencrypted object-store upload.
// The 32-byte BACKUP_AES256_KEY must be stored separately from the backup bucket.
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {open,stat,writeFile,appendFile,rm,chmod} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
const MAGIC=Buffer.from('DLLONEBKUP01','ascii');
const IV_SIZE=12, TAG_SIZE=16, HEAD_SIZE=MAGIC.length+IV_SIZE;
function keyFromEnvironment(){
 const encoded=process.env.BACKUP_AES256_KEY||'';
 if(!/^[A-Za-z0-9+/]{43}=$/.test(encoded))throw Error('BACKUP_AES256_KEY must be 32-byte base64.');
 const key=Buffer.from(encoded,'base64');
 if(key.length!==32||key.toString('base64')!==encoded)throw Error('Invalid backup key.');
 return key;
}
export async function encryptFile(input,output,key=keyFromEnvironment()){
 if(input===output)throw Error('Cannot overwrite source');
 const iv=randomBytes(IV_SIZE);
 await writeFile(output,Buffer.concat([MAGIC,iv]),{mode:0o600,flag:'wx'});
 try{
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  await pipeline(createReadStream(input),cipher,createWriteStream(output,{flags:'a',mode:0o600}));
  await appendFile(output,cipher.getAuthTag());
  await chmod(output,0o600);
 }catch(error){await rm(output,{force:true});throw error;}
}
export async function decryptFile(input,output,key=keyFromEnvironment()){
 if(input===output)throw Error('Cannot overwrite source');
 const size=(await stat(input)).size;
 if(size<=HEAD_SIZE+TAG_SIZE)throw Error('Encrypted archive is empty or truncated.');
 const handle=await open(input,'r');
 let header,tag;
 try{
  header=Buffer.alloc(HEAD_SIZE);tag=Buffer.alloc(TAG_SIZE);
  if((await handle.read(header,0,HEAD_SIZE,0)).bytesRead!==HEAD_SIZE||
     (await handle.read(tag,0,TAG_SIZE,size-TAG_SIZE)).bytesRead!==TAG_SIZE||
     !header.subarray(0,MAGIC.length).equals(MAGIC))throw Error('Invalid encrypted backup envelope.');
 }finally{await handle.close();}
 const iv=header.subarray(MAGIC.length);
 const decipher=createDecipheriv('aes-256-gcm',key,iv);
 decipher.setAuthTag(tag);
 try{
  await pipeline(
    createReadStream(input,{start:HEAD_SIZE,end:size-TAG_SIZE-1}),
    decipher,createWriteStream(output,{flags:'wx',mode:0o600})
  );
  await chmod(output,0o600);
 }catch(error){await rm(output,{force:true});throw Error('Backup authentication failed; do not restore.');}
}
if(process.argv[1]&&process.argv[1].endsWith('backup_crypto.mjs')&&process.argv.length>2){
 const [, ,operation,input,output]=process.argv;
 if(!input||!output)throw Error('Usage: backup_crypto.mjs encrypt|decrypt INPUT OUTPUT');
 if(operation==='encrypt')await encryptFile(input,output);
 else if(operation==='decrypt')await decryptFile(input,output);
 else throw Error('Unknown backup operation.');
}
