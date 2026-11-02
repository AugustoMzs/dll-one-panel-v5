# DLL One — auditoría técnica incremental (2 de noviembre de 2026)

## Alcance y límites

Revisión estática de GitHub `main`, del inventario de archivos de ambos repositorios y del estado de despliegues de Railway. No se inspeccionó el contenido real de la base productiva, archivos en Drive, secretos ni mensajes privados; no se efectuó pentest ni restauración de respaldo. Tampoco se verificó un flujo real de WhatsApp con la cuenta de Meta.

**Entrypoints que ejecuta Railway**: panel `node src/server.js` v5.8.7; motor `node src/server.js` v4.3.19. Ambos proyectos y PostgreSQL aparecen online al 02/11/2026. La existencia de código no demuestra cobertura funcional completa.

## Hallazgos confirmados

| Nivel | Hallazgo | Evidencia / acción |
|---|---|---|
| Urgente | El `POST /webhook` del motor no validaba `X-Hub-Signature-256`. | Corregido en rama de seguridad, PR #35 del motor; **no** desplegar hasta tener `META_APP_SECRET`, pruebas y revisión. |
| Alto | `GET /runtime-status` del motor exponía lista de empresas y `phoneNumberId` sin autenticación. | Corregido en la misma propuesta PR #35. |
| Alto | `GET /gemini-health` y `GET /ai-health` podían disparar llamadas de IA sin autenticación cuando el proveedor no era OpenAI. | Corregido en PR #35. |
| Alto | Dependencia `xlsx@^0.18.5` para archivos importados por clientes. | CVE-2023-30533 y CVE-2024-22363. La distribución npm 0.18.5 no tiene corrección; evaluar SheetJS CE 0.20.3 oficial, actualizando *package.json* y lock juntos y corriendo pruebas de CSV/Excel con archivos malformados. Fuente: https://cdn.sheetjs.com/advisories/CVE-2024-22363 y https://docs.sheetjs.com/docs/getting-started/installation/nodejs/ |
| Alto | No se certificó un respaldo externo periódico **restaurable** del panel ni del motor. | Definir objetivos de recuperación, almacenamiento separado, cifrado, retención, prueba de restore, sin modificar datos productivos. |
| Medio | Política de CSP desactivada (`helmet({contentSecurityPolicy:false})`), con JS/handlers inline en la interfaz. | Auditoría y migración gradual para habilitar CSP sin romper el panel. |
| Medio | Login del panel sin limitador de intentos visible en `src/server.js`/`src/auth.js`. | Diseñar limitación distribuida, alertas y autenticación robusta; evitar bloqueo global por IP detrás de proxies. |
| Medio | Persisten `postBridge`, `bridge.snapshotGet` y eventos espejo al sistema Google legado. | Migrar históricos/archivos y verificar independencia total antes de apagar Apps Script. |
| Medio | Falta paridad completa de funciones heredadas. | Preferencias, edición de pedidos, seguimiento comercial, presupuestos, avisos, menú y chat web; ver auditoría del 30/10. |

## Duplicados y código antiguo

Inventario estático exacto por SHA Git de ambos árboles en `main`:
- **Panel:** 113 archivos versionados, 18 grupos de archivos con bytes idénticos. Ejemplos: `customers.js` / `src/customers.js`, `schema.sql` / `sql/schema.sql`, `test/thread_dates.test.js` / `thread_dates.test.js`, `logo.png` / `public/logo.png`.
- **Motor:** 112 archivos versionados, 3 pares exactos: `bridge.js` / `src/bridge.js`, `menu_upload.js` / `src/menu_upload.js`, `queue.js` / `src/queue.js`.
- Existen, además, **copias divergentes** `server.js` / `src/server.js`, `agent.js` / `src/agent.js`, `db.js` / `src/db.js`, etc. Sus bytes son distintos y no se pueden fusionar ni borrar sin comprobar referencias.
- La carpeta `public/` contiene recursos servidos directamente; duplicados allí pueden ser necesarios si `index.html` los referencia. Nunca borrarlos por similitud de nombre.
- Los archivos de raíz no son el entrypoint de los scripts actuales de npm, pero pueden seguir siendo referencias de documentación o integración externa. Identificar y eliminar únicamente tras comprobar referencias, pruebas y rollback.
- Ejecutar `node scripts/repository_inventory.mjs` para repetir el inventario del panel después de cada cambio. Es lectura pura; no modifica archivos.

## Etapas de saneamiento

1. Ejecutar CI completo en ramas del motor y panel. Bloquear integraciones si fallan las pruebas o la revisión de seguridad.
2. Resolver firma Meta y acceso a rutas públicas; aplicar después de configurar `META_APP_SECRET` y probar contra eventos reales.
3. Actualizar `xlsx` con lock válido y prueba de importación de archivos legítimos y adversariales, sin tocar el catálogo real.
4. Revisar rutas, autorización y datos por empresa; corregir condiciones de carrera y estados inválidos con pruebas multiempresa.
5. Depurar duplicados por dependencia real y homologar la única fuente de verdad en `src/` y `public/`.
6. Migrar funcionalidades heredadas, históricos y adjuntos; verificar colas, respaldo y recuperación antes de retirar Google.
7. Retomar entregas funcionales: edición de pedidos, preferencias por empresa, seguimiento de clientes, herramientas comerciales, indicadores.

## Regla de despliegue

No mezclar auditoría, borrado de código, migración y cambios en pedidos en un único despliegue. Cada pull request debe incluir pruebas, límites y plan de reversión. Ninguna propuesta de este documento modifica datos ni despliega cambios automáticamente.
