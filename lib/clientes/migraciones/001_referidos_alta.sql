-- Migración 001: RESERVAS DURABLES del alta de referidos (coordinación entre instancias de Vercel).
-- NO EJECUTADA. Se corre una sola vez, a mano, contra la base Postgres que se provisione (ver docs/REGISTRAR-REFERIDO.md).
--
-- Idea: ANTES de escribir en el Sheet, cada alta RESERVA en esta tabla (y hace COMMIT) una fila y un ID únicos. La escritura en
-- el Sheet va a ESA fila; un reintento conserva la misma reserva y nunca recalcula la fila libre. Si se corta la conexión con la base
-- (o el proceso) mientras se escribe en el Sheet, la reserva ya está commiteada: otra instancia no puede elegir esa fila ni ese ID.
-- 'pendiente' = reservada, escritura NO confirmada. 'confirmada' = la escritura en el Sheet terminó bien. 'descartada' = la fila del
-- Sheet estaba ocupada por una edición manual; su fila e ID NO se reusan.
--
-- Qué guarda: SOLO HMACs y metadatos mínimos. Nada de nombres, teléfonos, mails ni estudios:
--   telefono_hash  HMAC-SHA256 de los últimos 8 dígitos del teléfono canónico  (una persona = una sola reserva viva)
--   actor_hash     HMAC-SHA256 del mail de quien registra
--   clave_hash     HMAC-SHA256 de la clave de envío del formulario
--   huella         HMAC-SHA256 del contenido canónico (detecta "misma clave, otros datos")
--   referidor      ID del cliente que refiere (A012): dato interno del CRM, no de contacto
--   resultado      {estado, id, fila, avisos, mensaje} de la alta confirmada (sin datos de la persona)
-- La llave HMAC es REFERIDOS_HMAC_SECRET (variable propia, mínimo 32 caracteres). Si se rota, las huellas viejas dejan de coincidir:
-- no rotarla sin migrar los hashes.

CREATE TABLE IF NOT EXISTS referidos_reservas (
  id_numero     integer     PRIMARY KEY,                    -- 12 → ID "R012" en la planilla
  fila          integer     NOT NULL UNIQUE CHECK (fila >= 2),  -- fila reservada de la pestaña Referidos (nunca se reusa)
  telefono_hash text        NOT NULL,
  actor_hash    text        NOT NULL,
  clave_hash    text        NOT NULL,
  huella        text        NOT NULL,
  referidor     text        NOT NULL,
  estado        text        NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'confirmada', 'descartada')),
  resultado     jsonb,
  reservado_en  timestamptz NOT NULL DEFAULT now(),
  confirmado_en timestamptz
);

-- Una persona (teléfono canónico) tiene a lo sumo UNA reserva viva; una (actor, clave) también.
CREATE UNIQUE INDEX IF NOT EXISTS referidos_reservas_telefono_vivo ON referidos_reservas (telefono_hash) WHERE estado <> 'descartada';
CREATE UNIQUE INDEX IF NOT EXISTS referidos_reservas_clave_viva    ON referidos_reservas (actor_hash, clave_hash) WHERE estado <> 'descartada';
CREATE INDEX IF NOT EXISTS referidos_reservas_estado ON referidos_reservas (estado, reservado_en);

-- Reservas 'pendiente' viejas = altas cortadas que nadie reintentó. Revisar a mano contra la planilla antes de tocarlas:
--   SELECT id_numero, fila, reservado_en FROM referidos_reservas WHERE estado = 'pendiente' AND reservado_en < now() - interval '1 hour';
-- Permisos sugeridos: un rol propio de la app con SELECT, INSERT, UPDATE y DELETE solo sobre esta tabla.
