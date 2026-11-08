import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../public/order_filters.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const context=vm.createContext({});vm.runInContext(source,context);
const filter=context.DLLOrderFilters.filter;
const rows=[{idPedido:'PED-1',nombreCliente:'José Pérez',idCliente:'549260400',productos:'Lomito especial',estadoPedido:'PREPARANDO',tipoEntrega:'DELIVERY'},{idPedido:'PED-2',nombreCliente:'Ana',productos:'Pizza',estadoPedido:'LISTO_RETIRO',tipoEntrega:'RETIRO'}];
test('búsqueda combina palabras, ignora tildes y consulta identificadores',()=>{
 assert.equal(filter(rows,{query:'JOSE especial'})[0],rows[0]);assert.equal(filter(rows,{query:'549260'})[0],rows[0]);assert.equal(filter(rows,{query:'PED-2'})[0],rows[1]);assert.equal(filter(rows,{query:'José pizza'}).length,0);
});
test('estado y entrega se combinan, sin alterar pedidos ni orden',()=>{
 const before=JSON.stringify(rows);assert.equal(filter(rows,{state:'LISTO_RETIRO',delivery:'RETIRO'})[0],rows[1]);assert.equal(filter(rows,{state:'PREPARANDO',delivery:'RETIRO'}).length,0);assert.deepEqual(filter(rows),rows);assert.equal(JSON.stringify(rows),before);
});
test('entradas vacías e intento de HTML se tratan como texto',()=>{
 assert.equal(filter([{}],{}).length,1);assert.equal(filter(rows,{query:'<img src=x onerror=alert(1)>'}).length,0);
});
test('limpiar filtros restaura la vista sin consultas ni datos de otra empresa',()=>{
 const d=new JSDOM(html).window.document;let renders=0;
 const c=vm.createContext({$:id=>d.getElementById(id),updateOrderFilters(){renders++;}});
 const start=html.indexOf('  function clearOrderFilters('),end=html.indexOf('\n  }',start);vm.runInContext(html.slice(start,end+4),c);
 d.getElementById('orderSearch').value='José';d.getElementById('orderStateFilter').value='LISTO_RETIRO';c.clearOrderFilters(false);
 assert.equal(d.getElementById('orderSearch').value,'');assert.equal(d.getElementById('orderStateFilter').value,'');assert.equal(renders,0);c.clearOrderFilters();assert.equal(renders,1);
});
