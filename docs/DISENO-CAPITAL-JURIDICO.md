> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

> **27/10/2026: las secciones Tokens, Tipografía, Reglas y Contraste están al día con la estética vigente (marfil, verde, oro, bordó; Sitka + Source Serif 4).** El resto del documento (archivos, componentes, filetes, roles) conserva partes de la estética anterior del 6/10 (Tinta/Sala oscuras, Bodoni, Archivo).

# Sistema de diseño Capital Jurídico

Base visual y de navegación del dashboard unificado. Vive en el grupo de rutas `app/(shell)/` y se prueba en `/sistema` (solo en desarrollo).

Fuente de las reglas: el Manual de Identidad de Skyward tal como se lo transcribió en el pedido del 6/10/2026 y su implementación de referencia en `app/anuncios/layout.tsx`. Si el PDF dice otra cosa, manda el PDF. Revisado contra el original (14 páginas) el 6/10/2026: los seis colores, las dos tipografías, la escala de tamaños (etiqueta 10 a 12 px, cuerpo 15 a 17, título 24 a 46, cifra 38 a 68) y el control de calidad coinciden con lo implementado.

Los estilos son CSS plano con prefijo `cj-` (`app/(shell)/cj.css`), sin mezclarse con las clases del dashboard viejo (`globals.css`, Tailwind).

## Archivos

| Qué | Dónde |
|---|---|
| Tokens y clases `cj-*` | `app/(shell)/cj.css` |
| Fuentes (Bodoni Moda y Archivo, `next/font/google`) | `app/(shell)/fuentes.ts` |
| Layout del shell (marca, navegación, barrera de sesión) | `app/(shell)/layout.tsx` |
| Pantalla de ingreso con Google (y "Acceso no configurado") | `app/entrar/page.tsx` |
| Página 404 en español (para quien ya tiene sesión; sin sesión el proxy lo manda a `/entrar`). Usa los colores del Manual con estilos en línea y tipografía del sistema, SIN `cj.css` ni las fuentes: cuelga del layout raíz y lo que importe se cargaría también en el dashboard viejo (lo vigila `scripts/test-pantallas.mjs`) | `app/not-found.tsx` |
| Revisión de marca (solo desarrollo) | `app/(shell)/sistema/page.tsx` |
| Primitivas | `components/ui/` (se importan de `@/components/ui`) |
| Navegación y wordmark | `components/shell/` |
| Roles, sesión y login con Google | `lib/auth/roles.ts`, `lib/auth/sesion.ts`, `lib/auth/*` y `app/api/auth/*` (ver `docs/ACCESO-Y-ROLES.md`) |

## Tokens (vigentes desde el 7/10/2026; escala y semáforo del 27/10/2026)

Definidos en `:root` de `app/(shell)/cj.css`. Los nombres son heredados de la estética anterior: **`--cj-tinta` es el fondo claro (marfil) y `--cj-hueso` el texto oscuro**. Paleta = Manual de marca Capital Jurídico (pág. 8).

| Token | Valor | Uso |
|---|---|---|
| `--cj-tinta` | `#F2EADC` Marfil | Fondo de la página |
| `--cj-sala` | `#FFFDF8` Blanco cálido | Superficies (paneles, tarjetas). En el Hub, `cristal.css` lo redefine como vidrio translúcido dentro de `.cj-hub-cuerpo` |
| `--cj-hueso` | `#1D1D1B` Negro Tinta | Texto principal, botón primario |
| `--cj-humo` / `--cj-texto-2` | `#605747` | Texto secundario |
| `--cj-laton` | `#805C29` Oro oscuro | Acento como TEXTO o filete sobre claro, foco |
| `--cj-dorado` | `#BE8F49` Oro Capital | Acento SOLO sobre verde o negro (barra lateral, tabbar), marcos, íconos |
| `--cj-verde` | `#012D25` Verde Toga | Barra lateral y tabbar |
| `--cj-borgona` / `--cj-error` | `#7F202C` Bordó | Alertas y semáforo rojo |
| `--cj-ok` | `#1F6B52` | Semáforo verde |
| `--cj-atencion` = `--cj-alerta` | `#8F4C1C` Ocre tostado | Semáforo amarillo/atención. Propio: ya no es el latón del acento |
| `--cj-control` | `#8C7B62` | Borde de campos, botones secundarios y chips |
| `--cj-filete` / `--cj-filete-fuerte` | negro al 14 % / 28 % | Separadores decorativos (no identifican controles) |

**Escala de radios y sombras** (no usar valores sueltos en pantallas nuevas):

| Token | Valor | Uso |
|---|---|---|
| `--cj-radio-s` (= `--cj-radio`) | 6 px | Controles, chips cuadrados, tablas |
| `--cj-radio-m` | 10 px | Tarjetas, íconos con fondo, pestañas del Hub |
| `--cj-radio-l` | 14 px | Paneles grandes, barra de pestañas del Hub |
| `--cj-radio-pildora` | 999 px | Botones y contadores redondeados |
| `--cj-sombra-1` | casi plana | Tarjeta en reposo |
| `--cj-sombra-2` | elevada, difusa | Hover de tarjetas y botones |

**Tokens viejos ↔ `cj-`** (el dashboard viejo `/`, `/anuncios`, `/finanzas` y el CRM con Tailwind usan `globals.css`): `--bg`/`--color-marfil` = `--cj-tinta`; `--card`/`--color-blanco` = `--cj-sala`; `--text`/`--color-negro` = `--cj-hueso`; `--text-muted`/`--color-gris-texto` = `--cj-humo`; `--brand-texto`/`--color-dorado-oscuro` = `--cj-laton`; `--brand-orange`/`--color-dorado` = `--cj-dorado`; `--color-verde` = `--cj-verde`; `--brand-red`/`--color-rojo` = `--cj-borgona`; `--color-gris-borde` = `--cj-control`.

## Tipografía

| Rol | Familia | Tamaño | Clase |
|---|---|---|---|
| Título de página | Sitka (respaldo Source Serif 4, Georgia) | 30 a 46 px fluido | `.cj-titulo` |
| Título de sección | Sitka | 24 a 30 px fluido | `.cj-titulo--seccion` |
| Cifra | Sitka | 44 a 68 px (38 a 48 en `media`) | `.cj-cifra__valor` |
| Cuerpo | Source Serif 4 | **15 px en escritorio, 16 px en celular** | `.cj-raiz` |
| Tabla densa | Source Serif 4 | 14 px | `.cj-tabla` |
| Etiqueta | Source Serif 4 500 | 11 px escritorio / **12 px celular**, mayúscula | `.cj-etiqueta` |
| Barra inferior (celular) | 500 | 12 px, mayúscula, hasta 2 líneas | `.cj-tabbar span` |

**Piso en celular: nada por debajo de 12 px.** Campos de formulario a 16 px en celular (iOS no hace zoom).

## Reglas

- Estética sobria y mate (manual: autoridad, confianza, sobriedad). Prohibido: glow, bloom, brillos, degradados dorados, oro brillante como relleno grande.
- **El Oro Capital `#BE8F49` nunca va como texto sobre claro** (2,44:1 sobre marfil, 2,86:1 sobre blanco). Sobre claro el acento de texto es el latón `#805C29`.
- Vidrio: solo el del Hub (`components/ui/cristal.css`): blur 16 px, saturación 125 %, sin degradados dorados; con `prefers-reduced-transparency` vuelve a sólido. El texto blanco sobre fondos oscuros va en `#FFFDF8` sólido, no en `var(--cj-sala)`.
- Foco visible: outline latón 2 px; sobre barras oscuras, `#D0A45A`.
- Áreas táctiles en celular: botones y enlaces 44 px, chips 40 px.
- Breakpoints: 768 px (celular ↔ escritorio) y 1024 px. No sumar cortes nuevos sin motivo.
- Probar a 375 px que `scrollWidth == clientWidth` en `/`, `/ventas/closer/closer-1`, `/cuotas` y `/clientes` (los filtros `.fila-deslizable` ya desbordaron una vez).

## Contraste (WCAG 2.x)

Calculado con la fórmula de luminancia relativa, no a ojo. Mínimos: 4,5:1 texto, 3:1 elementos gráficos. Medido el 27/10/2026.

### Texto

| Par | Contraste | Resultado |
|---|---|---|
| Negro sobre Marfil / Blanco | 14,13 / 16,61 | Cumple |
| Humo sobre Marfil / Blanco | 5,96 / 7,00 | Cumple |
| Latón sobre Marfil / Blanco | 5,05 / 5,93 | Cumple |
| Ok sobre Marfil / Blanco | 5,35 / 6,29 | Cumple |
| Atención (ocre) sobre Marfil / Blanco | 5,46 / 6,42 | Cumple |
| Bordó sobre Marfil / Blanco | 8,19 / 9,63 | Cumple |
| Blanco sobre Bordó (botón) | 9,63 | Cumple |
| Marfil sobre Verde | 12,53 | Cumple |
| Humo claro `#CBBFA8` sobre Verde (tabbar) | 8,24 | Cumple |
| Oro Capital sobre Verde | 5,14 | Cumple |
| **Oro Capital sobre Marfil / Blanco** | **2,44 / 2,86** | **No cumple: nunca como texto** |

### Elementos gráficos

| Par | Contraste | Resultado |
|---|---|---|
| Borde de control sobre Marfil / Blanco | 3,43 / 4,03 | Cumple |
| Foco `#D0A45A` sobre Verde | 6,51 | Cumple |
| Ocre de atención (borde) sobre Marfil | 5,46 | Cumple |

### Filetes: decisión que se aparta del manual

Los filetes del manual (12% y 22% de Hueso) dan 1.3:1 y 1.8:1 sobre Tinta (1.39 y 1.86 sobre Sala). No llegan a 3:1, y no tienen que llegar mientras sean decorativos (separan filas y bloques, no identifican un control). Pero el borde de un campo o de un botón sí identifica al control, así que **los controles usan Humo de 1 px (`--cj-control`) y no el filete**. Los filetes quedan solo para separar.

## Componentes (`@/components/ui`)

Ninguno lleva `'use client'`: sirven en páginas de servidor y de cliente. Los que reciben eventos (`ChipFiltro`, `Boton`, `CampoBusqueda`) solo aceptan funciones desde un componente de cliente.

| Componente | Qué hace |
|---|---|
| `Etiqueta` | `{ tono?: 'humo' \| 'laton', como?: elemento }`. 11 px mayúscula. Latón solo para etiquetas de sección. |
| `Cifra` | Estilo expediente: `{ etiqueta, valor, contexto?, tamano?: 'grande' \| 'media' }`. Etiqueta latón, cifra Bodoni, contexto en humo con fecha o período. Es una lista de definición (`dl`). |
| `Filete` | `{ fuerte? }`. Un `hr` de 1 px. |
| `Tabla` | Densa y genérica: `{ descripcion, columnas, filas, claveFila, vacio? }`. Encabezados en etiqueta, números tabulares a la derecha (`numerica`), columnas de texto largo con `largo`. En móvil scrollea horizontal dentro de su contenedor (con foco por teclado) y las filas no se parten. Sin filas muestra `vacio` o un `Vacio` por defecto. |
| `ChipSemaforo` | `{ estado: 'verde' \| 'amarillo' \| 'rojo' \| 'gris', children? }`. Cuadradito sólido más palabra ("Al día", "Por vencer", "Vencido", "Sin fecha"); se puede pasar otra palabra. |
| `ChipFiltro` | Botón con `aria-pressed`: `{ activo, ...button }`. Activo = Hueso sobre Tinta. |
| `Boton`, `BotonEnlace` | Primario (Hueso sobre Tinta) y secundario (filete de control). `BotonEnlace` navega con `next/link`. Sin sombras. |
| `CampoBusqueda` | Solo borde inferior. `etiqueta` es para lectores de pantalla (no se ve). En móvil usa 16 px para que iOS no haga zoom. |
| `Vacio` | `{ frase, accion? }`: una frase y, si hay algo para hacer, una acción. |
| `SeccionTitulo` | `{ etiqueta, titulo, nivel?: 1 \| 2, acciones? }`. Etiqueta latón más título Bodoni; `h1` o `h2`. |

Clases utilitarias de `cj.css` para armar páginas: `.cj-pila` (columna con aire), `.cj-pila--chica`, `.cj-fila` (en línea con salto), `.cj-rejilla` (cifras), `.cj-panel` (superficie Sala), `.cj-aviso` (alerta Borgoña), `.cj-enlace` (enlace de etiqueta en latón), `.cj-texto-2`, `.cj-num`.

## Navegación y acceso

Navegación unificada (`components/shell/Navegacion.tsx`): barra lateral de 248 px en escritorio y barra superior fija y desplazable en móvil (hasta 768 px). Arriba el wordmark y, debajo, el nombre y el rol de la persona; secciones Resumen, Ventas, Clientes, Referidos, Finanzas y Anuncios (solo las que el rol puede ver); al pie, el botón "Salir" (formulario `POST` a `/api/auth/salir`, 40 px de alto, secundario: filete Humo sobre Tinta). En móvil la fila de arriba lleva wordmark, nombre con rol (el nombre se recorta con puntos suspensivos) y Salir, y las secciones quedan debajo. Con el usuario de prueba de desarrollo no se muestran ni el nombre ni Salir. Estado activo: filete latón a la izquierda (escritorio) o abajo (móvil), texto en Hueso, sin fondos. En desarrollo y con rol socio aparece también "Sistema", separado por un filete.

### Roles (BORRADOR a confirmar)

`lib/auth/roles.ts` tiene la matriz `puedeVer(rol, seccion)`:

| Rol | Ve |
|---|---|
| socio | todo (incluye Finanzas y Resumen) |
| closer | Ventas |
| setter | Ventas |
| csm | Clientes y Referidos |

La matriz rige para las páginas dentro de `app/(shell)` y, a través de la tabla de `lib/auth/rutas.ts`, también para `/` y sus rutas de datos. `/finanzas` y `/anuncios` viven fuera del shell y conservan su clave propia (ver `docs/ACCESO-Y-ROLES.md`, "Quién entra a cada ruta"). Desde Anuncios se vuelve con el enlace discreto "Volver al menú" (`components/shell/VolverAlMenu.tsx`), que aparece solo con sesión de Google.

### Sesión

El login real es con Google y está explicado en `docs/ACCESO-Y-ROLES.md` (flujo, variables de entorno, alta y baja de personas, rotación del secreto). Lo que importa para las páginas:

- `obtenerSesion()` (`lib/auth/sesion.ts`) lee la cookie `cj_sesion` firmada, la verifica y devuelve `{ id, email, nombre, rol, esDePrueba }`. La cookie solo prueba identidad: nombre y rol salen de `AUTH_USUARIOS` en cada petición. Sin cookie válida, en producción (incluidos los preview de Vercel) devuelve `null`: falla cerrado.
- Solo fuera de producción, sin sesión real y si `CRM_DEV_ROL` vale `socio`, `closer`, `csm` o `setter`, devuelve un usuario de prueba con ese rol. Sin la variable, o con otro valor, devuelve `null`.
- Ese usuario de prueba ve datos reales de clientes, así que tiene dos barreras contra el acceso desde otros equipos de la red: (1) `npm run dev` arranca con `-H 127.0.0.1` (Next escucha por defecto en `0.0.0.0`), y (2) `obtenerSesion()` solo lo entrega si el header `Host` es `localhost`, `127.0.0.1`, `[::1]` o `*.localhost` y, si hay `x-forwarded-host` (túnel o proxy), también es local (`lib/auth/hostLocal.ts`, con prueba en `scripts/test-auth.mjs`). El header lo puede falsear quien ya llegó al servidor: por eso la primera barrera es la que cuenta. No levantar el servidor con `-H 0.0.0.0` mientras `CRM_DEV_ROL` tenga un valor.
- `exigirAcceso(seccion)`: sin sesión redirige a `/entrar`; con sesión pero sin permiso, a la primera sección que el rol sí puede ver.

**Cada página nueva del shell tiene que llamar `await exigirAcceso('<seccion>')` al empezar, antes de leer datos.** El layout redirige sin sesión, pero un layout no se vuelve a ejecutar en cada navegación ni frena a las páginas hijas (guía de autenticación de Next), así que no alcanza como barrera. El layout además filtra la navegación según el rol.

`/entrar` vive en `app/entrar/`, **fuera** de `app/(shell)/`: si estuviera adentro, el layout del shell lo redirigiría a sí mismo en un loop. Comparte marca con el shell (importa `cj.css` y `fuentes.ts`). Una sola idea ("Entrá con tu cuenta de Google"), un botón primario que es un enlace común (no `next/link`, para que no se precargue la ruta que inicia el login) y los errores en `.cj-aviso`. El wordmark va sin enlace (`<Wordmark href={null} />`): no hay a dónde ir y así el primer Tab cae en el botón. Exporta `viewport` con `themeColor` Tinta y `colorScheme` oscuro, igual que el shell, para que la barra del celular no quede clara.

Cómo agregar una página: crear `app/(shell)/<ruta>/page.tsx`, llamar `exigirAcceso` y armar el contenido con `SeccionTitulo` y las primitivas.

## Qué del manual cumple cada decisión

| Regla del manual | Decisión |
|---|---|
| Paleta Tinta 70 / Sala 15 / Hueso 8 | Tokens `--cj-*`; fondo Tinta en viewport y overscroll; Sala solo en `.cj-panel`. |
| Latón mate y escaso | Solo etiquetas de sección, enlaces, foco y estado activo. Nunca como fondo grande. |
| Borgoña para alertas | Solo `.cj-aviso` (superficie) y su tinte claro para el semáforo rojo. |
| Humo para texto secundario | `--cj-texto-2`; pasa a Humo claro en Sala por contraste. |
| Bodoni solo títulos y cifras | `.cj-titulo` y `.cj-cifra__valor`; el resto es Archivo. |
| Etiquetas 10 a 12 px, mayúscula, tracking .16em | `.cj-etiqueta`: 11 px, .16em (latón .18em). |
| Cuerpo 15 px, tablas densas 14 px como mínimo | `.cj-raiz` 15 px; `.cj-tabla` 14 px. |
| Títulos 24 a 46 px, cifras 38 a 68 px | Escalas fluidas con `clamp()` dentro de esos rangos. |
| Filetes finos 12% y 22% | `--cj-filete` y `--cj-filete-fuerte`, solo decorativos. |
| Sin degradados, glow, sombras, blur, vidrio, relieve | Ninguna de esas propiedades en los archivos nuevos. |
| Radio 0 o 2 px | `--cj-radio: 0` en todo. |
| Sin naranja ni oro brillante | La paleta no tiene naranja; Latón es mate y de saturación baja. |
| Semáforo sin emojis | Cuadradito sólido más palabra; colores derivados de la paleta y contraste calculado. |
| Aire, una idea por bloque, dos jerarquías | `.cj-pila` con 64 px; `SeccionTitulo` es etiqueta más título. `Cifra` sigue el formato expediente que pide el manual (etiqueta, cifra y un contexto corto). |
| Cifras estilo expediente | Componente `Cifra`: etiqueta latón, cifra Bodoni, contexto humo con período. |
| Solo tema oscuro | `color-scheme: dark`; no hay tema claro. |
| Wordmark de texto, sin inventar logo | `Wordmark` en Archivo mayúscula. |

## Pendientes

- Las fuentes Geist de la raíz siguen declarándose en todas las páginas aunque el shell no las use.
- Los dos tintes del semáforo no están en el manual (solo define los seis colores): son derivados de Sala y Borgoña y habría que confirmarlos con quien lleva la marca.
- El manual nombra la marca "Skyward Jurídica"; el dashboard muestra "Capital Jurídico" por pedido. Confirmar el nombre visible cuando se defina el logo.
- Confirmar con el usuario la matriz de roles (en particular si Resumen es solo para socio).
- Decidir cuándo migrar `/`, `/finanzas` y `/anuncios` al grupo `(shell)` (con `git mv`, sin tocar el contenido, para conservar historia). Con el login real ya activo, `/` pide sesión de Google en el proxy (solo socio), pero sigue siendo el dashboard viejo: sin barra lateral, sin "Salir" y sin vuelta al menú (el socio aterriza ahí). Finanzas muestra su login viejo (naranja, resplandor, tarjeta redondeada) y su clave propia, y Anuncios pide otra clave; solo Anuncios tiene "Volver al menú". Las alternativas para `/` y `/finanzas` sin editar el dashboard viejo están en `docs/ACCESO-Y-ROLES.md` (Pendientes).
- Tabla de Clientes: tiene 8 columnas y necesita unos 880 px de ancho útil, o sea una ventana de unos 1255 px o más (entra en 1280, 1366 y 1440). Por debajo, hasta los 768 px donde pasa a tarjetas, scrollea horizontal dentro de su contenedor y se pierden las últimas columnas sin ninguna pista. Decidir si el corte a tarjetas sube a unos 1260 px (tablets en horizontal incluidas), o si se quitan o apilan columnas en anchos medios.
