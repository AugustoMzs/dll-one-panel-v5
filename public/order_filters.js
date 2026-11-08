/* Shared pure filtering: no network requests and no changes to order data. */
(function(root){
  'use strict';
  const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  function filter(items,{query='',state='',delivery=''}={}){
    const terms=normalize(query).split(/\s+/).filter(Boolean);
    return items.filter(order=>{
      if(state&&String(order.estadoPedido||'').toUpperCase()!==state)return false;
      if(delivery&&String(order.tipoEntrega||'').toUpperCase()!==delivery)return false;
      const text=normalize([order.idPedido,order.nombreCliente,order.idCliente,order.telefono,order.productos].join(' '));
      return terms.every(term=>text.includes(term));
    });
  }
  root.DLLOrderFilters=Object.freeze({filter});
})(globalThis);
