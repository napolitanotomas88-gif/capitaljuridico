-- ── 1/11/2026 · «Pagado por» repartido en Pagos del equipo ───────────────────────────────────────────────────────────
-- Pedido de Tomás: «que pueda elegir quién paga tanto porcentaje, ya sea Tomi, Gero, Financiera o Empresa» (ej.: Carlos
-- comisionó USD 4.000; Gero paga 80 % y Tomi 20 %).
--   · finanzas.pagos_equipo_pagadores: una fila por pagador de cada línea (quién + porcentaje). Si una línea tiene filas,
--     tienen que sumar 100 % (± 0,01): lo controla un trigger DIFERIDO (al confirmar la transacción), así se puede
--     reemplazar el reparto entero sin pasar por estados intermedios inválidos.
--   · pagos_equipo.pagado_por queda como RESUMEN legible («Gero 80% · Tomi 20%», o el nombre solo si es 100 %) para lo
--     que ya lo lee (Resumen, Equipo, cierre). Lo escribe finanzas.reemplazar_pagadores(); su check se amplía para
--     aceptar ese formato y «Empresa».
--   · La vista pagos_equipo_vigentes suma la columna `pagadores` (jsonb: [{quien, porcentaje}], [] si no hay reparto).
--   · Backfill: las líneas con pagado_por Tomi / Gero / Financiera / Empresa reciben una fila al 100 %; «Tomi y Gero»
--     (si existiera) → 50/50. No cambia ningún valor existente de pagos_equipo.
-- Aditiva e idempotente: se puede correr más de una vez. Aplicar con scripts/finanzas-migrar-pagadores.mjs.
set search_path to finanzas, finanzas_priv;

create table if not exists finanzas.pagos_equipo_pagadores (
  pago_equipo_id bigint not null references finanzas.pagos_equipo(id) on delete cascade,
  quien text not null,
  porcentaje numeric not null,
  creado_en timestamp with time zone not null default now(),
  constraint pagos_equipo_pagadores_pkey primary key (pago_equipo_id, quien),
  constraint pagos_equipo_pagadores_quien_check check (quien = any (array['Tomi'::text, 'Gero'::text, 'Financiera'::text, 'Empresa'::text])),
  constraint pagos_equipo_pagadores_porcentaje_check check (porcentaje > 0 and porcentaje <= 100 and porcentaje = round(porcentaje, 2))
);

-- Resumen legible del reparto de una línea: «Gero 80% · Tomi 20%»; un solo pagador al 100 % = su nombre; sin filas = null.
create or replace function finanzas.resumen_pagadores(p_pago_equipo_id bigint)
 returns text
 language sql
 stable
 set search_path to finanzas, finanzas_priv
as $function$
  select case
    when count(*) = 0 then null
    when count(*) = 1 and min(porcentaje) = 100 then min(quien)
    else string_agg(quien || ' ' || case when porcentaje = trunc(porcentaje) then trunc(porcentaje)::text
                                         else replace(rtrim(round(porcentaje, 2)::text, '0'), '.', ',') end || '%', ' · '
                    order by porcentaje desc, array_position(array['Tomi', 'Gero', 'Financiera', 'Empresa'], quien))
  end
  from finanzas.pagos_equipo_pagadores where pago_equipo_id = p_pago_equipo_id
$function$;

-- Trigger diferido: al confirmar, los porcentajes de cada línea con reparto suman 100 (± 0,01).
create or replace function finanzas.pagadores_validar_suma()
 returns trigger
 language plpgsql
 set search_path to finanzas, finanzas_priv
as $function$
declare
  v_id bigint := coalesce(new.pago_equipo_id, old.pago_equipo_id);
  v_suma numeric;
  v_n integer;
begin
  select coalesce(sum(porcentaje), 0), count(*) into v_suma, v_n from finanzas.pagos_equipo_pagadores where pago_equipo_id = v_id;
  if v_n > 0 and abs(v_suma - 100) > 0.01 then
    raise exception 'Los porcentajes de «Pagado por» de la línea #% suman %: tienen que sumar 100%%.', v_id, replace(v_suma::text, '.', ',') || '%'
      using errcode = 'check_violation';
  end if;
  return null;
end $function$;

drop trigger if exists pagos_equipo_pagadores_suma on finanzas.pagos_equipo_pagadores;
create constraint trigger pagos_equipo_pagadores_suma after insert or update or delete on finanzas.pagos_equipo_pagadores
  deferrable initially deferred for each row execute function finanzas.pagadores_validar_suma();
drop trigger if exists pagos_equipo_pagadores_no_vaciar on finanzas.pagos_equipo_pagadores;
create trigger pagos_equipo_pagadores_no_vaciar before truncate on finanzas.pagos_equipo_pagadores
  for each statement execute function finanzas.bloquear_vaciado();

-- Reemplaza el reparto entero de una línea (en una sola transacción) y deja el resumen en pagos_equipo.pagado_por.
-- p_reparto: [{"quien": "Gero", "porcentaje": 80}, {"quien": "Tomi", "porcentaje": 20}] · [] = sin reparto (pagado_por null).
-- Corre con los permisos de quien llama (finanzas_app con RLS); pagado_por es campo de trabajo también en las importadas.
create or replace function finanzas.reemplazar_pagadores(p_pago_equipo_id bigint, p_reparto jsonb)
 returns text
 language plpgsql
 set search_path to finanzas, finanzas_priv
as $function$
declare
  v_suma numeric;
  v_resumen text;
begin
  if p_reparto is null or jsonb_typeof(p_reparto) <> 'array' then
    raise exception '«Pagado por»: el reparto tiene que ser una lista.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from finanzas.pagos_equipo where id = p_pago_equipo_id) then
    raise exception 'No existe la línea #% de Pagos del equipo.', p_pago_equipo_id using errcode = 'no_data_found';
  end if;
  if (select count(*) from jsonb_array_elements(p_reparto) e) <> (select count(distinct e ->> 'quien') from jsonb_array_elements(p_reparto) e) then
    raise exception '«Pagado por»: cada persona o cuenta puede aparecer una sola vez.' using errcode = 'check_violation';
  end if;
  select coalesce(sum((e ->> 'porcentaje')::numeric), 0) into v_suma from jsonb_array_elements(p_reparto) e;
  if jsonb_array_length(p_reparto) > 0 and abs(v_suma - 100) > 0.01 then
    raise exception '«Pagado por»: los porcentajes suman %: tienen que sumar 100%%.', replace(v_suma::text, '.', ',') || '%' using errcode = 'check_violation';
  end if;
  delete from finanzas.pagos_equipo_pagadores where pago_equipo_id = p_pago_equipo_id;
  insert into finanzas.pagos_equipo_pagadores (pago_equipo_id, quien, porcentaje)
    select p_pago_equipo_id, e ->> 'quien', (e ->> 'porcentaje')::numeric from jsonb_array_elements(p_reparto) e;
  v_resumen := finanzas.resumen_pagadores(p_pago_equipo_id);
  update finanzas.pagos_equipo set pagado_por = v_resumen where id = p_pago_equipo_id and pagado_por is distinct from v_resumen;
  return v_resumen;
end $function$;

-- pagado_por: además de las opciones de siempre, «Empresa» y el resumen «Quién N% · Quién N%».
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'pagos_equipo_pagado_por_check' and conrelid = 'finanzas.pagos_equipo'::regclass
             and pg_get_constraintdef(oid) not like '%Empresa%') then
    alter table finanzas.pagos_equipo drop constraint pagos_equipo_pagado_por_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pagos_equipo_pagado_por_check' and conrelid = 'finanzas.pagos_equipo'::regclass) then
    alter table finanzas.pagos_equipo add constraint pagos_equipo_pagado_por_check check (
      pagado_por = any (array['Financiera'::text, 'Tomi'::text, 'Gero'::text, 'Otro'::text, 'Empresa'::text])
      or pagado_por ~ '^(Tomi|Gero|Financiera|Empresa) [0-9]{1,3}(,[0-9]{1,2})?%( · (Tomi|Gero|Financiera|Empresa) [0-9]{1,3}(,[0-9]{1,2})?%)+$');
  end if;
end $$;

-- Vista: misma definición de siempre + `pagadores` al final.
create or replace view finanzas.pagos_equipo_vigentes with (security_invoker = on) as
 SELECT (jsonb_populate_record(NULL::finanzas.pagos_equipo, a.j)).id AS id,
    (jsonb_populate_record(NULL::finanzas.pagos_equipo, a.j)).persona_id AS persona_id,
    (jsonb_populate_record(NULL::finanzas.pagos_equipo, a.j)).mes AS mes,
    (jsonb_populate_record(NULL::finanzas.pagos_equipo, a.j)).nombre_original AS nombre_original,
    (jsonb_populate_record(NULL::finanzas.pagos_equipo, a.j)).puesto AS puesto,
    (jsonb_populate_record(NULL::finanzas.pagos_equipo, a.j)).departamento AS departamento,
    (jsonb_populate_record(NULL::finanzas.pagos_equipo, a.j)).moneda AS moneda,
    (jsonb_populate_record(NULL::finanzas.pagos_equipo, a.j)).moneda_original AS moneda_original,
    (jsonb_populate_record(NULL::finanzas.pagos_equipo, a.j)).honorarios_base AS honorarios_base,
    (jsonb_populate_record(NULL::finanzas.pagos_equipo, a.j)).bonuses AS bonuses,
    (jsonb_populate_record(NULL::finanzas.pagos_equipo, a.j)).comision AS comision,
    (jsonb_populate_record(NULL::finanzas.pagos_equipo, a.j)).total_usd AS total_usd,
    (jsonb_populate_record(NULL::finanzas.pagos_equipo, a.j)).total_ars AS total_ars,
    (jsonb_populate_record(NULL::finanzas.pagos_equipo, a.j)).fecha_pago AS fecha_pago,
    (jsonb_populate_record(NULL::finanzas.pagos_equipo, a.j)).pagado AS pagado,
    (jsonb_populate_record(NULL::finanzas.pagos_equipo, a.j)).pagado_por AS pagado_por,
    (jsonb_populate_record(NULL::finanzas.pagos_equipo, a.j)).nota AS nota,
    (jsonb_populate_record(NULL::finanzas.pagos_equipo, a.j)).id_origen AS id_origen,
    (jsonb_populate_record(NULL::finanzas.pagos_equipo, a.j)).creado_en AS creado_en,
    c.mapa AS correcciones,
    c.originales AS valores_originales,
    (jsonb_populate_record(NULL::finanzas.pagos_equipo, a.j)).extras AS extras,
    (jsonb_populate_record(NULL::finanzas.pagos_equipo, a.j)).extras_detalle AS extras_detalle,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('quien', p.quien, 'porcentaje', p.porcentaje)
               ORDER BY p.porcentaje DESC, (array_position(ARRAY['Tomi'::text, 'Gero'::text, 'Financiera'::text, 'Empresa'::text], p.quien)))
           FROM finanzas.pagos_equipo_pagadores p WHERE (p.pago_equipo_id = e.id)), '[]'::jsonb) AS pagadores
   FROM ((finanzas.pagos_equipo e
     LEFT JOIN finanzas.correcciones_por_registro c ON (((c.tabla = 'pagos_equipo'::text) AND (c.registro_id = e.id))))
     CROSS JOIN LATERAL ( SELECT (to_jsonb(e.*) || COALESCE(c.mapa, '{}'::jsonb)) AS j) a);

-- Permisos y RLS, como el resto de las tablas de finanzas.
alter table finanzas.pagos_equipo_pagadores enable row level security;
grant select, insert, update, delete on finanzas.pagos_equipo_pagadores to finanzas_app;
grant select on finanzas.pagos_equipo_vigentes to finanzas_app;
grant execute on function finanzas.resumen_pagadores(bigint), finanzas.pagadores_validar_suma(),
  finanzas.reemplazar_pagadores(bigint, jsonb) to finanzas_app;
drop policy if exists "solo con sesion - pagadores" on finanzas.pagos_equipo_pagadores;
create policy "solo con sesion - pagadores" on finanzas.pagos_equipo_pagadores for ALL to finanzas_app using (true) with check (true);

-- Backfill: una fila al 100 % por cada línea con un pagador único; «Tomi y Gero» → 50/50. Solo líneas sin reparto todavía.
insert into finanzas.pagos_equipo_pagadores (pago_equipo_id, quien, porcentaje)
  select e.id, e.pagado_por, 100 from finanzas.pagos_equipo e
  where e.pagado_por = any (array['Tomi', 'Gero', 'Financiera', 'Empresa'])
    and not exists (select 1 from finanzas.pagos_equipo_pagadores p where p.pago_equipo_id = e.id);
insert into finanzas.pagos_equipo_pagadores (pago_equipo_id, quien, porcentaje)
  select e.id, x.quien, 50 from finanzas.pagos_equipo e cross join (values ('Tomi'), ('Gero')) x(quien)
  where e.pagado_por = 'Tomi y Gero'
    and not exists (select 1 from finanzas.pagos_equipo_pagadores p where p.pago_equipo_id = e.id);
