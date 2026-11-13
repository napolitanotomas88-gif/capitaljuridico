# DESIGN.md · Despacho de Capital Jurídico

Dirección de diseño para quien toque la interfaz, persona o agente. Es corta a propósito: si algo no está acá, se decide con
las ideas de la sección 1. El detalle técnico (archivos, contrastes medidos, historia) está en `docs/DISENO-CAPITAL-JURIDICO.md`.

## 1. Identidad

- **Quién lo usa:** el equipo de Capital Jurídico, todo el día, para llevar clientes abogados. Es una herramienta de trabajo, no una vidriera.
- **Personalidad:** autoridad, confianza, logro. Firme y profesional, sin estridencias. Ante la duda, legibilidad y sobriedad.
- **Material:** verde Toga oscuro de fondo, el imagotipo grande en oro mate detrás, superficies con una luz única que viene de arriba (un degradado leve y un filete claro en el borde superior), texto marfil y oro mate como acento.
- **Prueba:** si se cambia el logo por otro, la pantalla tiene que seguir pareciendo de un estudio serio, no una plantilla.

## 2. Paleta (manual de marca)

| Color | Valor | Uso |
|---|---|---|
| Verde Toga | `#012D25` (fondo del Despacho `#05291F`) | Fondo institucional. Base de todo el tema oscuro. |
| Oro Capital | `#BE8F49` | Logo, filetes, íconos activos, interruptores. Siempre **mate y plano**. |
| Oro de texto | `#EED6A8` | Oro cuando es texto sobre verde (el `#BE8F49` no llega a 4,5:1). |
| Marfil | `#F2EADC` / texto `#FBF8F2` | Texto principal sobre oscuro; relleno del botón principal. |
| Humo | `#E3DAC8` | Texto secundario. Placeholder: `#D3C9B6`. |
| Bordó | `#7F202C` | Llamados a la acción de marca (`.cj-boton--marca`). Sobre verde, el rojo de estado es `#F0B1B8`. |
| Negro Tinta | `#1D1D1B` | Texto sobre rellenos claros (oro, marfil, verdes de estado). |
| Estados | ok `#9FDCC0`, atención `#ECCA8F`, error `#F0B1B8` | Solo para estado. Nunca de adorno. |

**Color por etapa del Recorrido** (`rc-e--<etapa>` en `recorrido.css`): cada etapa tiene su tono mate y es **información**, no
decoración. Se queda. Las etapas no elegidas se apagan con color (mezcla del tono con verde oscuro), nunca con `opacity`.

Tokens: los colores viven en `:root` de `app/(shell)/cj.css` (paleta clara, la de impresión) y se redefinen para el tema real en
`:root:has(.cj-cristal)` de `components/shell/cristal.css`. Los blancos translúcidos repetidos tienen token:
`--cjc-blanco-5/8/12/16/24/30`. No agregar `rgba()` sueltos si uno de esos sirve.

## 3. Tipografía (tal como está: no se cambia)

- **Títulos y cifras grandes:** serifa de la marca, `--cj-fuente-titulo` (Sitka; donde no está, Source Serif 4 propia; después Georgia).
- **Texto, tablas y controles:** sans del sistema, `--cjc-sans` (SF Pro, Segoe UI, Roboto…).
- Cifras y montos en negrita, con `tabular-nums`. Nada por debajo de 12 px.
- Escala de letra (`--cj-letra-*` en `cj.css`): **12 · 13 · 14 · 15 · 17 · 20 · 24 · 30**. Cuerpo 15; tabla densa 14; rótulos 12;
  título de sección 24 a 30; título de página 30 a 46; cifra destacada 44 a 68.
- En escritorio el contenido lleva `zoom: 1.1` (pedido de Tomás, 13/11/2026). No compensarlo achicando letras.

## 4. Espacio, radios y sombras

- Escala de espacio (`--cj-esp-1` a `--cj-esp-7`): **4 · 8 · 12 · 16 · 24 · 32 · 48**. Todo valor nuevo sale de ahí.
- Radios: controles 10–12, tarjetas 18, paneles grandes 22, píldora 999 (solo chips y botones redondos).
- Sombra: una sola, en reposo (`--cj-sombra-1`). Las tarjetas no se elevan al pasar el cursor.
- Área de toque mínima: 44 px.

## 5. Vidrio solo en lo que flota

- **Con `backdrop-filter`:** barra lateral, barra de pestañas del celular, pestañas del Hub, hoja «Más», menú rápido, menú de
  portales, panel de la tarjeta del cliente y su velo, velo de los diálogos. Nada más.
- **Sólido** (`--cjc-panel`: la misma luz de arriba sobre `--cjc-panel-liso`): todo lo que está en el flujo de la página
  (`.cj-panel`, `.cj-bloque`, `.cj-dato`, `.cj-ficha-seccion`, `.cj-vacio`, columnas y tramos del Recorrido, `.card`,
  `.glass-*`, tarjetas de Anuncios, encabezados pegajosos). Una superficie con texto siempre tiene base oscura debajo.
- **Fondo:** verde casi plano con una sola luz suave arriba y el logo en oro plano a baja opacidad. Sin grano, sin manchas de
  colores, sin `background-attachment: fixed`, sin `filter: blur` en vivo.
- Con «reducir transparencia» del sistema, todo sólido. Con «reducir movimiento», sin transiciones ni animaciones de entrada.

## 6. Tono de los textos

Español rioplatense formal, con voseo. Concreto: qué pasa y qué hacer («Leyendo la ficha…», «¿Quitarle el acceso a X?»). Sin
palabras de moda, sin signos de exclamación de adorno, sin emojis en títulos ni botones. Rayas largas solo para celda vacía.

## 7. Qué NO hacer

La lista de 20 (auditoría del 13/11/2026), aplicada al Despacho:

1. Degradados violeta o azul, o cualquier color fuera de la paleta.
2. Títulos con degradado (`background-clip: text`).
3. Emojis en títulos, botones o etiquetas: ícono de `components/shell/iconos.tsx` o solo texto.
4. Cambiar la tipografía (ni Inter, ni Geist, ni volver el texto a serifa).
5. Franjas de color en el borde de tarjetas como adorno: solo si indican estado o etapa.
6. Desenfoque en superficies del flujo de la página (ver sección 5).
7. Texto bajo 4,5:1 (3:1 para elementos gráficos). Calcularlo sobre el peor punto del fondo, en los dos modos.
8. Filas de tres cajas con ícono cuando el rótulo alcanza.
9. Pastilla en mayúsculas arriba de cada título que repite el título.
10. Íconos genéricos de librería: se usan los propios.
11. Componentes de librería sin adaptar a la marca.
12. Fundidos al hacer scroll; entradas con desenfoque o escala.
13. Haces o destellos que siguen o barren con el cursor; lupas tipo dock.
14. Botones cuyo único cambio al pasar es la opacidad: cambio de fondo o de borde.
15. Separaciones, tamaños, radios o sombras fuera de las escalas de la sección 4.
16. Rayas largas en prosa y «·» como relleno (máximo uno por línea).
17. Texto de palabras de moda.
18. Itálica de adorno.
19. Combinaciones tipográficas de moda (Space Grotesk, Instrument Serif…).
20. Grano o ruido sobre degradados.

Y además (anti-slop):

- Nada de glow, bloom, brillos dorados ni oro con degradado: el oro es plano y mate.
- Nada de elevación, escala ni inclinación al pasar sobre algo que no se puede tocar.
- Nada de `window.confirm` nativo para acciones destructivas.
- Nada de quitar el foco sin reemplazo visible (`outline` en oro de texto `#EED6A8`).
- Nada de datos inventados en pantallas de ejemplo que parezcan reales, ni datos de clientes en el repo (es público).
- Antes de dar algo por terminado: ¿funciona con teclado, en el celular (400 px), en modo normal y nocturno, vacío y con error?
