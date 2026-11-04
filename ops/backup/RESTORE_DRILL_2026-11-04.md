# DLL One — Acta de prueba de restauración PostgreSQL

## Comprobación del 4 de noviembre de 2026 (UTC)

- Trabajador: dllone-postgres-backup-cron, proyecto Railway del panel, producción.
- Origen: PostgreSQL activo del panel; exportación lógica de solo lectura mediante pg_dump.
- Destino de la copia: bucket privado dllone-postgres-backups, otra región de Railway, separado del volumen de PostgreSQL.
- Procedimiento: dump custom, cifrado autenticado AES-256-GCM, subida al bucket, descarga, verificación SHA-256, descifrado autenticado, pg_restore en PostgreSQL temporal mediante socket local.
- Resultado: Railway informó `cronSucceeded`, última ejecución exitosa a las 2026-11-04T03:00:56.588Z.
- Evidencia en los logs: `[BACKUP] VERIFIED: encrypted archive uploaded, downloaded, authenticated and restored to scratch database. Tables=47.`
- El marcador remoto `.verified.txt` solo se genera DESPUÉS de terminar la restauración. El procedimiento no ejecuta pg_restore contra la URL de producción.
- La versión utilizada incluía su-exec, preflight de herramientas y chequeo de las tablas críticas panel_companies, panel_users y panel_orders.

## Hallazgos

La primera ejecución de desarrollo falló con `su-exec: not found` y NO alcanzó el marcador de éxito. Se corrigió en PR #29 y se añadió verificación de herramientas y tablas críticas en PR #30. Tras el despliegue GitHub de la imagen correcta, la ejecución de las 03:00:56 UTC completó la restauración y el marcador verificado.

## Operación actual

Servicio cron configurado con expresión UTC `0 6 * * *`, que equivale a las 03:00 de Mendoza. Reinicios automáticos de un proceso de respaldo fallido deshabilitados. El contenedor no sirve HTTP ni tiene volumen adjunto.

## No se considera cerrado todavía

- El archivo de estado del motor (/data) no está incluido; falta un backup y restauración de prueba separados.
- El bucket Railway es off-volume pero no está fuera del proveedor. Para recuperación ante pérdida completa de Railway, replicar a otra cuenta/proveedor.
- La clave AES-256-GCM debe quedar custodiada también FUERA de Railway en un gestor de secretos controlado por el propietario. Sin esa clave no es posible restaurar la copia cifrada.
- Es necesario comprobar en forma periódica el resultado real del cron; tener el servicio online no garantiza que cada ejecución diaria haya sido verificada.
- Un restore de 47 tablas confirma integridad lógica básica de ese archivo; aún falta un simulacro integral con arranque del panel y pruebas de negocio sobre una base restaurada separada.

Enlaces: ops/backup/README.md; PR #28, PR #29 y PR #30 de facundomuzas/dll-one-panel-v5.
