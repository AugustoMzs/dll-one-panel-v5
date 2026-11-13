# ONE Barberías — operación y validación

## Funciones implementadas

La empresa selecciona ONE Barberías como módulo exclusivo. Los servicios tienen nombre, precio final en centavos ARS, duración de 5 a 240 minutos y visibilidad. Cada profesional tiene servicios asignados, días, horario, descanso y fechas bloqueadas. Agenda diaria y configuración disponibles desde el panel, también en la navegación móvil.

Por WhatsApp, la IA interpreta solicitudes, referencias, fechas y horarios; el servidor calcula disponibilidad y precios desde los datos de la empresa. Puede listar servicios, buscar horarios, preparar y confirmar turnos, consultar turnos propios, cancelar con confirmación y reprogramar. La reprogramación conserva el turno anterior hasta confirmar el nuevo en una transacción. No se requieren DNI ni datos clínicos.

Se muestran horarios en Argentina (America/Argentina/Buenos_Aires), hasta 90 días hacia adelante. Cada profesional atiende una persona a la vez. Inicios cada cinco minutos, duración real del servicio, descanso y cierre incluidos en el cálculo. No hay cupos grupales ni atención simultánea del mismo profesional.

## Integridad

- Empresa y teléfono del motor verificados; rutas del panel con autenticación, pertenencia y módulo.
- Editar configuración requiere editCatalog; cambiar estados requiere operate; escrituras bloqueadas si el servicio no está ACTIVE.
- Reserva/cancelación/reprogramación bloquean la fila de configuración de la empresa en una transacción. Las reservas revalidan solapamientos y revisión de configuración.
- Precio, duración, dirección y nombres quedan guardados como datos históricos del turno.
- Mensajes repetidos con el mismo identificador devuelven el resultado anterior.
- Confirmar requiere propuesta previa; rechazarla elimina la aceptación pendiente. Cambiar un dato obliga a revisar la propuesta otra vez.
- Cancelaciones por WhatsApp solo acceden a turnos del mismo número y empresa. Consultas no generan reservas.
- La interfaz usa textContent/valores de controles y descarta respuestas de otra empresa.

## Límites y activación

No incluye cobro de señas ni recordatorios automáticos, sincronización con calendarios externos o una página pública de reservas. Las condiciones de seña se muestran como información; no se valida un pago. Cambios de estado desde el panel no envían avisos automáticamente. La empresa debe avisar al cliente si cancela desde allí. Cambiar horarios no modifica los turnos existentes, que continúan ocupando su intervalo.

El motor reutiliza el consentimiento de audio y el procesamiento de notas de voz existente. Los comprobantes priorizan el texto; la preferencia explícita de solo audio sigue la política común del motor. Las pruebas locales simulan IA y WhatsApp: no prueban la comprensión de cada proveedor ni la entrega real de Meta/ElevenLabs.

Antes de conectar el primer negocio: cargar sus servicios, precios, profesionales y horarios reales; conectar el número asignado; verificar por WhatsApp servicio/precio, disponibilidad, confirmación, repetición, cancelación, reprogramación, audio solicitado y vuelta a texto. Verificar móvil Safari/Chrome y dos usuarios reales compitiendo por el mismo horario.

## Despliegue

Tablas aditivas panel_barber_config, panel_barber_appointments, panel_barber_chats y panel_barber_messages. No se altera ningún catálogo o configuración de empresas existentes. Integrar motor antes que panel. Una reversión conserva las tablas, pero requiere pausar empresas de Barberías hasta que el código con soporte vuelva a estar disponible.
