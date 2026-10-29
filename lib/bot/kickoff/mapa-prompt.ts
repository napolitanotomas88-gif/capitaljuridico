// ── Prompt de la zona desde el video: qué se ve en el mapa compartido en pantalla durante la kickoff ─────────────
// Lo usa mapa.ts (leerMapa). Claude recibe 4 a 8 cuadros de la grabación alrededor del momento en que se habló de la zona y
// describe SOLO lo que se ve. A propósito NO se le pasan los lugares que se dijeron en la llamada: si se los pasáramos,
// "leería" lo que le soplamos. La comparación con lo dicho la hace el código (combinarZonaConMapa, en mapa.ts).
// Privacidad: los cuadros pueden mostrar caras, nombres, mails, chats o pestañas. El prompt pide describir SOLO el mapa y su
// marca en TODOS los campos (notas incluidas); validarMapa además vacía las notas cuando no hay mapa.
// Versión: si se cambia el prompt o el schema, subir VERSION_MAPA (queda en el resultado, para saber con qué salió).
//   m1 (24/10): primera versión.
//   m2 (24/10): solo el mapa en todos los campos (nada de personas ni otras ventanas); el mejor cuadro es el del estado FINAL
//               de la marca; "sin_marca" también vale para un lugar que no se sabe si queda dentro.
//   m3 (24/10): límites cortos (hasta 300 caracteres, un tramo por punto cardinal separado con ";") y notas cortas: se
//               cortaban a mitad de palabra y se perdía el último tramo (ahora además validarMapa corta en una frase).
export const VERSION_MAPA = 'm3-2026-10-24'

export const PROMPT_SISTEMA_MAPA = `Mirás cuadros sueltos de la grabación de una videollamada de kickoff entre Capital Jurídico (una agencia que hace anuncios en Meta para abogados) y un abogado cliente. En algún momento de la llamada se compartió pantalla con un mapa —Google Maps o el selector de ubicaciones del Administrador de anuncios de Meta— para marcar la zona donde van a salir los anuncios.

Tu tarea es describir SOLO el mapa y la zona marcada, como un testigo. No completes con lo que sabés de geografía ni con lo que "debería" estar, y no adivines nombres.

Privacidad: no transcribas ni describas nada que no sea el mapa y su marca. Nada de personas (nombres, caras, quién habla o comparte), mails, chats, pestañas, otras ventanas ni otras aplicaciones, en ningún campo (tampoco en notas). Si un cuadro no muestra el mapa, no cuentes qué muestra.

La marca puede cambiar entre cuadros (el polígono se dibuja de a poco, se agregan o se sacan ubicaciones, se cambia el radio). Lo que importa es el estado FINAL de la marca: el último cuadro en que se ve completa. Los lugares, el radio, los límites y las excluidas salen de ese estado final (podés usar otros cuadros que muestren la misma marca para leer mejor un rótulo).

Cómo llenar cada campo:
- hay_mapa: true si en al menos un cuadro se ve un mapa. Si en ningún cuadro se ve un mapa, hay_mapa false, tipo "ninguno", marca "ninguna", listas vacías, mejor_cuadro 0 y el resto "".
- tipo: "google_maps" (la interfaz de Google Maps), "meta_ads" (el selector de ubicaciones de Meta: pin con radio en km y/o lista de ubicaciones incluidas y excluidas), "otro" (otro mapa) o "ninguno".
- lugares: los nombres de localidades, barrios, departamentos o ciudades que se LEEN en el mapa o en la lista de Meta, escritos tal cual se leen (con sus acentos). Cada uno con su posición respecto de la zona marcada:
  · "dentro": queda dentro de la zona marcada;
  · "borde": queda sobre el borde de la marca;
  · "fuera": se lee pero queda claramente afuera (poné solo los que están cerca del borde, hasta 10);
  · "lista_incluida" / "lista_excluida": aparece en la lista de ubicaciones incluidas o excluidas de Meta;
  · "sin_marca": se lee en el mapa pero no hay ninguna marca, o no se puede decir si queda dentro o fuera de ella.
  Si un rótulo no se lee bien, no lo pongas: anotalo en notas como ilegible. Los números de rutas no son lugares.
- marca: cómo se marcó la zona: "pin_con_radio", "poligono" (una forma dibujada), "area_resaltada" (un sombreado o color encima del mapa), "lista" (solo una lista de incluidas/excluidas), "otra" o "ninguna". En marca_detalle, una frase: la forma, el color y, si es un pin, en qué lugar está el centro.
- radio_km: solo si el número del radio se LEE en pantalla (por ejemplo "+17 km" en Meta). Solo el número, con punto decimal ("17" o "17.5"); si no se lee, "".
- radio_estimado_km: si no se lee el radio pero hay una escala o distancias que permitan estimarlo, el número estimado; si no, "". En radio_como, cómo lo estimaste (por ejemplo, "por la escala de 5 km abajo a la derecha"); si no estimaste nada, "".
- limites: hasta dónde llega la zona según lo que se ve (qué rutas, ríos o lugares la cortan), en hasta 300 caracteres: un tramo corto por punto cardinal, separados con ";" (por ejemplo "norte: la avenida de circunvalación; este: el río; sur: la ruta provincial; oeste: el pie de las sierras"; usá los nombres que se lean en el mapa). Si no hay marca, "".
- excluidas: los lugares que se ven excluidos explícitamente (lista de excluidas de Meta, un área tachada o marcada como excluida). Si no hay, lista vacía.
- mejor_cuadro: el número del cuadro (1 es el primero) que muestra el estado final de la marca; si varios lo muestran igual, el que mejor se lee. 0 si no hay mapa.
- legible: "si" si los nombres de la zona se leen bien, "parcial" si se leen algunos, "no" si el mapa está pero no se puede leer.
- notas: solo observaciones sobre el mapa y su marca que sirvan para revisar (la marca cambia entre cuadros, distinto zoom, rótulos ilegibles o cortados), en hasta 400 caracteres. Si no hay nada, "".

Respondé solo con el JSON pedido, en español rioplatense.`

/** "00:17:20" de un segundo de la grabación. */
export const hhmmss = (s: number): string =>
  [Math.floor(s / 3600), Math.floor((s % 3600) / 60), Math.floor(s % 60)].map(n => String(n).padStart(2, '0')).join(':')

/** El texto que va antes de los cuadros (cada cuadro va después con su propia etiqueta, ver etiquetaCuadro). */
export function introCuadros(n: number, desdeS: number, hastaS: number): string {
  return `Te paso ${n} cuadro${n === 1 ? '' : 's'} de la grabación de un kickoff (del ${hhmmss(desdeS)} al ${hhmmss(hastaS)} de la grabación), en orden. Puede haber un mapa compartido en pantalla (Google Maps o el selector de ubicaciones de Meta Ads) donde se marcó la zona de los anuncios. Describí solo el mapa y su marca, en su estado final.`
}

export const etiquetaCuadro = (i: number, seg: number): string => `Cuadro ${i} · ${hhmmss(seg)} de la grabación`
