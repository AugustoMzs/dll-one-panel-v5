import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const script=fs.readFileSync(new URL('../public/panel-design.js',import.meta.url),'utf8');
function setup(){const dom=new JSDOM(html,{runScripts:'outside-only'});dom.window.eval(script);return dom.window;}
test('Reorganization preserves every existing ID exactly once and every form control',()=>{
 const before=new JSDOM(html).window.document,after=setup().document;
 for(const el of before.querySelectorAll('[id]'))assert.equal(after.querySelectorAll(`[id="${el.id}"]`).length,1,el.id);
 assert.equal(after.querySelectorAll('input,select,textarea,fieldset').length,before.querySelectorAll('input,select,textarea,fieldset').length);
});
test('Tabs support click and keyboard without discarding edits',()=>{
 const w=setup(),d=w.document;const tabs=[...d.querySelectorAll('#business > .section-tabs button')];
 d.getElementById('bizName').value='Cambios sin guardar';tabs[1].click();
 assert.equal(d.getElementById('business-pane-0').hidden,true);assert.equal(d.getElementById('business-pane-1').hidden,false);
 tabs[1].dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
 assert.equal(d.getElementById('business-pane-0').hidden,false);assert.equal(d.getElementById('bizName').value,'Cambios sin guardar');
});
test('Gastro disabled fieldsets and administrator-only controls remain protected',()=>{
 const d=setup().document;
 for(const id of ['gMenuAuto','gZoneName','gVariantsEnabled'])assert.equal(d.getElementById(id).closest('fieldset').id,'gSettingsFields');
 assert.equal(d.getElementById('gSettingsFields').disabled,true);
 assert.ok(d.getElementById('moduleAssignmentCard').classList.contains('hidden-admin'));
 assert.ok(d.getElementById('bizPhoneNumberWrap').classList.contains('admin-only'));
});
test('Health date stays visible across agenda and reception and mobile has commercial access',()=>{
 const d=setup().document;
 assert.equal(d.getElementById('healthDate').closest('.design-pane'),null);
 assert.ok(d.querySelector('#more button[onclick="go(\'commercial\')"]'));
});
