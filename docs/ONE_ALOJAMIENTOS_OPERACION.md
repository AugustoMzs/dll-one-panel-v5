# ONE Cabañas: operación de alojamientos

## Alcance de esta actualización

- Secciones: Resumen, Alojamientos, Solicitudes, Calendario, Reservas y Configuración.
- Fichas con dormitorios, baños, camas y servicios Sí/No/Sin informar. Una ficha representa una unidad física: cargar por separado dos cabañas del mismo tipo para gestionar su ocupación.
- Hasta seis fotos JPG/PNG de 400 KB por unidad y 8 MB de imágenes en el catálogo completo. Se puede quitar una foto o elegir portada. El bot distribuye hasta seis imágenes entre las opciones mostradas. El motor complementario envía el nombre verificado del alojamiento como pie de foto.
- Precios guardados en centavos: moneda ARS/USD/EUR, tarifa por noche, mínimo de noches, personas incluidas, adicional por persona/noche, limpieza por estadía y temporadas sin superposición. Entrada incluida, salida excluida. Los importes cargados deben ser finales con impuestos incluidos; no se calcula normativa fiscal. Sin tarifa para una noche, no se inventa el total.
- Información del establecimiento: dirección, cómo llegar, ingreso/salida, mascotas, señas, cancelaciones, normas e información turística escrita por la empresa.
- La IA clasifica consultas y extrae datos. La respuesta y los importes salen de datos validados. Preguntas de servicios no reenvían todo el catálogo. Fechas, personas y selección se conservan en el contexto reciente (4 intercambios, 30 minutos).
- Una solicitud explícita por WhatsApp crea PENDING con referencia; no ocupa fechas. Repetir el mismo contacto/unidad/fechas/personas devuelve el registro existente. Una solicitud cancelada no se reactiva automáticamente: el operador puede crear una nueva manual.
- Solo un operador con permiso de edición confirma o cancela. CONFIRMED y BLOCKED ocupan fechas. Las mutaciones usan una transacción con bloqueo de la fila del catálogo de la empresa y revalidan superposición. El calendario mensual consulta la ocupación por fechas, independientemente del límite de 500 registros del listado administrativo.
- La cotización se conserva en la solicitud; confirmar no recalcula importes históricos. Si es a cotizar, el operador debe acordar el precio por WhatsApp. Cambiar fechas se hace cancelando el registro y creando otro; no hay arrastre de reservas.

## Límites explícitos

No hay sincronización con Booking/Airbnb/iCal, pagos automáticos, emisión de comprobantes ni mensajes automáticos de confirmación/cancelación desde el panel. El operador debe actualizar ocupación externa y avisar al huésped desde la conversación. No se promete una notificación a la propietaria. La conversación usa fecha de referencia de Argentina. Las preguntas ambiguas requieren aclaración. No se han enviado mensajes a huéspedes reales durante el desarrollo.

## Datos y reversión

Migración aditiva al iniciar: panel_lodging_settings y panel_lodging_bookings e índice de ocupación. Los catálogos existentes conservan sus campos; los nuevos campos son opcionales. Las rutas heredan autenticación, pertenencia y módulo de empresa, y las escrituras exigen editCatalog y servicio ACTIVE. El servidor no confía en IDs, importes ni disponibilidad generados por la IA.

Antes de activar para un cliente: registrar disponibilidad completa, tarifas y condiciones reales, probar dos solicitudes solapadas, cancelación, reintento, cambio de empresa y flujo de audio. Confirmar la representación de los formularios/calendario en Safari y Chrome de teléfono. La validación local usa PostgreSQL embebido y adaptadores de IA/WhatsApp simulados, no sustituye la prueba real.

Desplegar panel y motor compatibles. Revertir código conserva las tablas nuevas pero deja sin interfaz de gestión las reservas creadas; pausar Cabañas si se revierte el panel hasta restablecer la gestión.
