import * as XLSX from "xlsx";
import {parseSalesPrice} from "./sales_catalog.js";
export function normalizeCatalogRowsFromWorkbook(base64, filename = "lista.xlsx") {
  const raw = String(base64 || "").replace(/^data:.*?;base64,/i, "");
  if (!raw) throw new Error("No se recibió el archivo.");

  const buffer = Buffer.from(raw, "base64");
  if (!buffer.length) throw new Error("El archivo está vacío.");
  if (buffer.length > 6 * 1024 * 1024) {
    throw new Error("La lista supera 6 MB.");
  }

  const wb = XLSX.read(buffer, { type: "buffer", raw:true, sheetRows:10002 });
  const firstSheet = wb.SheetNames?.[0];
  if (!firstSheet) throw new Error("El archivo no tiene hojas.");

  const sheet=wb.Sheets[firstSheet];
  if(sheet['!fullref']&&XLSX.utils.decode_range(sheet['!fullref']).e.r>10000)throw Error('La importación admite hasta 10000 filas por archivo.');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], {
    defval: "",
    raw: false
  });
  // Keep formatted codes (e.g. 000123), but use actual numeric price cells.
  const numericRows=XLSX.utils.sheet_to_json(wb.Sheets[firstSheet],{defval:'',raw:true});
  rows.forEach((row,i)=>{for(const key of Object.keys(row)){
    if(['PRECIO','PRICE','VALOR','PRECIO UNITARIO','PRECIO_UNITARIO'].includes(key.trim().toUpperCase())&&typeof numericRows[i]?.[key]==='number')row[key]=numericRows[i][key];
  }});

  const pick = (row, names) => {
    const entries = Object.entries(row || {});
    for (const name of names) {
      const normalized = String(name).trim().toLowerCase();
      const found = entries.find(([k]) =>
        String(k).trim().toLowerCase() === normalized
      );
      if (found) return found[1];
    }
    return "";
  };

  const normalized = rows.filter(row=>Object.values(row).some(v=>String(v).trim())).map((row,i) => {
    if(!String(pick(row,["NOMBRE","PRODUCTO","DESCRIPCION CORTA","DESCRIPCIÓN CORTA"])||"").trim())throw Error(`Fila ${i+2}: falta el nombre.`);
    const precioRaw = pick(row, ["PRECIO", "PRICE", "VALOR", "PRECIO UNITARIO", "PRECIO_UNITARIO"]);
    const modoPrecio=String(pick(row,['MODO_PRECIO','MODO PRECIO'])||'FIJO').trim().toUpperCase();
    const precio=modoPrecio==='A_COTIZAR'&&!String(precioRaw).trim()?0:parseSalesPrice(precioRaw);

    const item = {
      codigo: String(pick(row, ["CODIGO", "CÓDIGO", "SKU", "ID"]) || "").trim(),
      tipoItem: String(pick(row, ["TIPO_ITEM", "TIPO", "TYPE"]) || "PRODUCTO").trim().toUpperCase(),
      nombre: String(pick(row, ["NOMBRE", "PRODUCTO", "DESCRIPCION CORTA", "DESCRIPCIÓN CORTA"]) || "").trim(),
      descripcion: String(pick(row, ["DESCRIPCION", "DESCRIPCIÓN", "DETALLE"]) || "").trim(),
      precio,modoPrecio,
      unidad: String(pick(row, ["UNIDAD", "MEDIDA"]) || "unidad").trim(),
      categoria: String(pick(row, ["CATEGORIA", "CATEGORÍA", "RUBRO"]) || "").trim(),
      marca: String(pick(row, ["MARCA", "BRAND"]) || "").trim(),
      activo: String(pick(row,["ACTIVO"])||"SI").trim().toUpperCase()
    };
    const optional={tipoItem:['TIPO_ITEM','TIPO','TYPE'],descripcion:['DESCRIPCION','DESCRIPCIÓN','DETALLE'],modoPrecio:['MODO_PRECIO','MODO PRECIO'],unidad:['UNIDAD','MEDIDA'],categoria:['CATEGORIA','CATEGORÍA','RUBRO'],marca:['MARCA','BRAND'],activo:['ACTIVO']};
    const keys=Object.keys(row).map(k=>k.trim().toUpperCase());
    for(const [field,aliases] of Object.entries(optional))if(!aliases.some(k=>keys.includes(k)))delete item[field];
    return item;
  }).filter(x => x.nombre);

  if (!normalized.length) {
    throw new Error(
      `No encontré productos en ${filename}. La lista necesita al menos una columna NOMBRE o PRODUCTO.`
    );
  }

  if (normalized.length > 10000) {
    throw new Error("La importación admite hasta 10000 filas por archivo.");
  }

  return normalized;
}
