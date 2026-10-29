// ── Catálogo de recursos creativos para los guiones (diversidad creativa) ────────────────────────
// Pedido de Tomás (24/10/2026): los guiones de los clientes son casi todos el abogado quieto hablando a cámara; tiene que ir
// jugando con recursos (pizarra, carta documento en mano, caminar, actuar, cambiar de plano…). Versión compacta del catálogo
// completo `.cache/guiones/investigacion/catalogo-formatos.md` (20 recursos, con fuentes: bóveda, Hormozi, el contenido propio
// de Skyward y los 121 docs de guiones de clientes), que también es la base del módulo de Skool «Diversidad creativa al
// grabar». Va al prompt del redactor (catalogoEnTexto) y el revisor mecánico usa nombre y dificultad.
// Dificultad: 1 = lo hace solo en su escritorio · 2 = necesita preparar algo · 3 = necesita ayudante o locación.
// Datos de patrón (contenido de Skyward, NO anuncios de clientes; nota no contrastada con el CRM): la pizarra fue el formato
// con mejor cierre en VSL; la actuación retuvo mucho y cerró poco (por eso, como mucho una por tanda y corta).
// BORRADOR: falta que Tomás lo apruebe. Cuando cambie, subir VERSION_FORMATOS.
import type { Catalogo } from './tipos'

export const VERSION_FORMATOS = 'f1-2026-10-24'

export interface Formato {
  clave: string
  nombre: string
  dificultad: 1 | 2 | 3
  que_es: string
  como: { HOOK: string; PROBLEMA: string; SOLUCION: string; CTA: string }
  utileria: string
  encaja: string                  // dónde rinde (laboral primero)
  errores: string
  grupo: 'explicacion' | 'papel' | 'movimiento' | 'celular' | 'historia' | 'objeto' | 'otro'
}

export const FORMATOS: Formato[] = [
  {
    clave: 'pizarra', nombre: 'Pizarra', dificultad: 2, grupo: 'explicacion',
    que_es: 'Escribe o dibuja la idea mientras la explica (pizarra chica, atril u hoja A3 sobre el escritorio, que la vuelve dificultad 1).',
    como: {
      HOOK: 'Plano medio largo, parado al lado de la pizarra que ya tiene el título escrito grande; señala el título con el fibrón tapado.',
      PROBLEMA: 'Escribe una palabra por idea, de costado (nunca de espaldas), y vuelve a mirar a cámara para cada consecuencia.',
      SOLUCION: 'Numera los puntos y encierra la palabra clave; se acerca a la pizarra para pasar a un plano más cerrado.',
      CTA: 'Tapa el fibrón, lo deja y da un paso hacia el lente: soltar el marcador avisa el cierre.',
    },
    utileria: 'Pizarra o block grande, dos fibrones gruesos, borrador.',
    encaja: 'Qué mirar antes de firmar, de qué se compone una liquidación (sin montos), listas de señales.',
    errores: 'Letra chica, hablarle a la pizarra, frases enteras, escribir montos o plazos, llenarla antes de empezar.',
  },
  {
    clave: 'documento', nombre: 'Documento protagonista', dificultad: 1, grupo: 'papel',
    que_es: 'El papel que la persona tiene en su casa (telegrama, carta documento, recibo, liquidación) es el centro del video. Siempre un MODELO sin datos reales.',
    como: {
      HOOK: 'Acerca el papel al lente hasta que se lea solo la palabra clave (TELEGRAMA, RECIBO) y lo baja de golpe para mirar a cámara.',
      PROBLEMA: 'Lo apoya en el escritorio y lo toca con un dedo al nombrar cada cosa que pasó.',
      SOLUCION: 'Cambia de plano (detalle del papel u otro rincón) y señala lo que hay que mirar, sin cifras.',
      CTA: 'Lo deja a un costado, se inclina hacia el lente y hace el gesto hacia abajo.',
    },
    utileria: 'Modelo en blanco o de ejemplo, con MODELO escrito si hace falta.',
    encaja: 'Telegrama de despido, liquidación, recibo en gris, carta documento.',
    errores: 'Documento real con datos, moverlo tanto que no se lee, taparse la cara, usarlo solo en el HOOK.',
  },
  {
    clave: 'entrada_cuadro', nombre: 'Entrada a cuadro (caminar hacia la cámara)', dificultad: 2, grupo: 'movimiento',
    que_es: 'Celular fijo lejos; el abogado entra caminando, frena en una marca y recién ahí habla.',
    como: {
      HOOK: 'Plano general: entra desde un costado con paso decidido, frena en la marca del piso (ya en plano medio) y habla.',
      PROBLEMA: 'Se sienta en el escritorio que está en el cuadro, o corte a una toma sentado.',
      SOLUCION: 'Se acerca dos pasos al lente o pasa a un plano más cerrado.',
      CTA: 'Un último paso hacia la cámara y el gesto hacia abajo.',
    },
    utileria: 'Trípode, cinta para marcar el piso, micrófono corbatero.',
    encaja: 'Tono firme o de alerta: despido de palabra, te mintieron.',
    errores: 'Hablar lejos del micrófono, entrar fuera de foco, frenar con la cabeza cortada, caminar lento.',
  },
  {
    clave: 'actuar_empleador', nombre: 'Actuar al empleador (un abogado, dos personajes)', dificultad: 2, grupo: 'historia',
    que_es: 'Dice la frase típica del jefe en personaje (saco abierto, carpeta, de costado) y vuelve a ser él mismo para responderla. Corta, en el HOOK.',
    como: {
      HOOK: 'De costado, como el jefe, hablándole frío a alguien fuera de cuadro; sin cortar, gira al lente, cierra el saco y ya es el abogado.',
      PROBLEMA: 'Como abogado, sentado; puede volver una vez al personaje para otra frase.',
      SOLUCION: 'Otro rincón u otro plano, ya sin personaje.',
      CTA: 'Hacia la cámara, con el gesto hacia abajo.',
    },
    utileria: 'Un saco, una carpeta o unos lentes: algo que se ponga y se saque.',
    encaja: 'La frase que escuchó la persona: firmá acá, mañana no hace falta que vengas, es lo que corresponde por ley.',
    errores: 'Sobreactuar, escena larga, más de una actuación por tanda, que no se entienda cuándo habla el abogado.',
  },
  {
    clave: 'leer_celular', nombre: 'Leer una pregunta del celular', dificultad: 1, grupo: 'celular',
    que_es: 'Lee en voz alta, desde el celular, una pregunta real que le hicieron (sin datos de quién) y después levanta la vista y responde.',
    como: {
      HOOK: 'Sentado, mirando el celular; lee despacio y en la última palabra levanta la vista al lente.',
      PROBLEMA: 'Deja el celular boca abajo y responde como en una consulta.',
      SOLUCION: 'Cambio de plano; cuenta con los dedos lo que se analiza.',
      CTA: 'Vuelve a levantar el celular (a vos también te pueden escribir) y hace el gesto hacia abajo.',
    },
    utileria: 'Un segundo celular o la funda sola.',
    encaja: 'Dudas frecuentes: ¿me corresponde algo si…?, ¿firmo?',
    errores: 'Inventar la pregunta, leer de corrido sin mirar a cámara, mostrar la pantalla real.',
  },
  {
    clave: 'mostrar_pantalla', nombre: 'Mostrar la pantalla al lente', dificultad: 2, grupo: 'celular',
    que_es: 'Pega el celular al lente para mostrar un chat, un mail o la foto de un recibo armados de ejemplo.',
    como: {
      HOOK: 'Celular pegado al lente un par de segundos con el chat de ejemplo; lo baja y mira a cámara.',
      PROBLEMA: 'Sin celular, a cámara.',
      SOLUCION: 'Lo vuelve a levantar para señalar lo que importa.',
      CTA: 'Lo guarda y hace el gesto hacia abajo.',
    },
    utileria: 'Celular con una captura de ejemplo, brillo alto, sin notificaciones.',
    encaja: 'Despido por WhatsApp, te sacaron del grupo del trabajo, transferencias del sueldo en negro (las pruebas están en tu celular).',
    errores: 'Reflejo, datos reales, modo oscuro que no se lee, dejarla poco tiempo.',
  },
  {
    clave: 'objeto_simbolo', nombre: 'Objeto que simboliza', dificultad: 1, grupo: 'objeto',
    que_es: 'Un objeto común como metáfora: la hoja en blanco (así figurás si no te registraron), el cronómetro (el plazo corre), la calculadora (el número que te quieren hacer firmar), el sobre (lo que te pagaban en mano), el calendario tachado.',
    como: {
      HOOK: 'El objeto aparece en silencio uno o dos segundos y después habla.',
      PROBLEMA: 'El objeto queda a la vista (el cronómetro sigue corriendo en el escritorio).',
      SOLUCION: 'Le hace algo al objeto: escribe en la hoja, frena el cronómetro, tacha el calendario.',
      CTA: 'Lo deja o lo toca por última vez y hace el gesto hacia abajo.',
    },
    utileria: 'La del objeto elegido (el celular sirve de cronómetro o calculadora).',
    encaja: 'Sueldo en gris, liquidación, el tiempo que pasa.',
    errores: 'Objeto sin relación con lo que se dice, olvidarlo en el resto del video, mostrar números de plazos o montos.',
  },
  {
    clave: 'cambio_toma', nombre: 'Cambio de toma por sección', dificultad: 2, grupo: 'movimiento',
    que_es: 'Cada sección en un rincón, plano o postura distinta (puerta, escritorio, biblioteca, primer plano). Es la base para un guion sin otro recurso fuerte.',
    como: {
      HOOK: 'Parado junto a la puerta o entrando, como quien recibe a alguien apurado.',
      PROBLEMA: 'Sentado en el escritorio.',
      SOLUCION: 'De pie frente a la biblioteca, en un plano más cerrado.',
      CTA: 'Primer plano, cerca del lente.',
    },
    utileria: 'Trípode y cinta para marcar dónde va en cada rincón.',
    encaja: 'Cualquier tema.',
    errores: 'Cambiar diez grados y llamarlo cambio de toma, rincones con luz muy distinta, fondos desordenados.',
  },
  {
    clave: 'pov', nombre: 'Plano subjetivo (la cámara es el cliente)', dificultad: 2, grupo: 'otro',
    que_es: 'El celular ocupa los ojos de quien consulta, del otro lado del escritorio; el abogado le habla como en una consulta y le acerca papeles.',
    como: {
      HOOK: 'Inclinado hacia el lente, le desliza una hoja a la cámara.',
      PROBLEMA: 'Le habla a la persona con la mirada en el lente, como respondiendo lo que le acaba de contar.',
      SOLUCION: 'Gira la hoja para que la lea y señala con la lapicera.',
      CTA: 'Se recuesta en la silla, mira fijo y hace el gesto hacia abajo.',
    },
    utileria: 'Escritorio, hojas, lapicera; marca de cinta para saber dónde mirar.',
    encaja: 'Primera consulta: lo que me contaste, qué te voy a preguntar.',
    errores: 'Mirar la pantalla en vez del lente, celular bajo (plano papada).',
  },
  {
    clave: 'tarjetas', nombre: 'Tarjetas que se pasan (lista visual)', dificultad: 2, grupo: 'explicacion',
    que_es: 'Un mazo de hojas con una palabra cada una (la ciudad, 3 SEÑALES, 1, 2, 3, ESCRIBIME) que va pasando mientras habla.',
    como: {
      HOOK: 'Muestra la primera (la ciudad o el tema) y la pasa a la segunda.',
      PROBLEMA: 'Una tarjeta por señal; la apoya después de decirla.',
      SOLUCION: 'Una tarjeta con la palabra clave del reencuadre.',
      CTA: 'La última dice ESCRIBIME con una flecha hacia abajo, y hace el gesto.',
    },
    utileria: 'Hojas A4 o cartulinas y fibrón grueso.',
    encaja: 'Tres señales de que te empujan a renunciar, tres cosas que no figuran en tu recibo.',
    errores: 'Mucho texto por tarjeta, taparse la cara, más de cinco tarjetas, letra fina.',
  },
  {
    clave: 'mito_verdad', nombre: 'Mito o verdad', dificultad: 1, grupo: 'explicacion',
    que_es: 'Lee una creencia común y la responde levantando un cartel de MITO o de VERDAD.',
    como: {
      HOOK: 'Una hoja en cada mano; dice la frase y levanta MITO bien alto.',
      PROBLEMA: 'Deja las hojas y explica por qué la gente se la cree y quién gana con eso.',
      SOLUCION: 'Cambio de plano y el reencuadre.',
      CTA: 'Puede cerrar con VERDAD en una segunda frase y el gesto hacia abajo.',
    },
    utileria: 'Dos hojas escritas.',
    encaja: 'Firmaste y ya no podés reclamar, si renunciás no te corresponde nada.',
    errores: 'Que la verdad sea una promesa, una frase que nadie cree, encadenar varios mitos.',
  },
  {
    clave: 'firma_suspenso', nombre: 'Firma en suspenso', dificultad: 1, grupo: 'papel',
    que_es: 'Una lapicera a punto de firmar un papel (ACUERDO, RENUNCIA) y la mano del abogado que la frena.',
    como: {
      HOOK: 'Primera toma en plano detalle de la mesa con la hoja y la lapicera; su mano entra y la aparta. Segunda toma, plano medio a cámara.',
      PROBLEMA: 'Sentado, con el papel sin firmar a la vista.',
      SOLUCION: 'Da vuelta la hoja o la pone al lado del recibo y señala lo que hay que revisar.',
      CTA: 'Guarda la lapicera en el bolsillo y hace el gesto hacia abajo.',
    },
    utileria: 'Hoja de ejemplo y lapicera.',
    encaja: 'Acuerdo, liquidación, renuncia, retiro voluntario.',
    errores: 'Que se lea un documento real, la mano tapa el papel, detalle fuera de foco.',
  },
  {
    clave: 'caso_carpeta', nombre: 'Caso en carpeta (historia anónima)', dificultad: 1, grupo: 'historia',
    que_es: 'Cuenta un caso real y anónimo suyo con una carpeta cerrada en la mano; la abre en la solución.',
    como: {
      HOOK: 'Sentado, la mano sobre la carpeta cerrada, la voz un poco más baja.',
      PROBLEMA: 'Cómo llegó la persona, sin datos que permitan reconocerla.',
      SOLUCION: 'Abre la carpeta (sin que se vean las hojas) y cuenta qué cambió.',
      CTA: 'Cierra la carpeta y hace el gesto hacia abajo.',
    },
    utileria: 'Una carpeta sin nombres a la vista.',
    encaja: 'Cuando un caso desarma una creencia (firmé y pensé que no podía reclamar).',
    errores: 'Inventar el caso, dar montos del resultado, detalles que identifiquen al cliente, prometer lo mismo.',
  },
  {
    clave: 'reaccion_titular', nombre: 'Reacción a un titular', dificultad: 2, grupo: 'celular',
    que_es: 'Lee un titular real y actual (celular o diario) y aclara qué cambia para quien mira.',
    como: {
      HOOK: 'Leyendo el titular (en edición va en pantalla); levanta la vista con cara seria.',
      PROBLEMA: 'Aclara lo que la gente entendió mal.',
      SOLUCION: 'Otro plano y qué hay que mirar en tu caso.',
      CTA: 'Gesto hacia abajo.',
    },
    utileria: 'La captura o el diario.',
    encaja: 'Despidos o cierres conocidos en la zona, cambios en las leyes laborales. La noticia tiene que ser real y verificada.',
    errores: 'Inventar o exagerar el titular, noticia vieja, opinar de causas en trámite, cifras de la ley, atacar personas.',
  },
  {
    clave: 'selfie_urgencia', nombre: 'Selfie de urgencia', dificultad: 2, grupo: 'movimiento',
    que_es: 'Se graba en selfie al paso, caminando, como un aviso urgente. Única excepción de cámara frontal, solo en el HOOK.',
    como: {
      HOOK: 'Frontal a la altura de los ojos, caminando por el pasillo o la vereda; frena y habla como quien le avisa algo a un amigo.',
      PROBLEMA: 'Corte a cámara trasera, en el escritorio.',
      SOLUCION: 'Otro rincón u otro recurso.',
      CTA: 'Gesto hacia abajo.',
    },
    utileria: 'Micrófono; un celular con buena cámara frontal.',
    encaja: 'Alertas: te despidieron hoy, no firmes nada todavía.',
    errores: 'Todo el video en selfie, plano papada, ruido de la calle, imagen temblando al hablar.',
  },
  {
    clave: 'cenital_manos', nombre: 'Cenital de manos y voz', dificultad: 2, grupo: 'objeto',
    que_es: 'El celular mira el escritorio desde arriba: se ven las manos separando recibos o escribiendo, con la voz por encima. La cara aparece en la solución.',
    como: {
      HOOK: 'Las manos desparraman recibos de ejemplo y separan el que no cierra.',
      PROBLEMA: 'Sigue en cenital, separando lo que no figura.',
      SOLUCION: 'Corte a plano medio, con la cara.',
      CTA: 'Plano medio y gesto hacia abajo.',
    },
    utileria: 'Soporte cenital (o el celular entre dos pilas de libros), recibos de ejemplo.',
    encaja: 'Sueldo en gris, recibos, papeles de la liquidación.',
    errores: 'Sombra sobre la mesa, que se lean datos, todo el video sin cara.',
  },
  {
    clave: 'contraste', nombre: 'Contraste en dos tomas', dificultad: 2, grupo: 'historia',
    que_es: 'Dos escenas cortas con dos caminos (el que firmó y el que preguntó antes), distinto lado del cuadro, postura o ropa. Se presenta como «imaginá».',
    como: {
      HOOK: 'Primera toma de pie a la izquierda con el papel firmado y cara de resignado; segunda sentado a la derecha con el papel sin firmar. Habla en la segunda.',
      PROBLEMA: 'Lo que le pasa al primero.',
      SOLUCION: 'Lo que hizo el segundo, sin contar cómo.',
      CTA: 'A cámara y gesto hacia abajo.',
    },
    utileria: 'El mismo papel en las dos tomas y un cambio de ropa o postura.',
    encaja: 'Firmar o consultar antes.',
    errores: 'Que no se entienda que son dos situaciones, presentarlo como caso real, prometer el resultado.',
  },
  {
    clave: 'pregunta_off', nombre: 'Alguien pregunta fuera de cuadro', dificultad: 3, grupo: 'otro',
    que_es: 'Alguien del equipo, fuera de cuadro, hace la pregunta en voz alta y el abogado responde a cámara. Plan B sin ayudante: leer la pregunta del celular.',
    como: {
      HOOK: 'Escucha la pregunta mirando a quien la hace y gira al lente para responder.',
      PROBLEMA: 'Puede entrar una segunda pregunta corta.',
      SOLUCION: 'Plano más cerrado.',
      CTA: 'Gesto hacia abajo.',
    },
    utileria: 'Un ayudante y, si se puede, un segundo micrófono.',
    encaja: 'Objeciones: ¿y si ya firmé?, ¿y si no tengo todos los recibos?',
    errores: 'Que la pregunta no se escuche, que el ayudante entre al cuadro, preguntas que suenan leídas.',
  },
  {
    clave: 'locacion_local', nombre: 'Locación con rubro local', dificultad: 3, grupo: 'movimiento',
    que_es: 'El HOOK se graba en un lugar que la gente de la zona reconoce (una zona de comercios, un parque industrial, una obra), sin carteles de empresas. El resto, en el estudio. Plan B: entrada a cuadro en el estudio.',
    como: {
      HOOK: 'Plano general en el lugar; da dos pasos hacia la cámara y frena en plano medio.',
      PROBLEMA: 'En el estudio, con el resto de la tanda.',
      SOLUCION: 'En el estudio, otro plano.',
      CTA: 'En el estudio, gesto hacia abajo.',
    },
    utileria: 'Un ayudante, micrófono, permiso si es un lugar privado.',
    encaja: 'Laboral por rubro de la zona (solo rubros donde el avatar trabaja registrado).',
    errores: 'Logos o caras de terceros, viento en el micrófono, ir a la locación para un solo HOOK.',
  },
  {
    clave: 'test_tres', nombre: 'Test de tres preguntas', dificultad: 1, grupo: 'explicacion',
    que_es: 'Hace tres preguntas de sí o no con un segundo de silencio después de cada una; la persona se autoevalúa (y se filtra).',
    como: {
      HOOK: 'Anuncia el test levantando tres dedos.',
      PROBLEMA: 'Las tres preguntas, un dedo por pregunta y silencio entre una y otra.',
      SOLUCION: 'Cambio de plano y qué significa contestar que sí.',
      CTA: 'Si dijiste que sí a dos… y el gesto hacia abajo.',
    },
    utileria: 'Ninguna (opcional: tres tarjetas).',
    encaja: 'Despido encubierto, te empujan a renunciar, sueldo en gris.',
    errores: 'Dar un diagnóstico legal según las respuestas, preguntas que todos contestan que sí, no dejar el silencio.',
  },
]

export const CATALOGO: Catalogo = Object.fromEntries(FORMATOS.map(f => [f.clave, { nombre: f.nombre, dificultad: f.dificultad }]))
export const MAX_ACTUACIONES = 1

export const REGLAS_DIVERSIDAD = `Reglas de la tanda (diversidad creativa):
- Un recurso principal distinto por guion: ninguno se repite. Tiene que haber, como mínimo, una explicación visual (pizarra, tarjetas, mito o verdad, test), un papel (documento o firma en suspenso), un movimiento (entrada a cuadro, selfie de urgencia, cambio de toma), un recurso con el celular (leer una pregunta, mostrar la pantalla, titular) y una historia o un contraste (caso en carpeta, contraste, actuar al empleador).
- Como mucho una actuación por tanda y un recurso de dificultad 3 (con su plan B escrito en la indicación). Al menos cuatro de seis se graban en el escritorio o el estudio (dificultad 1 o 2), así la tanda entra en una sesión.
- Nunca quieto: el HOOK tiene una acción o un objeto en los primeros 2 segundos; cada sección cambia algo visible respecto de la anterior (plano, rincón, postura, objeto o acción); al menos dos cambios fuertes por guion; el recurso del HOOK vuelve en otra sección; el CTA tiene un cambio físico de cierre (soltar el fibrón, dejar el papel, acercarse al lente). «Cambiá levemente el ángulo» no cuenta como cambio: decí qué cambia.
- Cada movimiento significa algo: si se puede sacar sin que cambie nada, sobra.
- Documentos, chats y recibos siempre de ejemplo, sin datos reales.
- Ciudad: una variante distinta del callout geográfico en cada guion (pregunta de entrada, después del gancho, condicional, rubro local, gentilicio, localía del abogado, escena local), no seis veces «¿Sos de…?». Siempre la PROVINCIA (nunca un departamento ni una ciudad chica: achica demasiado el público), dicha como la dice la gente de ahí.`

/** El catálogo para el prompt: una ficha corta por recurso. */
export function catalogoEnTexto(fs: Formato[] = FORMATOS): string {
  return fs.map(f => [
    `- ${f.clave} · ${f.nombre} · dificultad ${f.dificultad}: ${f.que_es}`,
    `  HOOK: ${f.como.HOOK} | PROBLEMA: ${f.como.PROBLEMA} | SOLUCIÓN: ${f.como.SOLUCION} | CTA: ${f.como.CTA}`,
    `  Utilería: ${f.utileria} Encaja: ${f.encaja} Errores: ${f.errores}`,
  ].join('\n')).join('\n') + '\n\n' + REGLAS_DIVERSIDAD
}
