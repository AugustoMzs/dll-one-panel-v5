# Seguridad de XLSX — cambio preparado en revisión

Fecha: 2026-11-02.

## Motivo

La dependencia usada para procesar Excel y CSV era \`xlsx@^0.18.5\`,
que incluye los problemas CVE-2023-30533 (prototype pollution) y
CVE-2024-22363 (ReDoS). Son especialmente relevantes porque el panel
permite importar archivos de clientes.

## Cambio

- \`package.json\` ahora apunta a la versión **0.20.3** oficial de
  \`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz\`.
- \`package-lock.json\` se regeneró mediante npm (con integridad SHA512).
- No se modifica ninguna ruta, función ni dato comercial.
- El procedimiento temporal de generación de lock fue eliminado de la rama.

## Validaciones realizadas

GitHub Actions, ejecución 41487418821: \`npm install --package-lock-only\`,
\`npm ci --ignore-scripts\`, \`npm run check\` y \`npm test\` completados
exitosamente con Node 22. La suite incluye pruebas del importador CSV/Excel.
No se usó un catálogo real ni se hizo un despliegue.

## Condiciones antes de aprobar producción

1. Revisar el diff y el origen de la dependencia (el tarball debe permanecer
   en el CDN oficial, no el npm antiguo).
2. Hacer una importación controlada con XLSX y CSV en una empresa de ensayo,
   incluyendo códigos con ceros iniciales, precios regionales, filas vacías,
   campos opcionales, duplicados y archivos de entrada malformados.
3. Probar reanudación de lotes y confirmar que otra empresa no vea ni altere
   el catálogo.
4. Medir memoria y tiempo con archivos cercanos a 6 MiB y 10.000 filas.
5. Asegurar respaldo de datos recuperable y conservar la versión anterior
   para reversión antes de fusionar/desplegar.

No confundir **pruebas automatizadas exitosas** con certificación de
resistencia a todos los archivos hostiles o conformidad de seguridad total.

## Referencias
- https://cdn.sheetjs.com/advisories/CVE-2023-30533
- https://cdn.sheetjs.com/advisories/CVE-2024-22363
- https://docs.sheetjs.com/docs/getting-started/installation/nodejs/
