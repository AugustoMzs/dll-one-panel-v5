# DLL One — backups cifrados y restauración verificada de PostgreSQL

ALCANCE: base PostgreSQL del panel únicamente. No cubre todavía el volumen /data del motor, mensajes pendientes, credenciales o datos ajenos a PostgreSQL.

## Procedimiento automático

Un contenedor de cron separado genera un pg_dump en formato custom, cifra con AES-256-GCM y un nonce aleatorio y sube el archivo cifrado a un bucket S3 privado fuera del volumen de PostgreSQL. Luego vuelve a descargar el objeto, comprueba SHA-256, verifica su autenticidad GCM y lo restaura dentro de un PostgreSQL temporal aislado (socket Unix, sin acceso a la red ni a producción). Sólo después de que la restauración resulte correcta y encuentre tablas escribe el archivo acompañante .verified.txt.

El servicio de respaldo debe usar ops/backup/Dockerfile y 0 6 * * * como cron UTC (03:00 en Mendoza). No necesita dominio web. La aplicación principal no ejecuta backups ni conserva claves de cifrado de este servicio.

## Variables del cron (referencias de Railway)

- DATABASE_URL: referencia Postgres.DATABASE_URL
- BACKUP_BUCKET: referencia al atributo BUCKET del bucket dllone-postgres-backups
- BACKUP_ENDPOINT: referencia al atributo ENDPOINT del mismo bucket
- AWS_ACCESS_KEY_ID: referencia a ACCESS_KEY_ID
- AWS_SECRET_ACCESS_KEY: referencia a SECRET_ACCESS_KEY
- AWS_DEFAULT_REGION: referencia a REGION
- BACKUP_AES256_KEY: clave secreta independiente de 32 bytes en base64; nunca compartir por chat ni guardar en GitHub.

## Recuperación

1. Obtener del bucket un objeto postgres/v1/*.dump.aes que tenga un marcador .verified.txt. Verificar SHA-256.
2. En un entorno aislado, proporcionar BACKUP_AES256_KEY mediante gestor de secretos y ejecutar node ops/backup/backup_crypto.mjs decrypt archivo.aes archivo.dump.
3. Comprobar pg_restore --list archivo.dump. Restaurar SIEMPRE en una base nueva y vacía antes de pensar en volver a producción.
4. Verificar tablas, recuentos, datos por empresa, cuentas, pedidos y permisos. Preservar la base original. El respaldo no sustituye la prueba E2E del bot.
5. Destruir archivos temporales plaintext de manera segura y documentar la intervención.

## Limitaciones y obligaciones

- El bucket reside en Railway: está separado de un volumen pero no es una copia fuera del proveedor. Se requiere además una segunda copia bajo otra cuenta/proveedor para recuperación total.
- Sin resguardar la clave AES fuera de Railway, perder la cuenta podría hacer los archivos irrecuperables. Guardar una copia en un gestor de secretos externo.
- Railway Buckets no ofrece versionado, object lock ni reglas de ciclo de vida, así que este trabajo NO borra automáticamente backups. Vigilar costos y retención.
- Railway Buckets cifra en reposo, y además este proceso aplica AES-GCM con autenticación por archivo.
- El marcador de verificación demuestra una restauración aislada de ese archivo, no certifica que toda la plataforma pueda restaurarse.
- Queda por respaldar por separado /data del motor y comprobar la recuperación integral de WhatsApp, pedidos e historial.

Documentación Railway: https://docs.railway.com/guides/postgres-backups-restores y https://docs.railway.com/storage-buckets
