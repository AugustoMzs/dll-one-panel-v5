import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {initVoiceSettings,voicePreference} from '../src/voice_settings.js';
import {validateHealthIntent} from '../src/health_assistant.js';
test('voice modes persist by company/contact without changing other tenants',async()=>{
 const db=new PGlite();
 try{
  await initVoiceSettings(db);
  await voicePreference(db,'A','contact','audio_only');
  await voicePreference(db,'B','contact','text');
  assert.equal(await voicePreference(db,'A','contact'),'audio_only');
  assert.equal(await voicePreference(db,'B','contact'),'text');
  assert.equal(await voicePreference(db,'A','other'),null);
  await voicePreference(db,'A','contact','audio');
  assert.equal(await voicePreference(db,'A','contact'),'audio');
  await assert.rejects(()=>voicePreference(db,'A','contact','invalid'));
  assert.equal(await voicePreference(db,'A','contact'),'audio');
 }finally{await db.close();}
});
test('health accepts audio-only without interpreting it as booking consent',()=>{
 const r=validateHealthIntent({action:'HELP',replyMode:'audio_only'});
 assert.equal(r.replyMode,'audio_only');assert.equal(r.action,'HELP');
 assert.throws(()=>validateHealthIntent({action:'HELP',replyMode:'invalid'}));
});
