-- â”€â”€ Estructura de la base de Finanzas SKWD (Supabase Â«finanzas-skwdÂ», org skyward) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- LeÃ­da el 1/11/2026 desde el catÃ¡logo de Postgres (pg_class, pg_proc, pg_trigger, pg_policies), con consultas de solo
-- lectura. Esquemas public y private. SIN DATOS: ni filas, ni la lista de correos autorizados (private.sensibles_autorizados),
-- ni claves. Es la referencia para ver y discutir cambios desde GitHub (pedido de TomÃ¡s: Â«todo combinado en GitHubÂ»);
-- no es un volcado completo para recrear la base (faltan claves primarias, Ã­ndices, restricciones y permisos de tabla).
-- Los permisos (RLS) solo piden el rol authenticated y miran el correo del token: ver docs/FINANZAS-SKWD.md.
-- Un cambio en la base se hace en Supabase (SQL editor) y se actualiza este archivo en el mismo PR.

create table public.campos_corregibles (tabla text not null, campo text not null);
create table public.conciliaciones (id bigint not null, movimiento_cuenta_id bigint not null, estado text not null, destino_tipo text, destino_id bigint, destino_mes date, confianza text, nota text, creado_en timestamp with time zone not null default now());
create table public.correcciones (id bigint not null, tabla text not null, registro_id bigint not null, campo text not null, tipo_evento text not null default 'correccion'::text, valor_original jsonb not null, valor_anterior jsonb not null, valor_nuevo jsonb not null, motivo text not null, referencia text, corregido_por text not null, corregido_en timestamp with time zone not null);
create table public.cuentas (id bigint not null, nombre text not null, titular text not null, banco text, activa boolean not null default true, notas text, creado_en timestamp with time zone default now());
create table public.estado_parametros (anio integer not null, saldo_inicial numeric not null default 0, notas text, actualizado_en timestamp with time zone not null default now());
create table public.estado_referencia_excel (anio smallint not null, mes smallint not null, beneficio numeric(14,2) not null, acumulado numeric(14,2), causa text, fecha_referencia date not null);
create table public.gastos (id bigint not null, fecha date not null, concepto text not null, monto_usd numeric not null, tipo text, departamento text, cuenta text, creado_en timestamp with time zone default now(), id_origen text);
create table public.gastos_personales (id bigint not null, fecha date not null default CURRENT_DATE, ejecutado_por text not null, tipo_gasto text not null, gasto_de text not null, monto_usd numeric not null, descripcion text, creado_en timestamp with time zone default now());
create table public.movimientos_cuenta (id bigint not null, cuenta_id bigint not null, fecha date, fecha_original text, periodo date, periodo_fuente text not null default 'pendiente'::text, descripcion text not null, monto numeric not null, tipo text not null, de_quien_para_quien text, nota text, es_resumen boolean not null default false, es_personal boolean default (tipo = ANY (ARRAY['Gasto personal compartido'::text, 'Gasto personal'::text])), sin_fecha boolean default (fecha IS NULL), sin_periodo boolean default (periodo IS NULL), revisar boolean not null default false, nota_revision text, hoja_origen text, id_origen text, creado_en timestamp with time zone default now());
create table public.pago_quien_recibio (pago_id bigint not null, quien text not null, creado_por text not null default 'fuera de la app'::text, creado_en timestamp with time zone not null default now(), actualizado_en timestamp with time zone not null default now());
create table public.pagos (id bigint not null, fecha date not null, cliente text not null, telefono text, monto_usd numeric not null, programa text, closer text, setter text, concepto text, fuente text, tipo_venta text, tipo_pago text, cuenta text, comision numeric default 0, creado_en timestamp with time zone default now(), comprobante text, pesos_ars numeric, moneda_original text default 'USD'::text, mes text, cat_cash text, revisar boolean default false, nota_revision text, id_origen text);
create table public.pagos_equipo (id bigint not null, persona_id bigint not null, mes date not null, nombre_original text not null, puesto text, departamento text, moneda text, moneda_original text, honorarios_base numeric default 0, bonuses numeric default 0, comision numeric default 0, total_usd numeric not null default 0, total_ars numeric, fecha_pago date, pagado boolean not null default false, pagado_por text, nota text, id_origen text, creado_en timestamp with time zone default now());
create table public.pagos_equipo_sensibles (pago_equipo_id bigint not null, cuil_cuit text, direccion_pago_ars text, direccion_pago_usd text, telefono text, creado_en timestamp with time zone default now());
create table public.personas (id bigint not null, nombre text not null, apodos text, puesto text, departamento text, activo boolean not null default true, notas text, creado_en timestamp with time zone default now());
create table public.personas_sensibles (persona_id bigint not null, cuil_cuit text, telefono text, direccion_pago_ars text, direccion_pago_usd text, pendientes jsonb not null default '{}'::jsonb, origen text not null default 'web'::text, nota_origen text, creado_en timestamp with time zone not null default now(), actualizado_en timestamp with time zone not null default now(), actualizado_por text not null default 'fuera de la app'::text);
create table public.personas_sensibles_historial (id bigint not null, persona_id bigint not null, cambiado_en timestamp with time zone not null default now(), cambiado_por text not null, operacion text not null, cuil_cuit text, telefono text, direccion_pago_ars text, direccion_pago_usd text);
create table private.sensibles_autorizados (email text not null, agregado_en timestamp with time zone not null default now());
create table public.vocabularios_correccion (tabla text not null, campo text not null, valor text not null);
create view public.correcciones_por_registro as  SELECT tabla, registro_id, jsonb_object_agg(campo, valor_nuevo) AS mapa, jsonb_object_agg(campo, valor_original) AS originales, (count(*))::integer AS campos_corregidos FROM correcciones_vigentes GROUP BY tabla, registro_id;
create view public.correcciones_vigentes as  SELECT id, tabla, registro_id, campo, tipo_evento, valor_original, valor_anterior, valor_nuevo, motivo, referencia, corregido_por, corregido_en FROM ( SELECT DISTINCT ON (correcciones.tabla, correcciones.registro_id, correcciones.campo) correcciones.id, correcciones.tabla, correcciones.registro_id, correcciones.campo, correcciones.tipo_evento, correcciones.valor_original, correcciones.valor_anterior, correcciones.valor_nuevo, correcciones.motivo, correcciones.referencia, correcciones.corregido_por, correcciones.corregido_en FROM correcciones ORDER BY correcciones.tabla, correcciones.registro_id, correcciones.campo, correcciones.id DESC) ult WHERE (tipo_evento = 'correccion'::text);
create view public.gastos_vigentes as  SELECT (jsonb_populate_record(NULL::gastos, a.j)).id AS id, (jsonb_populate_record(NULL::gastos, a.j)).fecha AS fecha, (jsonb_populate_record(NULL::gastos, a.j)).concepto AS concepto, (jsonb_populate_record(NULL::gastos, a.j)).monto_usd AS monto_usd, (jsonb_populate_record(NULL::gastos, a.j)).tipo AS tipo, (jsonb_populate_record(NULL::gastos, a.j)).departamento AS departamento, (jsonb_populate_record(NULL::gastos, a.j)).cuenta AS cuenta, (jsonb_populate_record(NULL::gastos, a.j)).creado_en AS creado_en, (jsonb_populate_record(NULL::gastos, a.j)).id_origen AS id_origen, c.mapa AS correcciones, c.originales AS valores_originales FROM ((gastos g LEFT JOIN correcciones_por_registro c ON (((c.tabla = 'gastos'::text) AND (c.registro_id = g.id)))) CROSS JOIN LATERAL ( SELECT (to_jsonb(g.*) || COALESCE(c.mapa, '{}'::jsonb)) AS j) a);
create view public.movimientos_cuenta_empresa as  SELECT id, cuenta_id, fecha, fecha_original, periodo, periodo_fuente, descripcion, monto, tipo, de_quien_para_quien, nota, es_resumen, es_personal, sin_fecha, sin_periodo, revisar, nota_revision, hoja_origen, id_origen, creado_en, correcciones, valores_originales FROM movimientos_cuenta_vigentes WHERE ((NOT es_personal) AND (NOT es_resumen));
create view public.movimientos_cuenta_vigentes as  SELECT (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).id AS id, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).cuenta_id AS cuenta_id, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).fecha AS fecha, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).fecha_original AS fecha_original, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).periodo AS periodo, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).periodo_fuente AS periodo_fuente, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).descripcion AS descripcion, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).monto AS monto, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).tipo AS tipo, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).de_quien_para_quien AS de_quien_para_quien, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).nota AS nota, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).es_resumen AS es_resumen, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).es_personal AS es_personal, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).sin_fecha AS sin_fecha, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).sin_periodo AS sin_periodo, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).revisar AS revisar, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).nota_revision AS nota_revision, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).hoja_origen AS hoja_origen, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).id_origen AS id_origen, (jsonb_populate_record(NULL::movimientos_cuenta, k.j)).creado_en AS creado_en, c.mapa AS correcciones, c.originales AS valores_originales FROM ((((movimientos_cuenta m LEFT JOIN correcciones_por_registro c ON (((c.tabla = 'movimientos_cuenta'::text) AND (c.registro_id = m.id)))) CROSS JOIN LATERAL ( SELECT (to_jsonb(m.*) || COALESCE(c.mapa, '{}'::jsonb)) AS j) a) CROSS JOIN LATERAL ( SELECT (a.j || jsonb_build_object('periodo', CASE WHEN ((c.mapa ? 'fecha'::text) AND (m.periodo_fuente = 'fecha'::text) AND ((a.j ->> 'fecha'::text) IS NOT NULL)) THEN to_char(((date_trunc('month'::text, (((a.j ->> 'fecha'::text))::date)::timestamp without time zone))::date)::timestamp with time zone, 'YYYY-MM-DD'::text) ELSE (a.j ->> 'periodo'::text) END)) AS j) b) CROSS JOIN LATERAL ( SELECT (b.j || jsonb_build_object('es_personal', ((b.j ->> 'tipo'::text) = ANY (ARRAY['Gasto personal compartido'::text, 'Gasto personal'::text])), 'sin_fecha', ((b.j ->> 'fecha'::text) IS NULL), 'sin_periodo', ((b.j ->> 'periodo'::text) IS NULL))) AS j) k);
create view public.pagos_equipo_vigentes as  SELECT (jsonb_populate_record(NULL::pagos_equipo, a.j)).id AS id, (jsonb_populate_record(NULL::pagos_equipo, a.j)).persona_id AS persona_id, (jsonb_populate_record(NULL::pagos_equipo, a.j)).mes AS mes, (jsonb_populate_record(NULL::pagos_equipo, a.j)).nombre_original AS nombre_original, (jsonb_populate_record(NULL::pagos_equipo, a.j)).puesto AS puesto, (jsonb_populate_record(NULL::pagos_equipo, a.j)).departamento AS departamento, (jsonb_populate_record(NULL::pagos_equipo, a.j)).moneda AS moneda, (jsonb_populate_record(NULL::pagos_equipo, a.j)).moneda_original AS moneda_original, (jsonb_populate_record(NULL::pagos_equipo, a.j)).honorarios_base AS honorarios_base, (jsonb_populate_record(NULL::pagos_equipo, a.j)).bonuses AS bonuses, (jsonb_populate_record(NULL::pagos_equipo, a.j)).comision AS comision, (jsonb_populate_record(NULL::pagos_equipo, a.j)).total_usd AS total_usd, (jsonb_populate_record(NULL::pagos_equipo, a.j)).total_ars AS total_ars, (jsonb_populate_record(NULL::pagos_equipo, a.j)).fecha_pago AS fecha_pago, (jsonb_populate_record(NULL::pagos_equipo, a.j)).pagado AS pagado, (jsonb_populate_record(NULL::pagos_equipo, a.j)).pagado_por AS pagado_por, (jsonb_populate_record(NULL::pagos_equipo, a.j)).nota AS nota, (jsonb_populate_record(NULL::pagos_equipo, a.j)).id_origen AS id_origen, (jsonb_populate_record(NULL::pagos_equipo, a.j)).creado_en AS creado_en, c.mapa AS correcciones, c.originales AS valores_originales FROM ((pagos_equipo e LEFT JOIN correcciones_por_registro c ON (((c.tabla = 'pagos_equipo'::text) AND (c.registro_id = e.id)))) CROSS JOIN LATERAL ( SELECT (to_jsonb(e.*) || COALESCE(c.mapa, '{}'::jsonb)) AS j) a);
create view public.pagos_vigentes as  SELECT (jsonb_populate_record(NULL::pagos, a.j)).id AS id, (jsonb_populate_record(NULL::pagos, a.j)).fecha AS fecha, (jsonb_populate_record(NULL::pagos, a.j)).cliente AS cliente, (jsonb_populate_record(NULL::pagos, a.j)).telefono AS telefono, (jsonb_populate_record(NULL::pagos, a.j)).monto_usd AS monto_usd, (jsonb_populate_record(NULL::pagos, a.j)).programa AS programa, (jsonb_populate_record(NULL::pagos, a.j)).closer AS closer, (jsonb_populate_record(NULL::pagos, a.j)).setter AS setter, (jsonb_populate_record(NULL::pagos, a.j)).concepto AS concepto, (jsonb_populate_record(NULL::pagos, a.j)).fuente AS fuente, (jsonb_populate_record(NULL::pagos, a.j)).tipo_venta AS tipo_venta, (jsonb_populate_record(NULL::pagos, a.j)).tipo_pago AS tipo_pago, (jsonb_populate_record(NULL::pagos, a.j)).cuenta AS cuenta, (jsonb_populate_record(NULL::pagos, a.j)).comision AS comision, (jsonb_populate_record(NULL::pagos, a.j)).creado_en AS creado_en, (jsonb_populate_record(NULL::pagos, a.j)).comprobante AS comprobante, (jsonb_populate_record(NULL::pagos, a.j)).pesos_ars AS pesos_ars, (jsonb_populate_record(NULL::pagos, a.j)).moneda_original AS moneda_original, (jsonb_populate_record(NULL::pagos, a.j)).mes AS mes, (jsonb_populate_record(NULL::pagos, a.j)).cat_cash AS cat_cash, (jsonb_populate_record(NULL::pagos, a.j)).revisar AS revisar, (jsonb_populate_record(NULL::pagos, a.j)).nota_revision AS nota_revision, (jsonb_populate_record(NULL::pagos, a.j)).id_origen AS id_origen, c.mapa AS correcciones, c.originales AS valores_originales FROM ((pagos p LEFT JOIN correcciones_por_registro c ON (((c.tabla = 'pagos'::text) AND (c.registro_id = p.id)))) CROSS JOIN LATERAL ( SELECT (((to_jsonb(p.*) || COALESCE(c.mapa, '{}'::jsonb)) || CASE WHEN (c.mapa ? 'fecha'::text) THEN jsonb_build_object('mes', mes_en_texto(((c.mapa ->> 'fecha'::text))::date)) ELSE '{}'::jsonb END) || CASE WHEN (c.mapa ? 'pesos_ars'::text) THEN jsonb_build_object('moneda_original', CASE WHEN ((c.mapa ->> 'pesos_ars'::text) IS NULL) THEN 'USD'::text ELSE 'ARS'::text END) ELSE '{}'::jsonb END) AS j) a);
CREATE OR REPLACE FUNCTION public.bloquear_vaciado()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'No se puede vaciar la tabla % (contiene datos importados).', tg_table_name;
end $function$
;
CREATE OR REPLACE FUNCTION public.correcciones_antes_de_insertar()
 RETURNS trigger
 LANGUAGE plpgsql
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

  -- 3) Valor original (siempre le’do de la tabla original) y valor vigente justo antes
  execute format('select to_jsonb(t) -> %L from %I t where t.id = $1', new.campo, new.tabla) into v_original using new.registro_id;
  select c.valor_nuevo into v_anterior from correcciones c
   where c.tabla = new.tabla and c.registro_id = new.registro_id and c.campo = new.campo
   order by c.id desc limit 1;
  v_anterior := coalesce(v_anterior, v_original);

  new.valor_original := v_original;
  new.valor_anterior := v_anterior;
  new.corregido_por := coalesce(auth.jwt() ->> 'email', 'fuera de la app');   -- no se puede falsear desde el navegador
  new.corregido_en := now();

  -- 4) Reversi—n: vuelve al valor original
  if new.tipo_evento = 'reversion' then
    if v_anterior = v_original then
      raise exception 'Ese dato ya est‡ en su valor original.';
    end if;
    new.valor_nuevo := v_original;
    return new;
  end if;

  -- 5) Correcci—n: validar el valor nuevo segœn el tipo del campo
  if new.valor_nuevo is null then
    raise exception 'Falta el valor corregido.';
  end if;
  select format_type(a.atttypid, null), not a.attnotnull into v_tipo, v_admite_vacio
    from pg_attribute a
   where a.attrelid = format('public.%I', new.tabla)::regclass and a.attname = new.campo and not a.attisdropped;

  if jsonb_typeof(new.valor_nuevo) = 'null' then
    if not v_admite_vacio then
      raise exception 'El campo "%" no puede quedar vac’o.', new.campo;
    end if;
  else
    if jsonb_typeof(new.valor_nuevo) in ('object', 'array') then
      raise exception 'Valor no v‡lido para el campo "%".', new.campo;
    end if;
    v_texto := new.valor_nuevo #>> '{}';
    if v_tipo = 'text' then
      v_texto := btrim(v_texto);
      if v_texto = '' then
        raise exception 'El texto no puede estar vac’o (para borrar el dato us‡ el valor vac’o).';
      end if;
      new.valor_nuevo := to_jsonb(v_texto);
    else
      begin
        execute format('select %L::%s', v_texto, v_tipo);
      exception when others then
        raise exception 'El valor "%" no es v‡lido para el campo "%" (%).', v_texto, new.campo, v_tipo;
      end;
      if v_tipo = 'numeric' then
        new.valor_nuevo := to_jsonb(v_texto::numeric);
      elsif v_tipo = 'date' then
        new.valor_nuevo := to_jsonb(v_texto::date);
      end if;
    end if;

    -- 6) Vocabularios cerrados (tabla vocabularios_correccion: ver c—mo ampliarlos en el encabezado de este archivo)
    if exists (select 1 from vocabularios_correccion v where v.tabla = new.tabla and v.campo = new.campo)
       and not exists (select 1 from vocabularios_correccion v where v.tabla = new.tabla and v.campo = new.campo and v.valor = (new.valor_nuevo #>> '{}')) then
      raise exception 'El valor "%" no est‡ permitido para %.%. Valores v‡lidos: %.', (new.valor_nuevo #>> '{}'), new.tabla, new.campo,
        (select string_agg(v.valor, ', ' order by v.valor) from vocabularios_correccion v where v.tabla = new.tabla and v.campo = new.campo);
    end if;

    -- 7) Reglas de montos y fechas (alineadas con las reglas de cada m—dulo)
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
        raise exception 'La fecha % est‡ fuera de rango.', v_fecha;
      end if;
      if new.tabla = 'pagos_equipo' and new.campo = 'mes' and extract(day from v_fecha) <> 1 then
        raise exception 'El mes de Payroll debe ser el d’a 1 del mes.';
      end if;
    end if;
  end if;

  if new.valor_nuevo = v_anterior then
    raise exception 'La correcci—n no cambia el valor vigente.';
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.correcciones_inmutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'El historial de correcciones no se puede modificar ni borrar.';
end $function$
;
CREATE OR REPLACE FUNCTION private.es_autorizado_sensibles()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    select exists (select 1 from private.sensibles_autorizados a where a.email = lower(btrim(coalesce(auth.jwt() ->> 'email', ''))))
  $function$
;
CREATE OR REPLACE FUNCTION public.mes_en_texto(d date)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select extract(year from d)::int::text || '-' ||
         (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])[extract(month from d)::int]
$function$
;
CREATE OR REPLACE FUNCTION public.pago_quien_recibio_proteger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
  begin
    if tg_op = 'INSERT' then
      new.creado_por := coalesce(auth.jwt() ->> 'email', 'fuera de la app');   -- lo pone la base, no el navegador
      new.creado_en := now();
      new.actualizado_en := now();
      return new;
    end if;
    if tg_op = 'UPDATE' then
      if new.pago_id is distinct from old.pago_id then
        raise exception 'No se puede cambiar el pago de una asignaci—n (pago #%).', old.pago_id;
      end if;
      new.creado_por := old.creado_por;
      new.creado_en := old.creado_en;
      new.actualizado_en := now();
      return new;
    end if;
    -- DELETE: la asignaci—n de un pago importado se puede cambiar de opci—n, pero no quitar
    if exists (select 1 from public.pagos p where p.id = old.pago_id and p.id_origen is not null) then
      raise exception 'La asignaci—n de un pago importado no se puede borrar (pago #%): se puede cambiar de opci—n, no quitar.', old.pago_id;
    end if;
    return old;
  end $function$
;
CREATE OR REPLACE FUNCTION private.personas_sensibles_historial_inmutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
  begin
    raise exception 'El historial de datos sensibles es de solo agregado: no se edita ni se borra.';
  end $function$
;
CREATE OR REPLACE FUNCTION private.personas_sensibles_historial_registrar()
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
    insert into public.personas_sensibles_historial (persona_id, cambiado_por, operacion, cuil_cuit, telefono, direccion_pago_ars, direccion_pago_usd)
    values (new.persona_id, new.actualizado_por, case tg_op when 'INSERT' then 'alta' else 'cambio' end,
            new.cuil_cuit, new.telefono, new.direccion_pago_ars, new.direccion_pago_usd);
    return null;
  end $function$
;
CREATE OR REPLACE FUNCTION private.personas_sensibles_proteger()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
  begin
    if tg_op = 'DELETE' then
      raise exception 'Los datos sensibles de una persona no se borran: se editan (un campo se puede dejar vac’o).';
    end if;
    if jsonb_typeof(new.pendientes) is distinct from 'object' then
      raise exception 'El campo ÇpendientesÈ debe ser un objeto {campo: motivo}.';
    end if;
    new.cuil_cuit := private.sensibles_limpiar(new.cuil_cuit);
    new.telefono := private.sensibles_limpiar(new.telefono);
    new.direccion_pago_ars := private.sensibles_limpiar(new.direccion_pago_ars);
    new.direccion_pago_usd := private.sensibles_limpiar(new.direccion_pago_usd);
    new.pendientes := new.pendientes - array_remove(array[
        case when new.cuil_cuit is not null then 'cuil_cuit' end,
        case when new.telefono is not null then 'telefono' end,
        case when new.direccion_pago_ars is not null then 'direccion_pago_ars' end,
        case when new.direccion_pago_usd is not null then 'direccion_pago_usd' end]::text[], null);
    new.actualizado_por := coalesce(auth.jwt() ->> 'email', 'fuera de la app');
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
CREATE OR REPLACE FUNCTION public.proteger_importadas()
 RETURNS trigger
 LANGUAGE plpgsql
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
    return new;                                   -- fila creada en la web: edici—n libre
  end if;
  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  if tg_nargs > 0 then
    foreach v_col in array tg_argv loop           -- campos de trabajo que Sê pueden cambiar
      v_old := v_old - v_col;
      v_new := v_new - v_col;
    end loop;
  end if;
  -- Columnas GENERADAS (calculadas por la base a partir de otras): PostgreSQL las calcula DESPUƒS de los triggers BEFORE,
  -- por eso dentro de este trigger no son comparables. Se excluyen todas (es_personal, sin_fecha, sin_periodo y las que se agreguen):
  -- no se pierde protecci—n, porque las columnas de las que derivan (tipo, fecha, periodo) s’ se comparan.
  for v_col in select a.attname::text from pg_attribute a where a.attrelid = tg_relid and a.attnum > 0 and not a.attisdropped and a.attgenerated <> '' loop
    v_old := v_old - v_col;
    v_new := v_new - v_col;
  end loop;
  if tg_table_name = 'movimientos_cuenta' then    -- solo esta tabla tiene la regla de la fecha vac’a
    if (v_old ->> 'fecha') is null then           -- se lee por JSON: old.fecha no existe en pagos_equipo (esa tabla usa "mes")
      v_old := v_old - 'fecha';                   -- completar una fecha vac’a est‡ permitido
      v_new := v_new - 'fecha';
    end if;
  end if;
  if v_old is distinct from v_new then
    select string_agg(k, ', ' order by k) into v_dif
      from (select n.key as k from jsonb_each(v_new) n where n.value is distinct from v_old -> n.key
            union select o.key from jsonb_each(v_old) o where not (v_new ? o.key)) d;
    raise exception 'La fila importada % #% no se puede modificar directamente: us‡ "Corregir dato" (los originales son intocables). Campos que se intentaron cambiar: %.', tg_table_name, old.id, coalesce(v_dif, '(ninguno identificable)');
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION private.sensibles_limpiar(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
    select nullif(regexp_replace(t, '^[\s\u00a0\u180e\u2007\u2028\u2029\u202f\u205f\u3000\u200b\u200c\u200d\u2060\ufeff]+|[\s\u00a0\u180e\u2007\u2028\u2029\u202f\u205f\u3000\u200b\u200c\u200d\u2060\ufeff]+$', '', 'g'), '')
  $function$
;
CREATE OR REPLACE FUNCTION private.sensibles_normalizar(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
    select case
             when t is null then null
             when s.x ~ '[^\x01-\x7f\u00a0-\u00a9\u00ab-\u00b1\u00b4\u00b6-\u00b8\u00bb\u00bf\u00d7\u00f7\u2000-\u206f\u20a0-\u20cf\u2190-\u23ff\u2500-\u2775\u2794-\u27bf\u27c0-\u27ff\u2900-\u2bff\u2e00-\u2e2e\u2e30-\u2e7f\u3000-\u3004\u3008-\u3020\u3030\u3036\u3037\ufe00-\ufe0f\ufeff\U0001f000-\U0001f0ff\U0001f10d-\U0001faff]' then 'x:' || lower(normalize(private.sensibles_limpiar(t), nfc))
             when s.x ~ '[0-9A-Za-z]' then regexp_replace(translate(s.x, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '[^0-9a-z]', '', 'g')
             else null
           end
    from (select regexp_replace(normalize(btrim(t), nfd), '[\u0300-\u036f]', '', 'g') as x) s
  $function$
;
CREATE OR REPLACE FUNCTION private.sensibles_normalizar_laxa(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
    select case
             when t is null then null
             when s.x !~ '[0-9A-Za-z]' and s.x !~ '[^\x01-\x7f\u00a0-\u00a9\u00ab-\u00b1\u00b4\u00b6-\u00b8\u00bb\u00bf\u00d7\u00f7\u2000-\u206f\u20a0-\u20cf\u2190-\u23ff\u2500-\u2775\u2794-\u27bf\u27c0-\u27ff\u2900-\u2bff\u2e00-\u2e2e\u2e30-\u2e7f\u3000-\u3004\u3008-\u3020\u3030\u3036\u3037\ufe00-\ufe0f\ufeff\U0001f000-\U0001f0ff\U0001f10d-\U0001faff]' then null
             else coalesce(nullif(regexp_replace(translate(s.x, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '[^0-9a-z]', '', 'g'), ''),
                           'x:' || lower(normalize(private.sensibles_limpiar(t), nfc)))
           end
    from (select regexp_replace(normalize(btrim(t), nfd), '[\u0300-\u036f]', '', 'g') as x) s
  $function$
;
CREATE OR REPLACE FUNCTION private.sensibles_plan_migracion()
 RETURNS TABLE(persona_id bigint, campo text, valores_distintos integer, valor_reciente text, motivo text, accion text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
    with s as (
      select e.persona_id, e.mes, x.pago_equipo_id,
             private.sensibles_limpiar(x.cuil_cuit) as cuit, private.sensibles_limpiar(x.telefono) as tel,
             private.sensibles_limpiar(x.direccion_pago_ars) as ars, private.sensibles_limpiar(x.direccion_pago_usd) as usd
      from public.pagos_equipo_sensibles x
      join public.pagos_equipo_vigentes e on e.id = x.pago_equipo_id
      where e.persona_id is not null
    ), pc as (
      select s.persona_id, s.mes, s.pago_equipo_id, 'cuil_cuit'::text as campo, s.cuit as raw from s where s.cuit is not null
      union all select s.persona_id, s.mes, s.pago_equipo_id, 'telefono', s.tel from s where s.tel is not null
      union all select s.persona_id, s.mes, s.pago_equipo_id, 'direccion_pago_ars', s.ars from s where s.ars is not null
      union all select s.persona_id, s.mes, s.pago_equipo_id, 'direccion_pago_usd', s.usd from s where s.usd is not null
    ), pn as (
      select pc.*, private.sensibles_normalizar(pc.raw) as v, private.sensibles_normalizar_laxa(pc.raw) as vl
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
                  when r.n = 0 then 'solo marcadores sin letras ni nœmeros'
             end as motivo
      from r
    )
    select m.persona_id, m.campo, m.n, m.reciente, m.motivo,
           case when exists (select 1 from public.personas_sensibles ps where ps.persona_id = m.persona_id) then 'omitir'
                when m.n = 0 then 'ignorar'
                when m.motivo is null then 'copiar'
                else 'pendiente' end
    from m
  $function$
;
CREATE TRIGGER correcciones_no_modificar BEFORE DELETE OR UPDATE ON public.correcciones FOR EACH ROW EXECUTE FUNCTION correcciones_inmutable();
CREATE TRIGGER correcciones_no_vaciar BEFORE TRUNCATE ON public.correcciones FOR EACH STATEMENT EXECUTE FUNCTION correcciones_inmutable();
CREATE TRIGGER correcciones_validar BEFORE INSERT ON public.correcciones FOR EACH ROW EXECUTE FUNCTION correcciones_antes_de_insertar();
CREATE TRIGGER gastos_no_vaciar BEFORE TRUNCATE ON public.gastos FOR EACH STATEMENT EXECUTE FUNCTION bloquear_vaciado();
CREATE TRIGGER gastos_proteger BEFORE DELETE OR UPDATE ON public.gastos FOR EACH ROW EXECUTE FUNCTION proteger_importadas();
CREATE TRIGGER movimientos_cuenta_no_vaciar BEFORE TRUNCATE ON public.movimientos_cuenta FOR EACH STATEMENT EXECUTE FUNCTION bloquear_vaciado();
CREATE TRIGGER movimientos_cuenta_proteger BEFORE DELETE OR UPDATE ON public.movimientos_cuenta FOR EACH ROW EXECUTE FUNCTION proteger_importadas('cuenta_id', 'nota', 'revisar', 'nota_revision', 'periodo', 'periodo_fuente');
CREATE TRIGGER pago_quien_recibio_proteger BEFORE INSERT OR DELETE OR UPDATE ON public.pago_quien_recibio FOR EACH ROW EXECUTE FUNCTION pago_quien_recibio_proteger();
CREATE TRIGGER pagos_equipo_no_vaciar BEFORE TRUNCATE ON public.pagos_equipo FOR EACH STATEMENT EXECUTE FUNCTION bloquear_vaciado();
CREATE TRIGGER pagos_equipo_proteger BEFORE DELETE OR UPDATE ON public.pagos_equipo FOR EACH ROW EXECUTE FUNCTION proteger_importadas('pagado', 'pagado_por', 'nota');
CREATE TRIGGER pagos_no_vaciar BEFORE TRUNCATE ON public.pagos FOR EACH STATEMENT EXECUTE FUNCTION bloquear_vaciado();
CREATE TRIGGER pagos_proteger BEFORE DELETE OR UPDATE ON public.pagos FOR EACH ROW EXECUTE FUNCTION proteger_importadas('revisar', 'nota_revision');
CREATE TRIGGER personas_sensibles_historial_inmutable BEFORE DELETE OR UPDATE ON public.personas_sensibles_historial FOR EACH ROW EXECUTE FUNCTION private.personas_sensibles_historial_inmutable();
CREATE TRIGGER personas_sensibles_historial_no_vaciar BEFORE TRUNCATE ON public.personas_sensibles_historial FOR EACH STATEMENT EXECUTE FUNCTION bloquear_vaciado();
CREATE TRIGGER personas_sensibles_historial_registrar AFTER INSERT OR UPDATE ON public.personas_sensibles FOR EACH ROW EXECUTE FUNCTION private.personas_sensibles_historial_registrar();
CREATE TRIGGER personas_sensibles_no_vaciar BEFORE TRUNCATE ON public.personas_sensibles FOR EACH STATEMENT EXECUTE FUNCTION bloquear_vaciado();
CREATE TRIGGER personas_sensibles_proteger BEFORE INSERT OR DELETE OR UPDATE ON public.personas_sensibles FOR EACH ROW EXECUTE FUNCTION private.personas_sensibles_proteger();
create policy "solo con sesion - leer campos corregibles" on public.campos_corregibles for SELECT to authenticated using (true);
create policy "solo con sesion - conciliaciones" on public.conciliaciones for ALL to authenticated using (true) with check (true);
create policy "solo con sesion - agregar correcciones" on public.correcciones for INSERT to authenticated with check (true);
create policy "solo con sesion - leer correcciones" on public.correcciones for SELECT to authenticated using (true);
create policy "solo con sesion - cuentas" on public.cuentas for ALL to authenticated using (true) with check (true);
create policy "solo con sesion - estado parametros" on public.estado_parametros for ALL to authenticated using (true) with check (true);
create policy "autorizados - leer referencia excel" on public.estado_referencia_excel for SELECT to authenticated using (( SELECT private.es_autorizado_sensibles() AS es_autorizado_sensibles));
create policy "solo con sesion - gastos personales" on public.gastos_personales for ALL to authenticated using (true) with check (true);
create policy "solo con sesion - gastos" on public.gastos for ALL to authenticated using (true) with check (true);
create policy "solo con sesion - movimientos cuenta" on public.movimientos_cuenta for ALL to authenticated using (true) with check (true);
create policy "sesion - asignar quien recibio" on public.pago_quien_recibio for INSERT to authenticated with check (true);
create policy "sesion - cambiar quien recibio" on public.pago_quien_recibio for UPDATE to authenticated using (true) with check (true);
create policy "sesion - leer quien recibio" on public.pago_quien_recibio for SELECT to authenticated using (true);
create policy "sesion - quitar quien recibio de pagos web" on public.pago_quien_recibio for DELETE to authenticated using ((NOT (EXISTS ( SELECT 1
   FROM pagos p
  WHERE ((p.id = pago_quien_recibio.pago_id) AND (p.id_origen IS NOT NULL))))));
create policy "solo con sesion - sensibles" on public.pagos_equipo_sensibles for ALL to authenticated using (true) with check (true);
create policy "solo con sesion - pagos equipo" on public.pagos_equipo for ALL to authenticated using (true) with check (true);
create policy "solo con sesion - pagos" on public.pagos for ALL to authenticated using (true) with check (true);
create policy "autorizados - leer historial sensibles" on public.personas_sensibles_historial for SELECT to authenticated using (( SELECT private.es_autorizado_sensibles() AS es_autorizado_sensibles));
create policy "autorizados - crear sensibles" on public.personas_sensibles for INSERT to authenticated with check (( SELECT private.es_autorizado_sensibles() AS es_autorizado_sensibles));
create policy "autorizados - editar sensibles" on public.personas_sensibles for UPDATE to authenticated using (( SELECT private.es_autorizado_sensibles() AS es_autorizado_sensibles)) with check (( SELECT private.es_autorizado_sensibles() AS es_autorizado_sensibles));
create policy "autorizados - leer sensibles" on public.personas_sensibles for SELECT to authenticated using (( SELECT private.es_autorizado_sensibles() AS es_autorizado_sensibles));
create policy "solo con sesion - personas" on public.personas for ALL to authenticated using (true) with check (true);
create policy "solo con sesion - leer vocabularios" on public.vocabularios_correccion for SELECT to authenticated using (true);