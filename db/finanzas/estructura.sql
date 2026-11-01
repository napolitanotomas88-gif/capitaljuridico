-- ── Base de Finanzas SKWD en Neon (misma base del Despacho, DATABASE_URL) ─────────────────────────────────────────────
-- Migrada desde Supabase («finanzas-skwd») el 1/11/2026 por decisión de Tomás. Esquemas finanzas (tablas y vistas) y
-- finanzas_priv (correos autorizados a datos sensibles y funciones internas). SIN DATOS: ni filas ni correos.
-- Permisos: la app corre cada consulta con `set local role finanzas_app` y el correo de la sesión en request.jwt.claims
-- (lib/finanzasSkwd/baseNeon.ts); finanzas_priv.jwt() reemplaza al auth.jwt() de Supabase. Un cambio en la base se hace
-- con una migración y se actualiza este archivo en el mismo PR.

-- 1) Tablas, claves, identidades e índices
create schema if not exists finanzas;
create schema if not exists finanzas_priv;
set search_path to finanzas, finanzas_priv;
create table finanzas.campos_corregibles (tabla text not null, campo text not null);
create table finanzas.conciliaciones (id bigint not null, movimiento_cuenta_id bigint not null, estado text not null, destino_tipo text, destino_id bigint, destino_mes date, confianza text, nota text, creado_en timestamp with time zone not null default now());
create table finanzas.correcciones (id bigint not null, tabla text not null, registro_id bigint not null, campo text not null, tipo_evento text not null default 'correccion'::text, valor_original jsonb not null, valor_anterior jsonb not null, valor_nuevo jsonb not null, motivo text not null, referencia text, corregido_por text not null, corregido_en timestamp with time zone not null);
create table finanzas.cuentas (id bigint not null, nombre text not null, titular text not null, banco text, activa boolean not null default true, notas text, creado_en timestamp with time zone default now());
create table finanzas.estado_parametros (anio integer not null, saldo_inicial numeric not null default 0, notas text, actualizado_en timestamp with time zone not null default now());
create table finanzas.estado_referencia_excel (anio smallint not null, mes smallint not null, beneficio numeric(14,2) not null, acumulado numeric(14,2), causa text, fecha_referencia date not null);
create table finanzas.gastos (id bigint not null, fecha date not null, concepto text not null, monto_usd numeric not null, tipo text, departamento text, cuenta text, creado_en timestamp with time zone default now(), id_origen text);
create table finanzas.gastos_personales (id bigint not null, fecha date not null default CURRENT_DATE, ejecutado_por text not null, tipo_gasto text not null, gasto_de text not null, monto_usd numeric not null, descripcion text, creado_en timestamp with time zone default now());
create table finanzas.movimientos_cuenta (id bigint not null, cuenta_id bigint not null, fecha date, fecha_original text, periodo date, periodo_fuente text not null default 'pendiente'::text, descripcion text not null, monto numeric not null, tipo text not null, de_quien_para_quien text, nota text, es_resumen boolean not null default false, es_personal boolean generated always as (tipo = ANY (ARRAY['Gasto personal compartido'::text, 'Gasto personal'::text])) stored, sin_fecha boolean generated always as (fecha IS NULL) stored, sin_periodo boolean generated always as (periodo IS NULL) stored, revisar boolean not null default false, nota_revision text, hoja_origen text, id_origen text, creado_en timestamp with time zone default now());
create table finanzas.pago_quien_recibio (pago_id bigint not null, quien text not null, creado_por text not null default 'fuera de la app'::text, creado_en timestamp with time zone not null default now(), actualizado_en timestamp with time zone not null default now());
create table finanzas.pagos (id bigint not null, fecha date not null, cliente text not null, telefono text, monto_usd numeric not null, programa text, closer text, setter text, concepto text, fuente text, tipo_venta text, tipo_pago text, cuenta text, comision numeric default 0, creado_en timestamp with time zone default now(), comprobante text, pesos_ars numeric, moneda_original text default 'USD'::text, mes text, cat_cash text, revisar boolean default false, nota_revision text, id_origen text);
create table finanzas.pagos_equipo (id bigint not null, persona_id bigint not null, mes date not null, nombre_original text not null, puesto text, departamento text, moneda text, moneda_original text, honorarios_base numeric default 0, bonuses numeric default 0, comision numeric default 0, total_usd numeric not null default 0, total_ars numeric, fecha_pago date, pagado boolean not null default false, pagado_por text, nota text, id_origen text, creado_en timestamp with time zone default now());
create table finanzas.pagos_equipo_sensibles (pago_equipo_id bigint not null, cuil_cuit text, direccion_pago_ars text, direccion_pago_usd text, telefono text, creado_en timestamp with time zone default now());
create table finanzas.personas (id bigint not null, nombre text not null, apodos text, puesto text, departamento text, activo boolean not null default true, notas text, creado_en timestamp with time zone default now());
create table finanzas.personas_sensibles (persona_id bigint not null, cuil_cuit text, telefono text, direccion_pago_ars text, direccion_pago_usd text, pendientes jsonb not null default '{}'::jsonb, origen text not null default 'web'::text, nota_origen text, creado_en timestamp with time zone not null default now(), actualizado_en timestamp with time zone not null default now(), actualizado_por text not null default 'fuera de la app'::text);
create table finanzas.personas_sensibles_historial (id bigint not null, persona_id bigint not null, cambiado_en timestamp with time zone not null default now(), cambiado_por text not null, operacion text not null, cuil_cuit text, telefono text, direccion_pago_ars text, direccion_pago_usd text);
create table finanzas_priv.sensibles_autorizados (email text not null, agregado_en timestamp with time zone not null default now());
create table finanzas.vocabularios_correccion (tabla text not null, campo text not null, valor text not null);
alter table finanzas.conciliaciones alter column id add generated always as identity;
alter table finanzas.correcciones alter column id add generated always as identity;
alter table finanzas.cuentas alter column id add generated always as identity;
alter table finanzas.gastos alter column id add generated always as identity;
alter table finanzas.gastos_personales alter column id add generated always as identity;
alter table finanzas.movimientos_cuenta alter column id add generated always as identity;
alter table finanzas.pagos alter column id add generated always as identity;
alter table finanzas.pagos_equipo alter column id add generated always as identity;
alter table finanzas.personas alter column id add generated always as identity;
alter table finanzas.personas_sensibles_historial alter column id add generated always as identity;
alter table campos_corregibles add constraint campos_corregibles_pkey PRIMARY KEY (tabla, campo);
alter table conciliaciones add constraint conciliaciones_movimiento_cuenta_id_key UNIQUE (movimiento_cuenta_id);
alter table conciliaciones add constraint conciliaciones_pkey PRIMARY KEY (id);
alter table correcciones add constraint correcciones_pkey PRIMARY KEY (id);
alter table cuentas add constraint cuentas_nombre_key UNIQUE (nombre);
alter table cuentas add constraint cuentas_pkey PRIMARY KEY (id);
alter table estado_parametros add constraint estado_parametros_pkey PRIMARY KEY (anio);
alter table estado_referencia_excel add constraint estado_referencia_excel_pkey PRIMARY KEY (anio, mes);
alter table gastos add constraint gastos_id_origen_key UNIQUE (id_origen);
alter table gastos add constraint gastos_pkey PRIMARY KEY (id);
alter table gastos_personales add constraint gastos_personales_pkey PRIMARY KEY (id);
alter table movimientos_cuenta add constraint movimientos_cuenta_id_origen_key UNIQUE (id_origen);
alter table movimientos_cuenta add constraint movimientos_cuenta_pkey PRIMARY KEY (id);
alter table pago_quien_recibio add constraint pago_quien_recibio_pkey PRIMARY KEY (pago_id);
alter table pagos add constraint pagos_id_origen_key UNIQUE (id_origen);
alter table pagos add constraint pagos_pkey PRIMARY KEY (id);
alter table pagos_equipo add constraint pagos_equipo_id_origen_key UNIQUE (id_origen);
alter table pagos_equipo add constraint pagos_equipo_pkey PRIMARY KEY (id);
alter table pagos_equipo_sensibles add constraint pagos_equipo_sensibles_pkey PRIMARY KEY (pago_equipo_id);
alter table personas add constraint personas_nombre_key UNIQUE (nombre);
alter table personas add constraint personas_pkey PRIMARY KEY (id);
alter table personas_sensibles add constraint personas_sensibles_pkey PRIMARY KEY (persona_id);
alter table personas_sensibles_historial add constraint personas_sensibles_historial_pkey PRIMARY KEY (id);
alter table finanzas_priv.sensibles_autorizados add constraint sensibles_autorizados_pkey PRIMARY KEY (email);
alter table vocabularios_correccion add constraint vocabularios_correccion_pkey PRIMARY KEY (tabla, campo, valor);
alter table campos_corregibles add constraint campos_corregibles_tabla_check CHECK ((tabla = ANY (ARRAY['pagos'::text, 'gastos'::text, 'movimientos_cuenta'::text, 'pagos_equipo'::text])));
alter table conciliaciones add constraint conciliaciones_confianza_check CHECK ((confianza = ANY (ARRAY['alta'::text, 'media'::text, 'manual'::text])));
alter table conciliaciones add constraint conciliaciones_destino_coherente CHECK ((((estado = 'conciliado'::text) AND (((destino_tipo = ANY (ARRAY['pago'::text, 'gasto'::text, 'payroll_linea'::text])) AND (destino_id IS NOT NULL) AND (destino_mes IS NULL)) OR ((destino_tipo = 'payroll_mes'::text) AND (destino_mes IS NOT NULL) AND (destino_id IS NULL)))) OR ((estado <> 'conciliado'::text) AND (destino_tipo IS NULL) AND (destino_id IS NULL) AND (destino_mes IS NULL))));
alter table conciliaciones add constraint conciliaciones_destino_mes_check CHECK (((destino_mes IS NULL) OR (EXTRACT(day FROM destino_mes) = (1)::numeric)));
alter table conciliaciones add constraint conciliaciones_destino_tipo_check CHECK ((destino_tipo = ANY (ARRAY['pago'::text, 'gasto'::text, 'payroll_linea'::text, 'payroll_mes'::text])));
alter table conciliaciones add constraint conciliaciones_estado_check CHECK ((estado = ANY (ARRAY['conciliado'::text, 'sin_contraparte'::text, 'falta_registrar'::text, 'duplicado_cuentas'::text, 'ignorado'::text])));
alter table correcciones add constraint correcciones_motivo_check CHECK ((char_length(btrim(motivo)) >= 5));
alter table correcciones add constraint correcciones_tabla_check CHECK ((tabla = ANY (ARRAY['pagos'::text, 'gastos'::text, 'movimientos_cuenta'::text, 'pagos_equipo'::text])));
alter table correcciones add constraint correcciones_tipo_evento_check CHECK ((tipo_evento = ANY (ARRAY['correccion'::text, 'reversion'::text])));
alter table cuentas add constraint cuentas_titular_check CHECK ((titular = ANY (ARRAY['Gero'::text, 'Tomi'::text, 'Empresa'::text])));
alter table estado_parametros add constraint estado_parametros_anio_check CHECK (((anio >= 2000) AND (anio <= 2100)));
alter table estado_referencia_excel add constraint estado_referencia_excel_anio_check CHECK (((anio >= 2000) AND (anio <= 2100)));
alter table estado_referencia_excel add constraint estado_referencia_excel_causa_check CHECK (((causa IS NULL) OR (length(causa) <= 600)));
alter table estado_referencia_excel add constraint estado_referencia_excel_mes_check CHECK (((mes >= 1) AND (mes <= 12)));
alter table gastos_personales add constraint gastos_personales_ejecutado_por_check CHECK ((ejecutado_por = ANY (ARRAY['Gero A.'::text, 'Tomi N.'::text])));
alter table gastos_personales add constraint gastos_personales_gasto_de_check CHECK ((gasto_de = ANY (ARRAY['Tomi para Gero'::text, 'Gero para Tomi'::text, 'Para ambos'::text])));
alter table gastos_personales add constraint gastos_personales_tipo_gasto_check CHECK ((tipo_gasto = ANY (ARRAY['Personal'::text, 'Empresarial'::text])));
alter table movimientos_cuenta add constraint movimientos_cuenta_periodo_check CHECK (((periodo IS NULL) OR (EXTRACT(day FROM periodo) = (1)::numeric)));
alter table movimientos_cuenta add constraint movimientos_cuenta_periodo_fuente_check CHECK ((periodo_fuente = ANY (ARRAY['fecha'::text, 'etiqueta'::text, 'hoja'::text, 'manual'::text, 'pendiente'::text])));
alter table movimientos_cuenta add constraint movimientos_cuenta_tipo_check CHECK ((tipo = ANY (ARRAY['Ingreso empresa'::text, 'Gasto empresa'::text, 'Inversión empresa'::text, 'Gasto personal compartido'::text, 'Gasto personal'::text, 'Transferencia de dinero'::text])));
alter table pago_quien_recibio add constraint pago_quien_recibio_quien_check CHECK ((quien = ANY (ARRAY['Gero'::text, 'Tomi'::text, 'Financiera'::text, 'Empresa'::text, 'Tomi y Gero'::text])));
alter table pagos_equipo add constraint pagos_equipo_moneda_check CHECK ((moneda = ANY (ARRAY['ARS'::text, 'USD'::text, 'ARS/USD'::text])));
alter table pagos_equipo add constraint pagos_equipo_pagado_por_check CHECK ((pagado_por = ANY (ARRAY['Financiera'::text, 'Tomi'::text, 'Gero'::text, 'Otro'::text])));
alter table personas_sensibles add constraint personas_sensibles_cuil_cuit_check CHECK (((cuil_cuit IS NULL) OR ((length(cuil_cuit) >= 1) AND (length(cuil_cuit) <= 60))));
alter table personas_sensibles add constraint personas_sensibles_direccion_pago_ars_check CHECK (((direccion_pago_ars IS NULL) OR ((length(direccion_pago_ars) >= 1) AND (length(direccion_pago_ars) <= 300))));
alter table personas_sensibles add constraint personas_sensibles_direccion_pago_usd_check CHECK (((direccion_pago_usd IS NULL) OR ((length(direccion_pago_usd) >= 1) AND (length(direccion_pago_usd) <= 300))));
alter table personas_sensibles add constraint personas_sensibles_origen_check CHECK ((origen = ANY (ARRAY['web'::text, 'migracion'::text])));
alter table personas_sensibles add constraint personas_sensibles_pendientes_forma CHECK (
CASE
    WHEN (jsonb_typeof(pendientes) = 'object'::text) THEN (((pendientes - ARRAY['cuil_cuit'::text, 'telefono'::text, 'direccion_pago_ars'::text, 'direccion_pago_usd'::text]) = '{}'::jsonb) AND (NOT (((pendientes -> 'cuil_cuit'::text) IS NOT NULL) AND (cuil_cuit IS NOT NULL))) AND (NOT (((pendientes -> 'telefono'::text) IS NOT NULL) AND (telefono IS NOT NULL))) AND (NOT (((pendientes -> 'direccion_pago_ars'::text) IS NOT NULL) AND (direccion_pago_ars IS NOT NULL))) AND (NOT (((pendientes -> 'direccion_pago_usd'::text) IS NOT NULL) AND (direccion_pago_usd IS NOT NULL))))
    ELSE false
END);
alter table personas_sensibles add constraint personas_sensibles_telefono_check CHECK (((telefono IS NULL) OR ((length(telefono) >= 1) AND (length(telefono) <= 60))));
alter table personas_sensibles_historial add constraint personas_sensibles_historial_operacion_check CHECK ((operacion = ANY (ARRAY['alta'::text, 'cambio'::text])));
alter table finanzas_priv.sensibles_autorizados add constraint sensibles_autorizados_email_check CHECK (((email = lower(btrim(email))) AND (email ~~ '%_@_%.__%'::text)));
alter table conciliaciones add constraint conciliaciones_movimiento_cuenta_id_fkey FOREIGN KEY (movimiento_cuenta_id) REFERENCES movimientos_cuenta(id) ON DELETE CASCADE;
alter table movimientos_cuenta add constraint movimientos_cuenta_cuenta_id_fkey FOREIGN KEY (cuenta_id) REFERENCES cuentas(id);
alter table pago_quien_recibio add constraint pago_quien_recibio_pago_id_fkey FOREIGN KEY (pago_id) REFERENCES pagos(id) ON DELETE RESTRICT;
alter table pagos_equipo add constraint pagos_equipo_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES personas(id);
alter table pagos_equipo_sensibles add constraint pagos_equipo_sensibles_pago_equipo_id_fkey FOREIGN KEY (pago_equipo_id) REFERENCES pagos_equipo(id) ON DELETE CASCADE;
alter table personas_sensibles add constraint personas_sensibles_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE RESTRICT;
alter table personas_sensibles_historial add constraint personas_sensibles_historial_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE RESTRICT;
CREATE INDEX conciliaciones_estado_idx ON finanzas.conciliaciones USING btree (estado);
CREATE INDEX correcciones_registro_idx ON finanzas.correcciones USING btree (tabla, registro_id, campo, id DESC);
CREATE INDEX movimientos_cuenta_cuenta_idx ON finanzas.movimientos_cuenta USING btree (cuenta_id);
CREATE INDEX movimientos_cuenta_fecha_idx ON finanzas.movimientos_cuenta USING btree (fecha);
CREATE INDEX movimientos_cuenta_periodo_idx ON finanzas.movimientos_cuenta USING btree (periodo);
CREATE INDEX movimientos_cuenta_tipo_idx ON finanzas.movimientos_cuenta USING btree (tipo);
CREATE INDEX pagos_equipo_mes_idx ON finanzas.pagos_equipo USING btree (mes);
CREATE INDEX pagos_equipo_persona_idx ON finanzas.pagos_equipo USING btree (persona_id);
CREATE INDEX personas_sensibles_historial_persona ON finanzas.personas_sensibles_historial USING btree (persona_id, cambiado_en DESC);
CREATE UNIQUE INDEX conciliaciones_destino_unico ON finanzas.conciliaciones USING btree (destino_tipo, destino_id) WHERE (destino_tipo = ANY (ARRAY['pago'::text, 'gasto'::text]));

-- 2) Funciones, disparadores y vistas
set search_path to finanzas, finanzas_priv;
set local check_function_bodies = off;
create or replace function finanzas_priv.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
CREATE OR REPLACE FUNCTION finanzas.bloquear_vaciado()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO finanzas, finanzas_priv
AS $function$
begin
  raise exception 'No se puede vaciar la tabla % (contiene datos importados).', tg_table_name;
end $function$
;

CREATE OR REPLACE FUNCTION finanzas.correcciones_antes_de_insertar()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO finanzas, finanzas_priv
AS $function$
declare
  v_n integer;
  v_original jsonb;
  v_anterior jsonb;
  v_tipo text;
  v_admite_vacio boolean;
  v_texto text;
  v_num numeric;
  v_fecha date;
begin
  -- 1) Solo los campos aprobados (tabla campos_corregibles)
  if not exists (select 1 from campos_corregibles cc where cc.tabla = new.tabla and cc.campo = new.campo) then
    raise exception 'El campo "%" no se puede corregir en la tabla %.', new.campo, new.tabla;
  end if;

  -- 2) El registro debe existir y ser una fila IMPORTADA (las filas creadas en la web se editan directamente)
  execute format('select count(*) from %I where id = $1 and id_origen is not null', new.tabla) into v_n using new.registro_id;
  if v_n = 0 then
    raise exception 'El registro % de % no existe o no es una fila importada.', new.registro_id, new.tabla;
  end if;

  -- 3) Valor original (siempre leído de la tabla original) y valor vigente justo antes
  execute format('select to_jsonb(t) -> %L from %I t where t.id = $1', new.campo, new.tabla) into v_original using new.registro_id;
  select c.valor_nuevo into v_anterior from correcciones c
   where c.tabla = new.tabla and c.registro_id = new.registro_id and c.campo = new.campo
   order by c.id desc limit 1;
  v_anterior := coalesce(v_anterior, v_original);

  new.valor_original := v_original;
  new.valor_anterior := v_anterior;
  new.corregido_por := coalesce(finanzas_priv.jwt() ->> 'email', 'fuera de la app');   -- no se puede falsear desde el navegador
  new.corregido_en := now();

  -- 4) Reversión: vuelve al valor original
  if new.tipo_evento = 'reversion' then
    if v_anterior = v_original then
      raise exception 'Ese dato ya está en su valor original.';
    end if;
    new.valor_nuevo := v_original;
    return new;
  end if;

  -- 5) Corrección: validar el valor nuevo según el tipo del campo
  if new.valor_nuevo is null then
    raise exception 'Falta el valor corregido.';
  end if;
  select format_type(a.atttypid, null), not a.attnotnull into v_tipo, v_admite_vacio
    from pg_attribute a
   where a.attrelid = format('finanzas.%I', new.tabla)::regclass and a.attname = new.campo and not a.attisdropped;

  if jsonb_typeof(new.valor_nuevo) = 'null' then
    if not v_admite_vacio then
      raise exception 'El campo "%" no puede quedar vacío.', new.campo;
    end if;
  else
    if jsonb_typeof(new.valor_nuevo) in ('object', 'array') then
      raise exception 'Valor no válido para el campo "%".', new.campo;
    end if;
    v_texto := new.valor_nuevo #>> '{}';
    if v_tipo = 'text' then
      v_texto := btrim(v_texto);
      if v_texto = '' then
        raise exception 'El texto no puede estar vacío (para borrar el dato usá el valor vacío).';
      end if;
      new.valor_nuevo := to_jsonb(v_texto);
    else
      begin
        execute format('select %L::%s', v_texto, v_tipo);
      exception when others then
        raise exception 'El valor "%" no es válido para el campo "%" (%).', v_texto, new.campo, v_tipo;
      end;
      if v_tipo = 'numeric' then
        new.valor_nuevo := to_jsonb(v_texto::numeric);
      elsif v_tipo = 'date' then
        new.valor_nuevo := to_jsonb(v_texto::date);
      end if;
    end if;

    -- 6) Vocabularios cerrados (tabla vocabularios_correccion: ver cómo ampliarlos en el encabezado de este archivo)
    if exists (select 1 from vocabularios_correccion v where v.tabla = new.tabla and v.campo = new.campo)
       and not exists (select 1 from vocabularios_correccion v where v.tabla = new.tabla and v.campo = new.campo and v.valor = (new.valor_nuevo #>> '{}')) then
      raise exception 'El valor "%" no está permitido para %.%. Valores válidos: %.', (new.valor_nuevo #>> '{}'), new.tabla, new.campo,
        (select string_agg(v.valor, ', ' order by v.valor) from vocabularios_correccion v where v.tabla = new.tabla and v.campo = new.campo);
    end if;

    -- 7) Reglas de montos y fechas (alineadas con las reglas de cada módulo)
    if v_tipo = 'numeric' then
      v_num := (new.valor_nuevo #>> '{}')::numeric;
      if (new.tabla, new.campo) in (('pagos', 'monto_usd'), ('gastos', 'monto_usd'), ('pagos', 'pesos_ars')) and v_num <= 0 then
        raise exception 'El monto debe ser mayor que 0.';
      end if;
      if new.tabla = 'movimientos_cuenta' and new.campo = 'monto' and v_num = 0 then
        raise exception 'El monto de un movimiento de Cuentas no puede ser 0.';
      end if;
      if v_num < 0 and ((new.tabla = 'pagos' and new.campo = 'comision') or new.tabla = 'pagos_equipo') then
        raise exception 'Este importe no puede ser negativo.';
      end if;
    end if;
    if v_tipo = 'date' then
      v_fecha := (new.valor_nuevo #>> '{}')::date;
      if v_fecha < date '2000-01-01' or v_fecha > date '2100-12-31' then
        raise exception 'La fecha % está fuera de rango.', v_fecha;
      end if;
      if new.tabla = 'pagos_equipo' and new.campo = 'mes' and extract(day from v_fecha) <> 1 then
        raise exception 'El mes de Payroll debe ser el día 1 del mes.';
      end if;
    end if;
  end if;

  if new.valor_nuevo = v_anterior then
    raise exception 'La corrección no cambia el valor vigente.';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION finanzas.correcciones_inmutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO finanzas, finanzas_priv
AS $function$
begin
  raise exception 'El historial de correcciones no se puede modificar ni borrar.';
end $function$
;

CREATE OR REPLACE FUNCTION finanzas_priv.es_autorizado_sensibles()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    select exists (select 1 from finanzas_priv.sensibles_autorizados a where a.email = lower(btrim(coalesce(finanzas_priv.jwt() ->> 'email', ''))))
  $function$
;

CREATE OR REPLACE FUNCTION finanzas.mes_en_texto(d date)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO finanzas, finanzas_priv
AS $function$
  select extract(year from d)::int::text || '-' ||
         (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])[extract(month from d)::int]
$function$
;

CREATE OR REPLACE FUNCTION finanzas.pago_quien_recibio_proteger()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO finanzas, finanzas_priv
AS $function$
  begin
    if tg_op = 'INSERT' then
      new.creado_por := coalesce(finanzas_priv.jwt() ->> 'email', 'fuera de la app');   -- lo pone la base, no el navegador
      new.creado_en := now();
      new.actualizado_en := now();
      return new;
    end if;
    if tg_op = 'UPDATE' then
      if new.pago_id is distinct from old.pago_id then
        raise exception 'No se puede cambiar el pago de una asignación (pago #%).', old.pago_id;
      end if;
      new.creado_por := old.creado_por;
      new.creado_en := old.creado_en;
      new.actualizado_en := now();
      return new;
    end if;
    -- DELETE: la asignación de un pago importado se puede cambiar de opción, pero no quitar
    if exists (select 1 from finanzas.pagos p where p.id = old.pago_id and p.id_origen is not null) then
      raise exception 'La asignación de un pago importado no se puede borrar (pago #%): se puede cambiar de opción, no quitar.', old.pago_id;
    end if;
    return old;
  end $function$
;

CREATE OR REPLACE FUNCTION finanzas_priv.personas_sensibles_historial_inmutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
  begin
    raise exception 'El historial de datos sensibles es de solo agregado: no se edita ni se borra.';
  end $function$
;

CREATE OR REPLACE FUNCTION finanzas_priv.personas_sensibles_historial_registrar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  begin
    if tg_op = 'UPDATE' and (new.cuil_cuit, new.telefono, new.direccion_pago_ars, new.direccion_pago_usd)
         is not distinct from (old.cuil_cuit, old.telefono, old.direccion_pago_ars, old.direccion_pago_usd) then
      return null;
    end if;
    insert into finanzas.personas_sensibles_historial (persona_id, cambiado_por, operacion, cuil_cuit, telefono, direccion_pago_ars, direccion_pago_usd)
    values (new.persona_id, new.actualizado_por, case tg_op when 'INSERT' then 'alta' else 'cambio' end,
            new.cuil_cuit, new.telefono, new.direccion_pago_ars, new.direccion_pago_usd);
    return null;
  end $function$
;

CREATE OR REPLACE FUNCTION finanzas_priv.personas_sensibles_proteger()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
  begin
    if tg_op = 'DELETE' then
      raise exception 'Los datos sensibles de una persona no se borran: se editan (un campo se puede dejar vacío).';
    end if;
    if jsonb_typeof(new.pendientes) is distinct from 'object' then
      raise exception 'El campo «pendientes» debe ser un objeto {campo: motivo}.';
    end if;
    new.cuil_cuit := finanzas_priv.sensibles_limpiar(new.cuil_cuit);
    new.telefono := finanzas_priv.sensibles_limpiar(new.telefono);
    new.direccion_pago_ars := finanzas_priv.sensibles_limpiar(new.direccion_pago_ars);
    new.direccion_pago_usd := finanzas_priv.sensibles_limpiar(new.direccion_pago_usd);
    new.pendientes := new.pendientes - array_remove(array[
        case when new.cuil_cuit is not null then 'cuil_cuit' end,
        case when new.telefono is not null then 'telefono' end,
        case when new.direccion_pago_ars is not null then 'direccion_pago_ars' end,
        case when new.direccion_pago_usd is not null then 'direccion_pago_usd' end]::text[], null);
    new.actualizado_por := coalesce(finanzas_priv.jwt() ->> 'email', 'fuera de la app');
    new.actualizado_en := now();
    if tg_op = 'INSERT' then
      new.creado_en := now();
      return new;
    end if;
    if new.persona_id is distinct from old.persona_id then
      raise exception 'No se puede cambiar la persona de un registro sensible (persona #%).', old.persona_id;
    end if;
    new.creado_en := old.creado_en;
    if (new.cuil_cuit, new.telefono, new.direccion_pago_ars, new.direccion_pago_usd)
       is distinct from (old.cuil_cuit, old.telefono, old.direccion_pago_ars, old.direccion_pago_usd) then
      new.origen := 'web';
    end if;
    return new;
  end $function$
;

CREATE OR REPLACE FUNCTION finanzas.proteger_importadas()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO finanzas, finanzas_priv
AS $function$
declare
  v_old jsonb;
  v_new jsonb;
  v_col text;
  v_dif text;
begin
  if tg_op = 'DELETE' then
    if old.id_origen is not null then
      raise exception 'No se pueden eliminar filas importadas (% #%).', tg_table_name, old.id;
    end if;
    return old;
  end if;

  -- UPDATE
  if old.id_origen is null then
    return new;                                   -- fila creada en la web: edición libre
  end if;
  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  if tg_nargs > 0 then
    foreach v_col in array tg_argv loop           -- campos de trabajo que SÍ pueden cambiar
      v_old := v_old - v_col;
      v_new := v_new - v_col;
    end loop;
  end if;
  -- Columnas GENERADAS (calculadas por la base a partir de otras): PostgreSQL las calcula DESPUÉS de los triggers BEFORE,
  -- por eso dentro de este trigger no son comparables. Se excluyen todas (es_personal, sin_fecha, sin_periodo y las que se agreguen):
  -- no se pierde protección, porque las columnas de las que derivan (tipo, fecha, periodo) sí se comparan.
  for v_col in select a.attname::text from pg_attribute a where a.attrelid = tg_relid and a.attnum > 0 and not a.attisdropped and a.attgenerated <> '' loop
    v_old := v_old - v_col;
    v_new := v_new - v_col;
  end loop;
  if tg_table_name = 'movimientos_cuenta' then    -- solo esta tabla tiene la regla de la fecha vacía
    if (v_old ->> 'fecha') is null then           -- se lee por JSON: old.fecha no existe en pagos_equipo (esa tabla usa "mes")
      v_old := v_old - 'fecha';                   -- completar una fecha vacía está permitido
      v_new := v_new - 'fecha';
    end if;
  end if;
  if v_old is distinct from v_new then
    select string_agg(k, ', ' order by k) into v_dif
      from (select n.key as k from jsonb_each(v_new) n where n.value is distinct from v_old -> n.key
            union select o.key from jsonb_each(v_old) o where not (v_new ? o.key)) d;
    raise exception 'La fila importada % #% no se puede modificar directamente: usá "Corregir dato" (los originales son intocables). Campos que se intentaron cambiar: %.', tg_table_name, old.id, coalesce(v_dif, '(ninguno identificable)');
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION finanzas_priv.sensibles_limpiar(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
    select nullif(regexp_replace(t, '^[\s\u00a0\u180e\u2007\u2028\u2029\u202f\u205f\u3000\u200b\u200c\u200d\u2060\ufeff]+|[\s\u00a0\u180e\u2007\u2028\u2029\u202f\u205f\u3000\u200b\u200c\u200d\u2060\ufeff]+$', '', 'g'), '')
  $function$
;

CREATE OR REPLACE FUNCTION finanzas_priv.sensibles_normalizar(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
    select case
             when t is null then null
             when s.x ~ '[^\x01-\x7f\u00a0-\u00a9\u00ab-\u00b1\u00b4\u00b6-\u00b8\u00bb\u00bf\u00d7\u00f7\u2000-\u206f\u20a0-\u20cf\u2190-\u23ff\u2500-\u2775\u2794-\u27bf\u27c0-\u27ff\u2900-\u2bff\u2e00-\u2e2e\u2e30-\u2e7f\u3000-\u3004\u3008-\u3020\u3030\u3036\u3037\ufe00-\ufe0f\ufeff\U0001f000-\U0001f0ff\U0001f10d-\U0001faff]' then 'x:' || lower(normalize(finanzas_priv.sensibles_limpiar(t), nfc))
             when s.x ~ '[0-9A-Za-z]' then regexp_replace(translate(s.x, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '[^0-9a-z]', '', 'g')
             else null
           end
    from (select regexp_replace(normalize(btrim(t), nfd), '[\u0300-\u036f]', '', 'g') as x) s
  $function$
;

CREATE OR REPLACE FUNCTION finanzas_priv.sensibles_normalizar_laxa(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
    select case
             when t is null then null
             when s.x !~ '[0-9A-Za-z]' and s.x !~ '[^\x01-\x7f\u00a0-\u00a9\u00ab-\u00b1\u00b4\u00b6-\u00b8\u00bb\u00bf\u00d7\u00f7\u2000-\u206f\u20a0-\u20cf\u2190-\u23ff\u2500-\u2775\u2794-\u27bf\u27c0-\u27ff\u2900-\u2bff\u2e00-\u2e2e\u2e30-\u2e7f\u3000-\u3004\u3008-\u3020\u3030\u3036\u3037\ufe00-\ufe0f\ufeff\U0001f000-\U0001f0ff\U0001f10d-\U0001faff]' then null
             else coalesce(nullif(regexp_replace(translate(s.x, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '[^0-9a-z]', '', 'g'), ''),
                           'x:' || lower(normalize(finanzas_priv.sensibles_limpiar(t), nfc)))
           end
    from (select regexp_replace(normalize(btrim(t), nfd), '[\u0300-\u036f]', '', 'g') as x) s
  $function$
;

CREATE OR REPLACE FUNCTION finanzas_priv.sensibles_plan_migracion()
 RETURNS TABLE(persona_id bigint, campo text, valores_distintos integer, valor_reciente text, motivo text, accion text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
    with s as (
      select e.persona_id, e.mes, x.pago_equipo_id,
             finanzas_priv.sensibles_limpiar(x.cuil_cuit) as cuit, finanzas_priv.sensibles_limpiar(x.telefono) as tel,
             finanzas_priv.sensibles_limpiar(x.direccion_pago_ars) as ars, finanzas_priv.sensibles_limpiar(x.direccion_pago_usd) as usd
      from finanzas.pagos_equipo_sensibles x
      join finanzas.pagos_equipo_vigentes e on e.id = x.pago_equipo_id
      where e.persona_id is not null
    ), pc as (
      select s.persona_id, s.mes, s.pago_equipo_id, 'cuil_cuit'::text as campo, s.cuit as raw from s where s.cuit is not null
      union all select s.persona_id, s.mes, s.pago_equipo_id, 'telefono', s.tel from s where s.tel is not null
      union all select s.persona_id, s.mes, s.pago_equipo_id, 'direccion_pago_ars', s.ars from s where s.ars is not null
      union all select s.persona_id, s.mes, s.pago_equipo_id, 'direccion_pago_usd', s.usd from s where s.usd is not null
    ), pn as (
      select pc.*, finanzas_priv.sensibles_normalizar(pc.raw) as v, finanzas_priv.sensibles_normalizar_laxa(pc.raw) as vl
      from pc
    ), r as (
      select pn.persona_id, pn.campo,
             count(distinct pn.v)::integer as n,
             min(pn.v) as v1,
             min(pn.vl) as vl1,
             (array_agg(pn.raw order by pn.mes desc nulls last, pn.pago_equipo_id desc) filter (where pn.v is not null))[1] as reciente
      from pn group by pn.persona_id, pn.campo
    ), comp as (
      select pn.campo, pn.v from pn where pn.v is not null group by pn.campo, pn.v having count(distinct pn.persona_id) > 1
    ), compl as (
      select pn.campo, pn.vl from pn where pn.vl is not null group by pn.campo, pn.vl having count(distinct pn.persona_id) > 1
    ), m as (
      select r.persona_id, r.campo, r.n, r.reciente,
             case when r.n > 1 then 'valores distintos entre meses'
                  when r.n = 1 and exists (select 1 from comp c where c.campo = r.campo and c.v = r.v1) then 'valor compartido con otra persona'
                  when r.n = 1 and exists (select 1 from compl c where c.campo = r.campo and c.vl = r.vl1) then 'valor posiblemente compartido con otra persona'
                  when r.n = 1 and length(r.reciente) > case when r.campo in ('cuil_cuit', 'telefono') then 60 else 300 end then 'valor demasiado largo para el campo'
                  when r.n = 0 then 'solo marcadores sin letras ni números'
             end as motivo
      from r
    )
    select m.persona_id, m.campo, m.n, m.reciente, m.motivo,
           case when exists (select 1 from finanzas.personas_sensibles ps where ps.persona_id = m.persona_id) then 'omitir'
                when m.n = 0 then 'ignorar'
                when m.motivo is null then 'copiar'
                else 'pendiente' end
    from m
  $function$
;

CREATE TRIGGER correcciones_no_modificar BEFORE DELETE OR UPDATE ON finanzas.correcciones FOR EACH ROW EXECUTE FUNCTION correcciones_inmutable();
CREATE TRIGGER correcciones_no_vaciar BEFORE TRUNCATE ON finanzas.correcciones FOR EACH STATEMENT EXECUTE FUNCTION correcciones_inmutable();
CREATE TRIGGER correcciones_validar BEFORE INSERT ON finanzas.correcciones FOR EACH ROW EXECUTE FUNCTION correcciones_antes_de_insertar();
CREATE TRIGGER gastos_no_vaciar BEFORE TRUNCATE ON finanzas.gastos FOR EACH STATEMENT EXECUTE FUNCTION bloquear_vaciado();
CREATE TRIGGER gastos_proteger BEFORE DELETE OR UPDATE ON finanzas.gastos FOR EACH ROW EXECUTE FUNCTION proteger_importadas();
CREATE TRIGGER movimientos_cuenta_no_vaciar BEFORE TRUNCATE ON finanzas.movimientos_cuenta FOR EACH STATEMENT EXECUTE FUNCTION bloquear_vaciado();
CREATE TRIGGER movimientos_cuenta_proteger BEFORE DELETE OR UPDATE ON finanzas.movimientos_cuenta FOR EACH ROW EXECUTE FUNCTION proteger_importadas('cuenta_id', 'nota', 'revisar', 'nota_revision', 'periodo', 'periodo_fuente');
CREATE TRIGGER pago_quien_recibio_proteger BEFORE INSERT OR DELETE OR UPDATE ON finanzas.pago_quien_recibio FOR EACH ROW EXECUTE FUNCTION pago_quien_recibio_proteger();
CREATE TRIGGER pagos_equipo_no_vaciar BEFORE TRUNCATE ON finanzas.pagos_equipo FOR EACH STATEMENT EXECUTE FUNCTION bloquear_vaciado();
CREATE TRIGGER pagos_equipo_proteger BEFORE DELETE OR UPDATE ON finanzas.pagos_equipo FOR EACH ROW EXECUTE FUNCTION proteger_importadas('pagado', 'pagado_por', 'nota');
CREATE TRIGGER pagos_no_vaciar BEFORE TRUNCATE ON finanzas.pagos FOR EACH STATEMENT EXECUTE FUNCTION bloquear_vaciado();
CREATE TRIGGER pagos_proteger BEFORE DELETE OR UPDATE ON finanzas.pagos FOR EACH ROW EXECUTE FUNCTION proteger_importadas('revisar', 'nota_revision');
CREATE TRIGGER personas_sensibles_historial_inmutable BEFORE DELETE OR UPDATE ON finanzas.personas_sensibles_historial FOR EACH ROW EXECUTE FUNCTION finanzas_priv.personas_sensibles_historial_inmutable();
CREATE TRIGGER personas_sensibles_historial_no_vaciar BEFORE TRUNCATE ON finanzas.personas_sensibles_historial FOR EACH STATEMENT EXECUTE FUNCTION bloquear_vaciado();
CREATE TRIGGER personas_sensibles_historial_registrar AFTER INSERT OR UPDATE ON finanzas.personas_sensibles FOR EACH ROW EXECUTE FUNCTION finanzas_priv.personas_sensibles_historial_registrar();
CREATE TRIGGER personas_sensibles_no_vaciar BEFORE TRUNCATE ON finanzas.personas_sensibles FOR EACH STATEMENT EXECUTE FUNCTION bloquear_vaciado();
CREATE TRIGGER personas_sensibles_proteger BEFORE INSERT OR DELETE OR UPDATE ON finanzas.personas_sensibles FOR EACH ROW EXECUTE FUNCTION finanzas_priv.personas_sensibles_proteger();
create view finanzas.correcciones_vigentes with (security_invoker = on) as  SELECT id, tabla, registro_id, campo, tipo_evento, valor_original, valor_anterior, valor_nuevo, motivo, referencia, corregido_por, corregido_en FROM ( SELECT DISTINCT ON (correcciones.tabla, correcciones.registro_id, correcciones.campo) correcciones.id, correcciones.tabla, correcciones.registro_id, correcciones.campo, correcciones.tipo_evento, correcciones.valor_original, correcciones.valor_anterior, correcciones.valor_nuevo, correcciones.motivo, correcciones.referencia, correcciones.corregido_por, correcciones.corregido_en FROM correcciones ORDER BY correcciones.tabla, correcciones.registro_id, correcciones.campo, correcciones.id DESC) ult WHERE (tipo_evento = 'correccion'::text);
create view finanzas.correcciones_por_registro with (security_invoker = on) as  SELECT tabla, registro_id, jsonb_object_agg(campo, valor_nuevo) AS mapa, jsonb_object_agg(campo, valor_original) AS originales, (count(*))::integer AS campos_corregidos FROM correcciones_vigentes GROUP BY tabla, registro_id;
create view finanzas.gastos_vigentes with (security_invoker = on) as  SELECT (jsonb_populate_record(NULL::gastos, a.j)).id AS id, (jsonb_populate_record(NULL::gastos, a.j)).fecha AS fecha, (jsonb_populate_record(NULL::gastos, a.j)).concepto AS concepto, (jsonb_populate_record(NULL::gastos, a.j)).monto_usd AS monto_usd, (jsonb_populate_record(NULL::gastos, a.j)).tipo AS tipo, (jsonb_populate_record(NULL::gastos, a.j)).departamento AS departamento, (jsonb_populate_record(NULL::gastos, a.j)).cuenta AS cuenta, (jsonb_populate_record(NULL::gastos, a.j)).creado_en AS creado_en, (jsonb_populate_record(NULL::gastos, a.j)).id_origen AS id_origen, c.mapa AS correcciones, c.originales AS valores_originales FROM ((gastos g LEFT JOIN correcciones_por_registro c ON (((c.tabla = 'gastos'::text) AND (c.registro_id = g.id)))) CROSS JOIN LATERAL ( SELECT (to_jsonb(g.*) || COALESCE(c.mapa, '{}'::jsonb)) AS j) a);
create view finanzas.movimientos_cuenta_vigentes with (security_invoker = on) as  SELECT (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).id AS id, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).cuenta_id AS cuenta_id, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).fecha AS fecha, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).fecha_original AS fecha_original, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).periodo AS periodo, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).periodo_fuente AS periodo_fuente, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).descripcion AS descripcion, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).monto AS monto, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).tipo AS tipo, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).de_quien_para_quien AS de_quien_para_quien, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).nota AS nota, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).es_resumen AS es_resumen, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).es_personal AS es_personal, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).sin_fecha AS sin_fecha, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).sin_periodo AS sin_periodo, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).revisar AS revisar, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).nota_revision AS nota_revision, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).hoja_origen AS hoja_origen, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).id_origen AS id_origen, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).creado_en AS creado_en, c.mapa AS correcciones, c.originales AS valores_originales FROM ((((movimientos_cuenta m LEFT JOIN correcciones_por_registro c ON (((c.tabla = 'movimientos_cuenta'::text) AND (c.registro_id = m.id)))) CROSS JOIN LATERAL ( SELECT (to_jsonb(m.*) || COALESCE(c.mapa, '{}'::jsonb)) AS j) a) CROSS JOIN LATERAL ( SELECT (a.j || jsonb_build_object('periodo', CASE WHEN ((c.mapa ? 'fecha'::text) AND (m.periodo_fuente = 'fecha'::text) AND ((a.j ->> 'fecha'::text) IS NOT NULL)) THEN to_char(((date_trunc('month'::text, (((a.j ->> 'fecha'::text))::date)::timestamp without time zone))::date)::timestamp with time zone, 'YYYY-MM-DD'::text) ELSE (a.j ->> 'periodo'::text) END)) AS j) b) CROSS JOIN LATERAL ( SELECT (b.j || jsonb_build_object('es_personal', ((b.j ->> 'tipo'::text) = ANY (ARRAY['Gasto personal compartido'::text, 'Gasto personal'::text])), 'sin_fecha', ((b.j ->> 'fecha'::text) IS NULL), 'sin_periodo', ((b.j ->> 'periodo'::text) IS NULL))) AS j) k);
create view finanzas.movimientos_cuenta_empresa with (security_invoker = on) as  SELECT id, cuenta_id, fecha, fecha_original, periodo, periodo_fuente, descripcion, monto, tipo, de_quien_para_quien, nota, es_resumen, es_personal, sin_fecha, sin_periodo, revisar, nota_revision, hoja_origen, id_origen, creado_en, correcciones, valores_originales FROM movimientos_cuenta_vigentes WHERE ((NOT es_personal) AND (NOT es_resumen));
create view finanzas.pagos_equipo_vigentes with (security_invoker = on) as  SELECT (jsonb_populate_record(NULL::pagos_equipo, a.j)).id AS id, (jsonb_populate_record(NULL::pagos_equipo, a.j)).persona_id AS persona_id, (jsonb_populate_record(NULL::pagos_equipo, a.j)).mes AS mes, (jsonb_populate_record(NULL::pagos_equipo, a.j)).nombre_original AS nombre_original, (jsonb_populate_record(NULL::pagos_equipo, a.j)).puesto AS puesto, (jsonb_populate_record(NULL::pagos_equipo, a.j)).departamento AS departamento, (jsonb_populate_record(NULL::pagos_equipo, a.j)).moneda AS moneda, (jsonb_populate_record(NULL::pagos_equipo, a.j)).moneda_original AS moneda_original, (jsonb_populate_record(NULL::pagos_equipo, a.j)).honorarios_base AS honorarios_base, (jsonb_populate_record(NULL::pagos_equipo, a.j)).bonuses AS bonuses, (jsonb_populate_record(NULL::pagos_equipo, a.j)).comision AS comision, (jsonb_populate_record(NULL::pagos_equipo, a.j)).total_usd AS total_usd, (jsonb_populate_record(NULL::pagos_equipo, a.j)).total_ars AS total_ars, (jsonb_populate_record(NULL::pagos_equipo, a.j)).fecha_pago AS fecha_pago, (jsonb_populate_record(NULL::pagos_equipo, a.j)).pagado AS pagado, (jsonb_populate_record(NULL::pagos_equipo, a.j)).pagado_por AS pagado_por, (jsonb_populate_record(NULL::pagos_equipo, a.j)).nota AS nota, (jsonb_populate_record(NULL::pagos_equipo, a.j)).id_origen AS id_origen, (jsonb_populate_record(NULL::pagos_equipo, a.j)).creado_en AS creado_en, c.mapa AS correcciones, c.originales AS valores_originales FROM ((pagos_equipo e LEFT JOIN correcciones_por_registro c ON (((c.tabla = 'pagos_equipo'::text) AND (c.registro_id = e.id)))) CROSS JOIN LATERAL ( SELECT (to_jsonb(e.*) || COALESCE(c.mapa, '{}'::jsonb)) AS j) a);
create view finanzas.pagos_vigentes with (security_invoker = on) as  SELECT (jsonb_populate_record(NULL::pagos, a.j)).id AS id, (jsonb_populate_record(NULL::pagos, a.j)).fecha AS fecha, (jsonb_populate_record(NULL::pagos, a.j)).cliente AS cliente, (jsonb_populate_record(NULL::pagos, a.j)).telefono AS telefono, (jsonb_populate_record(NULL::pagos, a.j)).monto_usd AS monto_usd, (jsonb_populate_record(NULL::pagos, a.j)).programa AS programa, (jsonb_populate_record(NULL::pagos, a.j)).closer AS closer, (jsonb_populate_record(NULL::pagos, a.j)).setter AS setter, (jsonb_populate_record(NULL::pagos, a.j)).concepto AS concepto, (jsonb_populate_record(NULL::pagos, a.j)).fuente AS fuente, (jsonb_populate_record(NULL::pagos, a.j)).tipo_venta AS tipo_venta, (jsonb_populate_record(NULL::pagos, a.j)).tipo_pago AS tipo_pago, (jsonb_populate_record(NULL::pagos, a.j)).cuenta AS cuenta, (jsonb_populate_record(NULL::pagos, a.j)).comision AS comision, (jsonb_populate_record(NULL::pagos, a.j)).creado_en AS creado_en, (jsonb_populate_record(NULL::pagos, a.j)).comprobante AS comprobante, (jsonb_populate_record(NULL::pagos, a.j)).pesos_ars AS pesos_ars, (jsonb_populate_record(NULL::pagos, a.j)).moneda_original AS moneda_original, (jsonb_populate_record(NULL::pagos, a.j)).mes AS mes, (jsonb_populate_record(NULL::pagos, a.j)).cat_cash AS cat_cash, (jsonb_populate_record(NULL::pagos, a.j)).revisar AS revisar, (jsonb_populate_record(NULL::pagos, a.j)).nota_revision AS nota_revision, (jsonb_populate_record(NULL::pagos, a.j)).id_origen AS id_origen, c.mapa AS correcciones, c.originales AS valores_originales FROM ((pagos p LEFT JOIN correcciones_por_registro c ON (((c.tabla = 'pagos'::text) AND (c.registro_id = p.id)))) CROSS JOIN LATERAL ( SELECT (((to_jsonb(p.*) || COALESCE(c.mapa, '{}'::jsonb)) || CASE WHEN (c.mapa ? 'fecha'::text) THEN jsonb_build_object('mes', mes_en_texto(((c.mapa ->> 'fecha'::text))::date)) ELSE '{}'::jsonb END) || CASE WHEN (c.mapa ? 'pesos_ars'::text) THEN jsonb_build_object('moneda_original', CASE WHEN ((c.mapa ->> 'pesos_ars'::text) IS NULL) THEN 'USD'::text ELSE 'ARS'::text END) ELSE '{}'::jsonb END) AS j) a);

-- 3) Rol de la app y permisos
create role finanzas_app nologin;
grant finanzas_app to current_user;
alter table finanzas.campos_corregibles enable row level security;  -- y así cada tabla de finanzas y finanzas_priv.sensibles_autorizados
grant usage on schema finanzas, finanzas_priv to finanzas_app;
grant select, insert, update, delete on all tables in schema finanzas to finanzas_app;
grant usage, select on all sequences in schema finanzas to finanzas_app;
grant execute on all functions in schema finanzas, finanzas_priv to finanzas_app;
revoke all on finanzas_priv.sensibles_autorizados from finanzas_app;

-- 4) Políticas (RLS)
create policy "solo con sesion - leer campos corregibles" on finanzas.campos_corregibles for SELECT to finanzas_app using (true);
create policy "solo con sesion - conciliaciones" on finanzas.conciliaciones for ALL to finanzas_app using (true) with check (true);
create policy "solo con sesion - agregar correcciones" on finanzas.correcciones for INSERT to finanzas_app with check (true);
create policy "solo con sesion - leer correcciones" on finanzas.correcciones for SELECT to finanzas_app using (true);
create policy "solo con sesion - cuentas" on finanzas.cuentas for ALL to finanzas_app using (true) with check (true);
create policy "solo con sesion - estado parametros" on finanzas.estado_parametros for ALL to finanzas_app using (true) with check (true);
create policy "autorizados - leer referencia excel" on finanzas.estado_referencia_excel for SELECT to finanzas_app using (( SELECT finanzas_priv.es_autorizado_sensibles() AS es_autorizado_sensibles));
create policy "solo con sesion - gastos personales" on finanzas.gastos_personales for ALL to finanzas_app using (true) with check (true);
create policy "solo con sesion - gastos" on finanzas.gastos for ALL to finanzas_app using (true) with check (true);
create policy "solo con sesion - movimientos cuenta" on finanzas.movimientos_cuenta for ALL to finanzas_app using (true) with check (true);
create policy "sesion - asignar quien recibio" on finanzas.pago_quien_recibio for INSERT to finanzas_app with check (true);
create policy "sesion - cambiar quien recibio" on finanzas.pago_quien_recibio for UPDATE to finanzas_app using (true) with check (true);
create policy "sesion - leer quien recibio" on finanzas.pago_quien_recibio for SELECT to finanzas_app using (true);
create policy "sesion - quitar quien recibio de pagos web" on finanzas.pago_quien_recibio for DELETE to finanzas_app using ((NOT (EXISTS ( SELECT 1
   FROM pagos p
  WHERE ((p.id = pago_quien_recibio.pago_id) AND (p.id_origen IS NOT NULL))))));
create policy "solo con sesion - sensibles" on finanzas.pagos_equipo_sensibles for ALL to finanzas_app using (true) with check (true);
create policy "solo con sesion - pagos equipo" on finanzas.pagos_equipo for ALL to finanzas_app using (true) with check (true);
create policy "solo con sesion - pagos" on finanzas.pagos for ALL to finanzas_app using (true) with check (true);
create policy "autorizados - leer historial sensibles" on finanzas.personas_sensibles_historial for SELECT to finanzas_app using (( SELECT finanzas_priv.es_autorizado_sensibles() AS es_autorizado_sensibles));
create policy "autorizados - crear sensibles" on finanzas.personas_sensibles for INSERT to finanzas_app with check (( SELECT finanzas_priv.es_autorizado_sensibles() AS es_autorizado_sensibles));
create policy "autorizados - editar sensibles" on finanzas.personas_sensibles for UPDATE to finanzas_app using (( SELECT finanzas_priv.es_autorizado_sensibles() AS es_autorizado_sensibles)) with check (( SELECT finanzas_priv.es_autorizado_sensibles() AS es_autorizado_sensibles));
create policy "autorizados - leer sensibles" on finanzas.personas_sensibles for SELECT to finanzas_app using (( SELECT finanzas_priv.es_autorizado_sensibles() AS es_autorizado_sensibles));
create policy "solo con sesion - personas" on finanzas.personas for ALL to finanzas_app using (true) with check (true);
create policy "solo con sesion - leer vocabularios" on finanzas.vocabularios_correccion for SELECT to finanzas_app using (true);

-- 5) 1/11/2026: extras en Pagos del equipo (Tomás: «para poner extras, por si la persona hizo más cosas de lo que tenía
--    que hacer»). Suman al total; el detalle cuenta qué hizo. La vista pagos_equipo_vigentes las agrega al final.
alter table finanzas.pagos_equipo add column extras numeric not null default 0, add column extras_detalle text,
  add constraint pagos_equipo_extras_no_negativo check (extras >= 0);
-- create or replace view finanzas.pagos_equipo_vigentes ... , (jsonb_populate_record(null::finanzas.pagos_equipo, a.j)).extras as extras,
--   (jsonb_populate_record(null::finanzas.pagos_equipo, a.j)).extras_detalle as extras_detalle
