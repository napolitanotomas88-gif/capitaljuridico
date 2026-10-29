# Pruebas de la lógica del CRM de ventas (vitest)

Son las pruebas del CRM original (ZIP del 7/10/2026) que no dependen del navegador, con las rutas de importación
adaptadas al dashboard (`@/lib/crm/...`) y `SPREADSHEET_ID` → `SHEET_ID_VENTAS`: motor de próxima acción, pantalla, fechas,
ficha, hechas hoy, escritura verificada, log, desplegables, entrada y errores. No usan Google ni datos reales (mocks).

Esta carpeta tiene su propio `package.json` (vitest no es dependencia del dashboard: no tocar el `npm install` de la raíz). Para correrlas:

    cd scripts/crm-tests && npm install && npx vitest run

Resultado del 7/10/2026: 378 de 378. Las pruebas de componentes de React (jsdom), de Cuotas y de la sesión por PIN del
original no se portaron (ver docs/CRM-VENTAS-INTEGRADO.md).
