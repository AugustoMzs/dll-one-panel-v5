// Mensaje de error seguro para devolver al navegador.
// Los errores del sistema (base de datos, red) pueden traer datos internos:
// nombres de tablas, consultas o direcciones. Esos se registran en el log y el
// usuario recibe un texto genérico. Los errores propios de la aplicación
// (mensajes pensados para el usuario) pasan sin cambios.

const GENERIC = "Error interno. Intentá de nuevo en unos minutos.";

export function isSystemError(err) {
  if (!err || typeof err !== "object") return false;
  const code = typeof err.code === "string" ? err.code : "";
  // Códigos de PostgreSQL (ej. 23505, 42P01) y de red de Node (ej. ECONNREFUSED).
  if (/^[0-9A-Z]{5}$/.test(code)) return true;
  if (/^E[A-Z]{3,}$/.test(code)) return true;
  // Campos que solo trae un error de pg.
  if (err.severity || err.routine || err.schema || err.table) return true;
  return err.name === "AggregateError";
}

export function safeMessage(err, log = console.error) {
  if (isSystemError(err)) {
    log("[error interno]", err);
    return GENERIC;
  }
  return String(err?.message || err || "Error");
}

export const GENERIC_ERROR = GENERIC;
