# Ubicación de retiro: pruebas de almacenamiento

Las comprobaciones de almacenamiento antes estaban en el repositorio del motor
e importaban el panel desde una carpeta hermana que no existe en un checkout
independiente. Ahora `test/pickup_storage.test.js` importa el módulo real del
panel y ejecuta sus consultas contra PGlite.

Tres pruebas cubren guardar/editar por empresa sin afectar otra, borrar sin
revivir una dirección de configuración antigua y primera instalación con
dirección configurada o ausente. El motor conserva pruebas propias del
contrato de respuesta y no requiere importar código del panel.

Validación: 46/46 pruebas seleccionadas del panel pasan, incluyendo estas tres,
acceso, permisos de operación de Salud, agenda, asistente y preferencias de voz.
No es una ejecución de toda la suite del panel. Solo cambia pruebas y
documentación; no hay cambios de esquema ni de código de producción.
No se consultó la base real ni Railway/WhatsApp.
