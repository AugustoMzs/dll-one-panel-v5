# Importación de catálogos ONE Ventas

## Alcance

Excel o CSV, primera hoja, hasta 6 MiB y 10.000 filas. Cada fila necesita código estable, nombre y precio válido (A_COTIZAR permite precio vacío). Los códigos se comparan exactamente, distinguiendo mayúsculas; duplicados en el archivo o coincidencias ambiguas en el catálogo bloquean la importación. Los códigos numéricos deben conservar su formato o estar como texto si contienen ceros iniciales.

La carga se guarda en lotes de 500 filas. Abrir Catálogo, seleccionar archivo y Cargar para revisar. La vista previa muestra totales y las primeras 50 filas; Confirmar importación es el único paso que modifica el catálogo. Cancelar sólo cierra el borrador. Para recuperar una carga incompleta, elegir Revisar / retomar y seleccionar el mismo archivo. Las repeticiones idénticas de lotes y aplicación no duplican productos.

Al actualizar por código se conserva el ID y los campos opcionales cuyas columnas no existan en el archivo. Una columna presente sí puede modificar esos valores. Los productos ausentes se conservan; no hay eliminación masiva. Los archivos CSV exportados con apóstrofos contra fórmulas no constituyen una restauración exacta. Es necesario abrir primero el catálogo nativo existente.

## Seguridad y consistencia

Se exige ONE Ventas, sesión vigente, pertenencia a la empresa y permiso editCatalog. Todas las operaciones se limitan a la empresa. La huella del contenido valida los lotes; una edición del catálogo entre vista previa y aplicación exige revisar de nuevo. La escritura del catálogo y del resultado auditado es transaccional. El texto de las filas se muestra sin interpretar HTML.

El inicio crea panel_sales_imports y panel_sales_import_batches sin alterar productos existentes. Se admiten 10 borradores pendientes por empresa; la lista muestra los últimos 20 registros priorizando pendientes. Los lotes y el resultado conservan actor y fecha; todavía no existe purga automática ni restauración de una versión anterior. No sustituye copias de seguridad externas.

## Despliegue y comprobación

Sólo cambia el panel. No requiere variables nuevas ni servicios pagos. El endpoint antiguo import-file devuelve 409 para impedir que una pestaña desactualizada aplique cargas sin revisión: actualizar la página. No se modifica el motor ni se elimina Apps Script.

Pruebas: npm test (80 pruebas) y comprobación de sintaxis. PostgreSQL mediante PGlite, rutas Express y UI mediante JSDOM: 1.001 filas, interrupción y reanudación, repetición, aislamiento entre empresas, permisos, cancelación, cambios concurrentes, rollback y validación de archivos. No se ha probado en producción ni en un navegador real; no hay medición de rendimiento con catálogos de gran tamaño.

Tras autorizar el despliegue, validar con una empresa de prueba: archivo de pocos productos, vista previa, cancelar; repetir y aplicar; revisar productos en panel y consumo por el motor. Probar pérdida de conexión durante una carga y retomar. No usar datos comerciales reales para la primera prueba.

Revertir el código no revierte los productos ya importados. Conservar ambas tablas al volver a una versión anterior y prever una copia de la base antes de cargas importantes.
