let importEpoch=0,importSelection=null,importPreview=null,importBusy=false;
const importCanonical=x=>JSON.stringify(x,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);
const importBase=target=>`/api/company/${encodeURIComponent(target)}/catalog/imports`;
const importPost=(url,body={})=>api(url,{method:'POST',body:JSON.stringify(body)});
function importText(tag,value,parent){const el=document.createElement(tag);el.textContent=String(value??'');parent.appendChild(el);return el;}
function importButton(label,fn,parent){const b=importText('button',label,parent);b.className='btn btn-light';b.type='button';b.onclick=fn;return b;}
function importCurrent(target,epoch){return target===companyId&&epoch===importEpoch;}
function importStatus(message){const el=$('salesImportStatus');if(el)el.textContent=message;}
async function loadSalesImports(){
 const target=companyId,epoch=++importEpoch;importSelection=null;importPreview=null;importBusy=false;
 const box=$('salesImport');if(!box)return;box.replaceChildren();importText('h4','Cargas de catálogo',box);
 importText('p','Hasta 10.000 filas y 6 MB. Código, nombre y precio obligatorios. Sólo se modifica el catálogo al confirmar; los productos ausentes del archivo se conservan.',box);
 const status=importText('p','Buscando cargas…',box);status.id='salesImportStatus';status.setAttribute('role','status');
 const list=importText('div','',box);list.id='salesImportList';const detail=importText('div','',box);detail.id='salesImportDetail';
 try{const r=await api(importBase(target));if(!importCurrent(target,epoch))return;
  importStatus('Seleccioná un archivo nuevo o retomá una carga pendiente.');
  for(const x of r.items){const line=importText('div',`${x.filename} · ${x.total} filas · ${x.state==='DRAFT'?'Pendiente':x.state==='APPLIED'?'Aplicada':'Cancelada'}`,list);if(x.state==='DRAFT')importButton('Revisar / retomar',()=>reviewSalesImport(x.id),line);}
 }catch(e){if(importCurrent(target,epoch))importStatus(e.message);}
}
async function reviewSalesImport(id){
 if(importBusy)return;const target=companyId,epoch=importEpoch;importBusy=true;importPreview=null;
 try{
  const r=await api(importBase(target)+'/'+encodeURIComponent(id));if(!importCurrent(target,epoch))return;
  importSelection=r;$('salesImportDetail').replaceChildren();
  importButton('Cancelar esta carga',cancelSelectedSalesImport,$('salesImportDetail'));
  if(r.state!=='DRAFT'){importStatus('Esta carga ya está cerrada.');return;}
  if(r.uploaded<r.total){importStatus(`Guardadas ${r.uploaded} de ${r.total} filas. Seleccioná el mismo archivo y tocá Cargar para revisar.`);return;}
  const p=await importPost(importBase(target)+'/'+id+'/preview');if(!importCurrent(target,epoch))return;
  importPreview=p;importStatus(`${p.created} nuevos, ${p.updated} actualizados, ${p.unchanged} sin cambios. Muestra de las primeras ${p.preview.length} filas.`);
  const scroll=importText('div','',$('salesImportDetail'));scroll.style.overflowX='auto';const table=importText('table','',scroll);
  const header=importText('tr','',table);for(const x of ['Código','Producto','Acción','Precio anterior','Precio nuevo','Cambios de datos'])importText('th',x,header);
  for(const x of p.preview){const row=importText('tr','',table);const changes=Object.keys(x.after).filter(k=>!['id','fila','precio'].includes(k)&&x.before?.[k]!==x.after[k]).map(k=>`${k}: ${x.before?.[k]??'—'} → ${x.after[k]}`).join('; ');
   for(const value of [x.codigo,x.nombre,x.action,x.before?money(x.before.precio):'—',money(x.after.precio),changes])importText('td',value,row);}
  importButton('Confirmar importación',applySelectedSalesImport,$('salesImportDetail'));
 }catch(e){if(importCurrent(target,epoch))importStatus(e.message);}finally{if(importCurrent(target,epoch))importBusy=false;}
}
async function importCatalogFile(){
 if(importBusy||salesBusy)return;const target=companyId,epoch=importEpoch,file=$('catalogFile').files?.[0];
 if(!file){importStatus('Seleccioná un archivo Excel o CSV.');return;}
 if(file.size>6*1024*1024){importStatus('El archivo supera 6 MB.');return;}
 importBusy=true;importPreview=null;invalidateSalesPricePreview();
 try{
  importStatus('Leyendo y validando el archivo…');
  const base64=await fileToBase64(file);if(!importCurrent(target,epoch))return;
  const parsed=await importPost(importBase(target)+'/parse',{base64,filename:file.name});if(!importCurrent(target,epoch))return;
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(importCanonical(parsed.items)));
  if(!importCurrent(target,epoch))return;
  const sourceHash=Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
  let id=importSelection?.state==='DRAFT'?importSelection.id:null;
  if(id&&sourceHash!==importSelection.sourceHash)throw Error('El archivo no corresponde a la carga seleccionada. Cancelala o recargá la lista para iniciar otra.');
  const key='dll-import:'+target+':'+sourceHash;
  if(!id){let requestId;try{requestId=localStorage.getItem(key);}catch{}
   if(!requestId){requestId=crypto.randomUUID();try{localStorage.setItem(key,requestId);}catch{}}
   let draft=await importPost(importBase(target),{requestId,sourceHash,filename:file.name,total:parsed.items.length});if(!importCurrent(target,epoch))return;
   if(draft.state!=='DRAFT'){try{localStorage.removeItem(key);}catch{}throw Error('Esta carga ya fue cerrada. Volvé a cargar el archivo para crear un nuevo borrador.');}
   id=draft.id;
  }
  for(let i=0;i<parsed.items.length;i+=parsed.batchSize){
   if(!importCurrent(target,epoch))return;
   // Resend all chunks: the server verifies identical retries without duplicating rows.
   await importPost(importBase(target)+'/'+id+'/batch',{index:i/parsed.batchSize,items:parsed.items.slice(i,i+parsed.batchSize)});
   if(!importCurrent(target,epoch))return;importStatus(`Guardadas ${Math.min(i+parsed.batchSize,parsed.items.length)} de ${parsed.items.length} filas.`);
  }
  importBusy=false;await reviewSalesImport(id);
 }catch(e){if(importCurrent(target,epoch))importStatus(e.message+' Podés retomar la carga desde esta lista o seleccionando el mismo archivo.');}
 finally{if(importCurrent(target,epoch))importBusy=false;}
}
async function applySelectedSalesImport(){
 if(importBusy||!importSelection||!importPreview)return;
 if(!confirm(`¿Aplicar ${importPreview.created} productos nuevos y ${importPreview.updated} actualizaciones?`))return;
 const target=companyId,epoch=importEpoch,id=importSelection.id,preview=importPreview;importBusy=true;
 try{const r=await importPost(importBase(target)+'/'+id+'/apply',preview);if(!importCurrent(target,epoch))return;
  importPreview=null;importSelection=null;await loadCatalog();if(target===companyId)importStatus(`Importación aplicada: ${r.created} nuevos y ${r.updated} actualizados.`);
 }catch(e){if(importCurrent(target,epoch)){importPreview=null;importStatus(e.message+' Revisá la carga nuevamente antes de confirmar.');}}
 finally{if(importCurrent(target,epoch))importBusy=false;}
}
async function cancelSelectedSalesImport(){
 if(importBusy||!importSelection||!confirm('¿Cancelar este borrador? El catálogo activo no cambia.'))return;
 const target=companyId,epoch=importEpoch,id=importSelection.id;importBusy=true;
 try{await importPost(importBase(target)+'/'+id+'/cancel');if(importCurrent(target,epoch))await loadSalesImports();}
 catch(e){if(importCurrent(target,epoch))importStatus(e.message);}finally{if(importCurrent(target,epoch))importBusy=false;}
}
