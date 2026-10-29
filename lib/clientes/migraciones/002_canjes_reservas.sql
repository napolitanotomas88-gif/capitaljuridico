-- Migración 002: RESERVAS DURABLES del canje de créditos contra la renovación (libro "Créditos").
-- NO EJECUTADA. No hay base Postgres provisionada; esto es un archivo preparado, sin validación real. Se corre a mano, una sola vez, después
-- de la 001, contra la base que se provisione y con una validación contra una base de PRUEBA (ver docs/CANJE-CREDITOS.md).
--
-- Protocolo: ANTES de escribir en el libro, cada canje RESERVA acá (y hace COMMIT) una fila y un ID de movimiento únicos, congelando lo que se
-- va a canjear: meses y USD en columnas SEPARADAS (nunca sumados). Un reintento (misma clave y mismo pedido) reutiliza la reserva y su saldo
-- congelado aunque el libro ya cambió: así un corte entre "escribí la fila" y "confirmé" no pierde ni duplica el canje.
-- 'pendiente' = reservado, escritura NO confirmada. 'confirmada' = la fila del libro quedó escrita. 'descartada' = la fila del libro estaba
-- ocupada por otra cosa (edición manual): su fila e ID NO se reusan.
--
-- Anti doble gasto (red de seguridad en la base, no depende del lock): a lo sumo UN canje vivo por (cliente, ciclo). El ciclo se identifica por
-- la fecha del último canje ya asentado (ciclo_clave; '' si nunca canjeó). Dos instancias que leen el mismo saldo no pueden reservar dos canjes.
--
-- Qué guarda: HMACs y datos internos del CRM. Nada de nombres, teléfonos ni mails.
--   actor_hash / clave_hash   HMAC del mail de quien canjea / de la clave de envío
--   huella_pedido             HMAC del pedido (cliente, fecha, renovación): detecta "misma clave, otro pedido"
--   huella                    HMAC del pedido + saldo congelado + versión de reglas: detecta "mismo ciclo, otro contenido"
--   meses, usd                lo canjeado, cada uno en su unidad (enteros >= 0)
--   extra                     texto que va al campo Extra del libro ("renovación gratis + USD 600"): compatibilidad, el libro no tiene columna de USD
-- La llave HMAC es REFERIDOS_HMAC_SECRET (la misma de la 001, mínimo 32 caracteres).

CREATE TABLE IF NOT EXISTS canjes_reservas (
  id_numero     integer     PRIMARY KEY,                       -- 12 → ID de movimiento "M012" en el libro
  fila          integer     NOT NULL UNIQUE CHECK (fila >= 2), -- fila reservada de la pestaña Créditos (nunca se reusa)
  cliente       text        NOT NULL,                          -- ID del cliente (A012): dato interno del CRM
  ciclo_clave   text        NOT NULL DEFAULT '',               -- fecha del último canje asentado ('AAAA-MM-DD') o '' si no hubo
  actor_hash    text        NOT NULL,
  clave_hash    text        NOT NULL,
  huella_pedido text        NOT NULL,
  huella        text        NOT NULL,
  meses         integer     NOT NULL CHECK (meses >= 0),
  usd           integer     NOT NULL CHECK (usd >= 0),
  extra         text        NOT NULL DEFAULT '',
  estado        text        NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'confirmada', 'descartada')),
  resultado     jsonb,
  reservado_en  timestamptz NOT NULL DEFAULT now(),
  confirmado_en timestamptz,
  CHECK (meses > 0 OR usd > 0)                                  -- un canje sin nada que canjear no se reserva
);

CREATE UNIQUE INDEX IF NOT EXISTS canjes_reservas_ciclo_vivo ON canjes_reservas (cliente, ciclo_clave) WHERE estado <> 'descartada';
CREATE UNIQUE INDEX IF NOT EXISTS canjes_reservas_clave_viva ON canjes_reservas (actor_hash, clave_hash) WHERE estado <> 'descartada';
CREATE INDEX IF NOT EXISTS canjes_reservas_estado ON canjes_reservas (estado, reservado_en);

-- Reservas 'pendiente' viejas = canjes cortados que nadie reintentó. Revisar a mano contra el libro antes de tocarlas:
--   SELECT id_numero, fila, cliente, reservado_en FROM canjes_reservas WHERE estado = 'pendiente' AND reservado_en < now() - interval '1 hour';
-- Permisos sugeridos: el mismo rol propio de la app, con SELECT, INSERT, UPDATE y DELETE solo sobre esta tabla.
