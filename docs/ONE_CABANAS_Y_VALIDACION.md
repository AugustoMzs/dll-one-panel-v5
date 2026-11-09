# ONE Cabañas y validación comercial

Estado: implementación preparada para revisión. No desplegada ni habilitada para ninguna empresa por este cambio.

## Alcance

ONE Cabañas es una configuración exclusiva por empresa, asignable por Super Admin en Mi negocio o al crear una empresa. Catálogo de hasta 30 cabañas: nombre, capacidad (1–30), características, tarifa y condiciones opcionales, visible/oculta y hasta 3 JPG/PNG de 400 KB cada una (8 MB acumulados). Las imágenes se guardan en PostgreSQL, sin URLs externas elegidas por el modelo. Editar requiere permiso editCatalog, pertenencia a la empresa y servicio activo. Revisión optimista impide sobreescribir cambios de otra sesión.

La IA interpreta cantidad de personas y referencias usando catálogo e historial de la misma empresa y contacto. La respuesta se construye con las fichas verificadas: no toma precios, URLs ni promesas del modelo. Se muestran hasta 3 opciones compatibles, hasta 6 fotos por respuesta y hasta 500 caracteres de descripción por ficha. Capacidad máxima mayor o igual a huéspedes, ordenada de menor a mayor. Se rechazan IDs inexistentes y cabañas ocultas. Catálogo vacío o datos insuficientes generan una aclaración.

El contexto reciente abarca los últimos 4 intercambios y deja de usarse tras 30 minutos. No existe agenda de ocupación ni se crean reservas. Las fechas, disponibilidad y confirmación se gestionan personalmente por WhatsApp. Esta entrega no automatiza pagos ni asegura que se haya avisado a la propietaria. El operador puede tomar la conversación desde el panel.

Los audios entrantes y la preferencia de salida usan la integración de voz existente, habilitada por Super Admin. Las fotos siguen siendo imágenes, aunque se solicite respuesta hablada. No se contrataron proveedores nuevos.

El chat del panel adopta colores y burbujas inspirados en WhatsApp claro, conservando marca DLL ONE, permisos y controles operativos. Vista previa con datos ficticios: [captura](whatsapp-chat-preview.jpg). No representa una sesión autenticada de producción.

## Validación realizada

- Panel: 146 pruebas aprobadas; motor: 285 pruebas aprobadas; sin fallos ni omisiones.
- Cabañas: validación del catálogo, aislamiento por empresa y contacto, capacidad 2/4/6, catálogo oculto, rechazo de IDs inventados, límite de texto, fallo de IA sin borrar contexto, permisos de escritura, servicio pausado y protección de revisiones.
- Motor Cabañas: despacho con adaptadores simulados, envío de fotos, persistencia del turno, modo humano y errores de envío ambiguos.
- Eventos: se agregó regresión de cupo, reintento idempotente, pago pendiente y aislamiento entre empresas.
- Suites existentes: Ventas, Gastro, Salud, voz, consentimiento, persistencia, errores de proveedor y aislamiento. Aprobarlas no equivale a comprobar cada función de extremo a extremo.
- Navegador: vista de chat y apertura de ficha editable con datos ficticios. No se probaron credenciales reales, cobros, conversaciones de clientes ni transcripción/síntesis real.

## Prueba obligatoria antes de vender cada módulo

Usar empresas y contactos de prueba autorizados. Registrar fecha, empresa, versión del motor/panel, mensaje, resultado esperado/real e ID de mensaje. No usar pacientes reales ni enviar mensajes masivos.

| Módulo | Prueba real pendiente | Criterio de aceptación |
|---|---|---|
| Gastro | Menú, pedido de varios productos, corrección, delivery/retiro, costo, pago, confirmación, consulta posterior y toma humana | Precios del catálogo, total correcto, un único pedido, hilo conservado |
| Ventas | Producto inequívoco/ambiguo, precio fijo/a cotizar, cambio de cantidad, seguimiento y traspaso humano | No inventa stock ni precios, respeta empresa y cotización |
| Salud | Especialidad/profesional, turno libre/ocupado, resumen, confirmar/cancelar, QR, planilla por médico | No duplica cupos, datos exactos y aislamiento; sigue siendo piloto administrativo, HSI no integrado |
| Eventos | Listado, inscripción, repetir mensaje, último cupo, pago pendiente/aprobado, QR e ingreso duplicado | Una inscripción, QR utilizable solo cuando corresponde, cupos respetados |
| Cabañas | «somos dos/cuatro/seis», «la primera», nombre, fotos, precio, fechas, petición de reserva | Fotos de la ficha correcta, capacidad suficiente, sin prometer disponibilidad ni reserva |
| Todos | Audio entrante, pedir audio una vez, volver a texto, proveedor caído y recuperación | Preferencia explícita, datos coherentes, ningún éxito ficticio ni pérdida del estado |

Eventos actualmente espera comandos como EVENTOS, ENTRADA código | Nombre Apellido | DNI y MIS ENTRADAS. No debe venderse como conversación completamente natural hasta adaptar y probar ese flujo.

## Publicación y reversión

1. Integrar y verificar primero el motor compatible con Cabañas.
2. Integrar el panel, verificar inicio y tablas nuevas. Migración aditiva, sin modificar datos de los otros módulos.
3. Crear una empresa de prueba de Cabañas, cargar fotos y fichas reales autorizadas y conectar un número de prueba. No cambiar Buda a otro módulo.
4. Ejecutar la matriz anterior. Activar comercialmente solo los módulos aprobados.
5. Si falla Cabañas, pausar esa empresa antes de revertir versiones. Revertir el panel/motor no borra automáticamente el catálogo ni el historial nuevos.

Faltan datos de la empresa de la tía (nombre, fichas, fotos, tarifas/condiciones y número). No se creó una empresa con datos inventados ni se enviaron mensajes a personas reales.
