# Backend de renovaciones: contrato histórico y ruta vigente

La sección antigua `/backend` se retiró. Su navegación dirige a Clientes con el filtro de renovación. Se conserva historia técnica de cálculo/modelo y no se incluyen cobros, carga inicial, exportaciones o scripts privados de migración operativa.

El trabajo vigente combina cartera, vencimientos, proyección, renovación y cobro de cuotas. Las insignias y filtros se calculan con el fin efectivo de servicio, incluyendo extensiones y pausas; no crean movimientos contables.

Las acciones están protegidas por sesión, sección, permiso, mismo origen, revisión y clave idempotente. Los pagos requieren además la capacidad de Finanzas y escriben por el adaptador del ledger. No volver a ejecutar una carga inicial histórica ni recrear cobros desde archivos de respaldo.

Consultar [REGLAS-SERVICIO.md](REGLAS-SERVICIO.md), [CUOTAS.md](CUOTAS.md) y [DATOS-Y-MIGRACIONES.md](DATOS-Y-MIGRACIONES.md).
