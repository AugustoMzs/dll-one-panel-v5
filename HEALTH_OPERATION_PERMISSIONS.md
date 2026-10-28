# Permisos de operación en Salud

Las rutas administrativas `POST /api/company/:companyId/health/book` y
`POST /api/company/:companyId/health/chat` ahora utilizan `canOperate`, igual
que la modificación de estados de turnos. El chat de pruebas puede guardar
estado y reservar turnos, por lo que requiere permiso para operar.

Un usuario con `operate: false` conserva la consulta de agenda, pero recibe
403 al intentar reservar o utilizar ese chat. Se conserva el acceso de
operadores y Super Admin, así como los controles existentes de empresa,
usuario activo, módulo y estado del servicio. Si falla la consulta del permiso,
se devuelve 503 antes de escribir o invocar la IA.

No cambia el endpoint del motor `/motor/health/chat`, la política histórica
para permisos sin flags, el esquema de datos ni las dependencias. No incluye
integración con HSI.

## Validación

- Siete pruebas nuevas ejecutan las rutas y middleware extraídos del servidor
  con HTTP local y una base PGlite. Cubren consulta, reserva, cancelación,
  chat, aislamiento por empresa, usuarios inactivos, permisos denegados,
  autenticación ausente, servicio suspendido, módulo incorrecto, fallos de
  permisos y Super Admin.
- Antes del cambio: 4 pruebas pasan y 3 fallan, reproduciendo el acceso indebido.
- Después: 43/43 pruebas seleccionadas pasan, incluyendo las siete nuevas y
  las suites existentes de acceso, Salud, agenda y preferencias de voz.
- `npm run check` pasa.

La autenticación y la respuesta de IA se simulan en la nueva suite; las
operaciones de agenda y persistencia se ejecutan en la base de prueba.
No se probó Railway, WhatsApp, HSI ni un proveedor de IA real. Este resultado
no equivale a una auditoría completa de la plataforma.
