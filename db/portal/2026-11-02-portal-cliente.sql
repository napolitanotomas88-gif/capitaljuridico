-- Portal del cliente (2/11/2026): lo que el equipo arma para el cliente (objetivo, plan por etapas, seguimiento, próximos pasos).
-- Idempotente: se puede correr las veces que haga falta. La crea también lib/clientes/portal/base.ts con la primera escritura.
-- Una fila por cliente (ID del CRM en mayúscula). `version` sube con cada guardado: un guardado con una versión vieja se rechaza
-- (dos personas editando a la vez no se pisan). Sin mails: `quien` es el nombre corto de quien guardó, solo para el equipo.
CREATE TABLE IF NOT EXISTS cj_portal_cliente (
  id_crm text PRIMARY KEY CHECK (id_crm ~ '^[A-Z][0-9]{1,6}$'),
  datos jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  quien text NOT NULL DEFAULT '',
  creado timestamptz NOT NULL DEFAULT now(),
  actualizado timestamptz NOT NULL DEFAULT now()
);
