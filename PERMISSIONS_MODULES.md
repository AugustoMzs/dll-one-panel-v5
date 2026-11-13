# DLL One — matriz de autorización por módulo

Esta revisión diferencia **configuración central de la plataforma**, **gestión del catálogo de cada empresa** y **operación diaria**. Ocultar un control no es suficiente: las escrituras sensibles exigen permisos en el servidor.

| Función | SUPERADMIN | ADMIN_EMPRESA / OPERADOR |
|---|---|---|
| Empresas, usuarios, roles, accesos, conexiones con Meta | Sí | No |
| Datos generales de la empresa, IA, horarios globales y pagos | Sí | No |
| Sucursales, logotipo, estilo de negocio | Sí | No |
| ONE Barberías: servicios, profesionales, horarios y políticas | Sí | No |
| ONE Barberías: atender / cancelar turnos | Sí | Con permiso `operate` |
| ONE Cabañas: reglas generales y políticas de alojamiento | Sí | No |
| ONE Cabañas: solicitudes, bloqueos, confirmación y cancelación | Sí | Con permiso `operate` |
| ONE Cabañas: fichas, precios y fotos de unidades | Sí | Con permiso `editCatalog` |
| ONE Eventos: crear y editar eventos | Sí | Con permiso `editCatalog` |
| ONE Eventos: inscripciones, ingresos y pagos manuales | Sí | Con permiso `operate` |
| ONE Salud: profesionales / horarios base | Sí | No |
| ONE Salud: reservar y cancelar turnos | Sí | Con permiso `operate` |
| ONE Ventas / Gastro: contenido comercial (catálogos) | Sí | Según permiso `editCatalog` |

La operación diaria sigue sujeta al servicio activo de la empresa. Los usuarios sin asignación a esa empresa no pueden entrar. Los permisos de edición de catálogo no implican permisos operativos, y viceversa.

## Verificación previa a publicación

- Ingresar como SUPERADMIN y modificar una configuración no productiva de prueba.
- Ingresar como editor sin `operate`: no podrá confirmar reservas ni cambiar turnos.
- Ingresar como operador sin `editCatalog`: podrá atender turnos / reservas, pero no modificar fichas ni precios.
- Ingresar como ADMIN_EMPRESA con ambos permisos: no podrá editar configuración central.
- Ingresar con empresa ajena, usuario suspendido y servicio pausado: las escrituras deben bloquearse.
- Probar que los controles de Cabañas se muestran u ocultan según `canOperate` y `canConfigure`.
- Verificar en escritorio y móvil la bandeja de WhatsApp y el modo expandido.

Esta matriz no convierte automáticamente en configuración central todas las opciones internas de Gastro o Eventos; hay ajustes comerciales que siguen siendo operaciones del cliente. Esa separación debe mantenerse explícita al incorporar nuevas funciones.
