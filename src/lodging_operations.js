import {randomUUID,createHash} from 'node:crypto';
export const AMENITIES=['wifi','pool','parking','kitchen','airConditioning','heating','accessible','pets'];
export function text(v,max=500){if(typeof v!=='string'||v.length>max)throw Error('Texto inválido.');return v.trim();}
function integer(v,min,max){if(!Number.isInteger(v)||v<min||v>max)throw Error('Número fuera de rango.');return v;}
export function date(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw Error('Fecha inválida. Usá año-mes-día.');return v;}
export function lodgingToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
export function stay(start,end){date(start);date(end);const n=(Date.parse(end)-Date.parse(start))/86400000;if(n<1||n>365)throw Error('La salida debe ser posterior a la entrada; máximo 365 noches.');return n;}
export function details(x={}){
 const amenities={};for(const key of AMENITIES){const v=x.amenities?.[key]??null;if(v!==null&&typeof v!=='boolean')throw Error('Servicio inválido.');amenities[key]=v;}
 const p=x.pricing||{};const nightly=p.nightly??null;if(nightly!==null)integer(nightly,0,100000000000);
 const currency=p.currency||'ARS';if(!['ARS','USD','EUR'].includes(currency))throw Error('Moneda inválida.');
 const seasons=(p.seasons||[]);if(!Array.isArray(seasons)||seasons.length>24)throw Error('Hasta 24 temporadas.');
 const periods=seasons.map(s=>{stay(s.start,s.end);return {start:s.start,end:s.end,nightly:integer(s.nightly,0,100000000000)};}).sort((a,b)=>a.start.localeCompare(b.start));
 for(let i=1;i<periods.length;i++)if(periods[i].start<periods[i-1].end)throw Error('Las temporadas no pueden superponerse.');
 return {bedrooms:x.bedrooms==null?null:integer(x.bedrooms,0,30),beds:text(x.beds||'',150),bathrooms:x.bathrooms==null?null:integer(x.bathrooms,0,30),amenities,
 pricing:{nightly,currency,minNights:integer(p.minNights??1,1,365),cleaning:integer(p.cleaning??0,0,100000000000),includedGuests:integer(p.includedGuests??30,1,30),extraGuest:integer(p.extraGuest??0,0,100000000000),seasons:periods}};
}
export function settings(x={}){const v={};for(const k of ['address','directions','checkIn','checkOut','petsPolicy','cancellation','deposit','rules','tourism'])v[k]=text(x[k]||'',1000);return v;}
export async function initOperations(db){
 await db.query(`CREATE TABLE IF NOT EXISTS panel_lodging_settings(company_id TEXT PRIMARY KEY,settings JSONB NOT NULL DEFAULT '{}',revision INTEGER NOT NULL DEFAULT 0)`);
 await db.query(`CREATE TABLE IF NOT EXISTS panel_lodging_bookings(id TEXT PRIMARY KEY,company_id TEXT NOT NULL,cabin_id TEXT NOT NULL,contact TEXT NOT NULL DEFAULT '',guest_name TEXT NOT NULL DEFAULT '',arrival DATE NOT NULL,departure DATE NOT NULL,guests INTEGER NOT NULL CHECK(guests BETWEEN 1 AND 30),status TEXT NOT NULL CHECK(status IN ('PENDING','CONFIRMED','BLOCKED','CANCELLED')),quote JSONB,note TEXT NOT NULL DEFAULT '',request_key TEXT,revision INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CHECK(departure>arrival),UNIQUE(company_id,request_key))`);
 await db.query('CREATE INDEX IF NOT EXISTS lodging_occupancy ON panel_lodging_bookings(company_id,cabin_id,arrival,departure)');
}
export function money(cents,currency){return new Intl.NumberFormat('es-AR',{style:'currency',currency,maximumFractionDigits:2}).format(cents/100);}
export function quote(cabin,start,end,guests){const nights=stay(start,end);integer(guests,1,cabin.capacity);const p=details(cabin.details).pricing;if(nights<p.minNights)throw Error(`La estadía mínima es de ${p.minNights} noches.`);
 let subtotal=0;const lines=[];for(let i=0;i<nights;i++){const day=new Date(Date.parse(start)+i*86400000).toISOString().slice(0,10),season=p.seasons.find(s=>s.start<=day&&day<s.end),rate=season?season.nightly:p.nightly;if(rate===null)return null;const extra=Math.max(0,guests-p.includedGuests)*p.extraGuest;subtotal+=rate+extra;lines.push({day,nightly:rate,extra});}
 const total=subtotal+p.cleaning;if(!Number.isSafeInteger(total))throw Error('Importe fuera de rango.');return {currency:p.currency,nights,guests,subtotal,cleaning:p.cleaning,total,lines};}
export async function getSettings(db,id){return (await db.query('SELECT settings,revision FROM panel_lodging_settings WHERE company_id=$1',[id])).rows[0]||{settings:settings(),revision:0};}
export async function saveSettings(db,id,input){const value=settings(input.settings);integer(input.revision,0,2147483647);await db.query('INSERT INTO panel_lodging_settings(company_id) VALUES($1) ON CONFLICT DO NOTHING',[id]);const r=await db.query('UPDATE panel_lodging_settings SET settings=$2,revision=revision+1 WHERE company_id=$1 AND revision=$3 RETURNING revision',[id,JSON.stringify(value),input.revision]);if(!r.rows.length)throw Error('La configuración cambió. Actualizá antes de guardar.');return r.rows[0];}
export async function bookings(db,id){return (await db.query(`SELECT *,arrival::text AS arrival,departure::text AS departure FROM panel_lodging_bookings WHERE company_id=$1 ORDER BY arrival DESC,created_at DESC LIMIT 500`,[id])).rows;}
export async function occupied(db,id,cabin,start,end,except=''){stay(start,end);return (await db.query(`SELECT id FROM panel_lodging_bookings WHERE company_id=$1 AND cabin_id=$2 AND status IN ('CONFIRMED','BLOCKED') AND arrival<$4::date AND departure>$3::date AND id<>$5 LIMIT 1`,[id,cabin,start,end,except])).rows.length>0;}
async function transaction(db,fn){const client=typeof db.connect==='function'?await db.connect():db;try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{if(client!==db)client.release();}}
export async function writeBooking(db,company,input,{customer=false}={}){return transaction(db,async client=>{
 // Serializes all occupancy changes for this company without requiring database extensions.
 await client.query('INSERT INTO panel_lodging_catalog(company_id) VALUES($1) ON CONFLICT DO NOTHING',[company]);
 const catalog=(await client.query('SELECT items FROM panel_lodging_catalog WHERE company_id=$1 FOR UPDATE',[company])).rows[0].items;
 if(input.id&&!customer){const current=(await client.query('SELECT *,arrival::text AS arrival,departure::text AS departure FROM panel_lodging_bookings WHERE company_id=$1 AND id=$2',[company,input.id])).rows[0];if(!current||current.revision!==input.revision)throw Error('La reserva cambió o no existe. Actualizá la lista.');
 if(!['CONFIRMED','CANCELLED'].includes(input.status)||current.status==='CANCELLED'||(input.status==='CONFIRMED'&&current.status!=='PENDING'))throw Error('Cambio de estado no permitido.');
 if(input.status==='CONFIRMED'){if(current.arrival<lodgingToday())throw Error('La fecha de entrada ya pasó. Creá una solicitud con fechas vigentes.');const cabin=catalog.find(x=>x.id===current.cabin_id&&x.active);if(!cabin||current.guests>cabin.capacity)throw Error('La cabaña está oculta o cambió su capacidad.');if(await occupied(client,company,current.cabin_id,String(current.arrival).slice(0,10),String(current.departure).slice(0,10),current.id))throw Error('Esas fechas ya están ocupadas.');}
 await client.query('UPDATE panel_lodging_bookings SET status=$3,revision=revision+1 WHERE company_id=$1 AND id=$2',[company,input.id,input.status]);return {...current,status:input.status,revision:current.revision+1};}
 const cabin=catalog.find(x=>x.id===input.cabinId&&x.active);if(!cabin)throw Error('Elegí una cabaña activa.');stay(input.arrival,input.departure);if(input.arrival<lodgingToday())throw Error('La fecha de entrada ya pasó. Elegí fechas vigentes.');integer(input.guests,1,cabin.capacity);
 const contact=text(input.contact||'',30),guestName=text(input.guestName||'',120),note=text(input.note||'',500);if(contact&&!/^\+?\d{7,20}$/.test(contact))throw Error('Teléfono inválido.');if(customer&&!contact)throw Error('Falta el contacto.');
 const status=customer?'PENDING':input.status;if(!['PENDING','BLOCKED'].includes(status))throw Error('Creá una solicitud o un bloqueo.');
 const requestKey=customer?createHash('sha256').update(JSON.stringify([contact,cabin.id,input.arrival,input.departure,input.guests])).digest('hex'):null;
 if(requestKey){const previous=(await client.query('SELECT *,arrival::text AS arrival,departure::text AS departure FROM panel_lodging_bookings WHERE company_id=$1 AND request_key=$2',[company,requestKey])).rows[0];if(previous)return previous;}
 if(await occupied(client,company,cabin.id,input.arrival,input.departure))throw Error('Esas fechas ya están ocupadas.');
 const pricing=status==='BLOCKED'?null:quote(cabin,input.arrival,input.departure,input.guests);const id=randomUUID();
 return (await client.query(`INSERT INTO panel_lodging_bookings(id,company_id,cabin_id,contact,guest_name,arrival,departure,guests,status,quote,note,request_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *,arrival::text AS arrival,departure::text AS departure`,[id,company,cabin.id,contact,guestName,input.arrival,input.departure,input.guests,status,pricing?JSON.stringify(pricing):null,note,requestKey])).rows[0];
 });}

export async function calendar(db,id,month){
 if(typeof month!=='string'||!/^\d{4}-\d{2}$/.test(month))throw Error('Mes inválido.');
 const start=date(month+'-01');const d=new Date(start);d.setUTCMonth(d.getUTCMonth()+1);const end=d.toISOString().slice(0,10);
 return (await db.query("SELECT cabin_id,arrival::text AS arrival,departure::text AS departure,status FROM panel_lodging_bookings WHERE company_id=$1 AND status IN ('CONFIRMED','BLOCKED') AND arrival<$3::date AND departure>$2::date",[id,start,end])).rows;
}
