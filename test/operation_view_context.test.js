import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
function fn(name){const start=html.search(new RegExp('  (?:async )?function '+name+'\\('));assert.ok(start>=0);const end=html.indexOf('\n  }',start);return html.slice(start,end+4);}
function setup(){
 const d=new JSDOM(html).window.document,requests=[],rendered=[];
 const c=vm.createContext({companyId:'A',inboxRequest:0,inboxBusy:false,inboxRequestKey:'',ordersRequest:0,threadRequest:0,inboxSearchTimer:null,selectedChat:{idCliente:'old'},editableOrders:new Map([['old',{}]]),noticeData:null,
  $:id=>d.getElementById(id),clearTimeout,encodeURIComponent,
  api:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})),
  renderInbox:items=>rendered.push(items),renderOrders:items=>rendered.push(items),closeOrderEdit(){},showNotice(){},
  refreshSelectedThread:()=>new Promise(()=>{})
 });
 for(const name of ['resetChatView','resetOperationViews','loadConversationsLive','openConversation','loadOrders'])vm.runInContext(fn(name),c);
 return {c,d,requests,rendered};
}
test('un pedido antiguo no reemplaza la respuesta más reciente',async()=>{
 const {c,requests,rendered}=setup();const old=c.loadOrders(),recent=c.loadOrders();
 requests[1].resolve({total:1,items:['nuevo']});await recent;
 requests[0].resolve({total:2,items:['viejo']});await old;
 assert.deepEqual(rendered,[['nuevo']]);
});
test('cambiar empresa limpia listas, borrador y edición antes de recibir datos',()=>{
 const {c,d}=setup();d.getElementById('ordersTable').textContent='Pedido A';d.getElementById('conversationItems').textContent='Cliente A';d.getElementById('chatComposer').value='Mensaje A';
 c.companyId='B';c.resetOperationViews();
 assert.equal(d.getElementById('ordersTable').textContent,'');assert.equal(d.getElementById('conversationItems').textContent,'');assert.equal(d.getElementById('chatComposer').value,'');assert.equal(c.editableOrders.size,0);assert.equal(c.selectedChat,null);
 assert.equal(d.getElementById('sendChatBtn').disabled,true);
});
test('una búsqueda nueva no se pierde cuando la anterior está pendiente',async()=>{
 const {c,d,requests,rendered}=setup();d.getElementById('chatSearch').value='Ana';const old=c.loadConversationsLive();
 d.getElementById('chatSearch').value='Luis';const recent=c.loadConversationsLive();assert.equal(requests.length,2);
 requests[1].resolve({items:['Luis']});await recent;requests[0].resolve({items:['Ana']});await old;
 assert.deepEqual(rendered,[['Luis']]);assert.equal(c.inboxBusy,false);
});
test('la respuesta A previa al cambio A-B-A queda invalidada',async()=>{
 const {c,requests,rendered}=setup();const old=c.loadConversationsLive();
 c.companyId='B';c.resetOperationViews();c.companyId='A';c.resetOperationViews();const recent=c.loadConversationsLive();
 requests[0].resolve({items:['obsoleto']});await old;assert.equal(c.inboxBusy,true);
 requests[1].resolve({items:['actual']});await recent;assert.deepEqual(rendered,[['actual']]);
});
test('abrir otro chat limpia el borrador y bloquea el envío durante la carga',()=>{
 const {c,d}=setup();d.getElementById('chatComposer').value='Para el cliente anterior';d.getElementById('sendChatBtn').disabled=false;d.getElementById('chatMessages').textContent='Historial anterior';
 void c.openConversation('nuevo');
 assert.equal(c.selectedChat.idCliente,'nuevo');assert.equal(d.getElementById('chatComposer').value,'');assert.equal(d.getElementById('sendChatBtn').disabled,true);assert.equal(d.getElementById('chatMessages').textContent,'');
});

test('volver a seleccionar el mismo chat conserva el borrador',()=>{
 const {c,d}=setup();d.getElementById('chatComposer').value='Borrador del mismo cliente';
 void c.openConversation('old');assert.equal(d.getElementById('chatComposer').value,'Borrador del mismo cliente');
});
