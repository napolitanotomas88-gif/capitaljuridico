// ── Base de conocimiento de guiones · rama laboral (despidos) ──────────────────────────────────────
// Va al prompt de ideas (ideas.ts) dentro de <base_rama>. Armada el 24/10/2026 a partir de
// .cache/kickoff-prueba/ejemplos-guiones-laboral.md (7 docs "Guiones - X" leídos en Drive solo lectura, el prompt maestro
// "PROMPT PARA HACER GUIONES CON CLAUDE" y los anuncios ganadores por CPL), SIN datos personales: sin nombres de clientes
// ni de abogados, sin ids de docs, sin zonas atadas a un cliente. Los ejemplos son textos de guiones grabados (no traen
// datos de trabajadores). No incluye NADA del doc de la clienta de la prueba ("Guiones - CrisO", que se usa como control):
// la v1 copiaba su gancho, su solución y su CTA en "Formato vigente (octubre)" y sus ángulos (licencia médica, horas
// extra), y las ideas repetían el control; la v2 los saca y deja el formato de los otros docs (el CTA que pide un dato es
// el de CarlosO). Tampoco el guion viejo con cifras legales arriesgadas ("48 horas", "duplicar"). BORRADOR: falta que Tomás
// lo apruebe; si para producción quiere sumar el formato de CrisO, aclararlo acá. Cuando cambie, subir VERSION_KB.
export const VERSION_KB_LABORAL = 'kb-laboral-2-2026-10-24'

export const KB_LABORAL = `# Guiones de laboral (despidos): cómo son los que funcionan

## Formato
- Cada video: HOOK → PROBLEMA → SOLUCIÓN → CTA. En cada sección, una velocidad de 1 a 5 (HOOK 4–5, PROBLEMA y SOLUCIÓN 3–4, CTA 4–5) y una indicación de grabación entre paréntesis, escrita como si alguien le explicara en persona al abogado qué hacer (cámara trasera por defecto, sentarse con una hoja, contar con los dedos, cambiar de ángulo, acercarse a cámara, señalar hacia abajo).
- Utilería que se repite: telegrama, recibo de sueldo, una hoja en blanco («así te ve la ley»), cronómetro, la calculadora del celular, un certificado médico.
- Largo del texto hablado: el prompt maestro pide 500–800 caracteres (45–60 s); los grabados rondan 870–1.200. Lo decide Tomás.
- Se escriben en tandas de 5 videos.

## Cómo arranca el gancho
- Callout con filtro en la primera frase: una pregunta o un «Si…» con la situación y el filtro (registración, antigüedad, provincia, rubro). Es la forma de casi todos los ganadores.
  - «¿Te despidieron y trabajabas en negro?»
  - «Si trabajabas en blanco… y te despidieron»
  - «Si le diste más de diez años a una empresa…»
- Enseguida, una desmentida o una semilla de urgencia real: «Eso es mentira, y te lo explico ahora», «Ojo», «Esperá».
- Otras formas que se usan: «Si X y Y, entonces Z»; un caso contado («Hace poco me escribió alguien…»); listas («3 señales…»); actuar al empleador («Mirá, mañana no hace falta que vengas más»); una frase corta de giro («No te despiden… pero hacen todo para que te vayas»).
- Localizado: «Si te despidieron en [provincia]», rubros de la zona (bodega, mina, comercio, fábrica, campo).

## Problema, solución y CTA
- Problema: la escena cotidiana concreta (te llaman a una oficina y te dan un papel con un número; cobrabas en mano; te sacan del grupo de WhatsApp) y el costo de no hacer nada (los testigos se van, los chats se borran, el plazo corre, la firma).
- Solución: un reencuadre («firmar la liquidación no le cierra la puerta al reclamo», «la ley no mira la factura, mira la realidad») y la vía nombrada sin el paso a paso (intimación, indemnización por trabajo no registrado, despido indirecto, reclamo por diferencias, prueba con testigos, mensajes y transferencias). Los más nuevos suman un descargo que filtra: «No todos los casos entran igual: depende de la antigüedad y de lo que se pueda probar».
- CTA (nunca se nombra WhatsApp): «Si [situación + filtro], escribime acá abajo (gesto con el dedo hacia abajo) para [revisar tu liquidación / calcular cuánto te corresponde] antes de que [se venza el plazo / se pierda la prueba / firmes]». Los más nuevos piden un dato para calificar en el primer mensaje: «contame hace cuánto trabajabas ahí y qué parte no estaba en el recibo».

## Filtros que se usan
- Antigüedad («más de 5 / 10 / 20 años», «varios años»), registración (en blanco, en negro, en gris o parte en negro, monotributo facturando a una sola empresa), tiempo desde el despido, provincia (nunca ciudad chica), rubro, señales de caso grande (puesto de responsabilidad, bono, horas extra, auto de la empresa).

## Tono
- Rioplatense, de vos («trabajo» —nunca «laburo»—, «te echaron», «en mano»), empático pero firme, del lado del trabajador. El abogado habla en primera persona («reviso personalmente tu liquidación»). Sin jerga.
- Urgencia anclada en algo real (prescripción, prueba que se enfría, la firma). Nunca urgencia inventada.
- Los más nuevos son los más prudentes: hablan de analizar el caso y no prometen el resultado, ni montos («el doble o triple»), ni plazos («48 horas»), ni multas. Cualquier cifra legal la revisa Tomás.

## Ángulos ya usados (para proponer cercanos a los ganadores sin repetir)
- Despido en negro («no te corresponde nada», «no vas a poder probar»). Sueldo en gris (parte en negro). Monotributista que en realidad es empleado. Promesa de blanqueo que nunca se cumplió.
- Despido de palabra («no vengas más», te dejaron de llamar). Te empujan a renunciar o te cambian las condiciones (despido indirecto). Despido con causa inventada.
- Liquidación mal calculada estando en blanco (antes de firmar: NADA de ángulos sobre gente que ya firmó, Tomás 25/10). Retiro voluntario. «Falta de trabajo» con oferta del 50 %. Indemnización en cuotas o que no llega (intimación).
- Diferencia de categoría. Despido por edad. Aportes y jubilación perdidos. El mito de que «si reclamás te hacen la vida imposible». El cronómetro del plazo. Trabajo rural sin registrar.
- Ojo: los guiones para EMPRESAS (desvincular a un gerente, despido con causa del lado del empleador) son otro avatar: no van mezclados con los de trabajadores.

## Ejemplos completos de guiones grabados que funcionaron (ganadores por costo por mensaje)

### Ejemplo A · «¿Trabajaste en negro y te echaron?» (USD 0,34 por mensaje)
HOOK · Velocidad 5 · (Cámara trasera, fondo con título enmarcado visible. Decilo caminando hacia la cámara, tono firme.)
Trabajaste años en negro, te echaron de un día para el otro y te dijeron que no te corresponde nada. Eso es mentira, y te lo explico ahora.
PROBLEMA · Velocidad 4 · (Sentate y contá con los dedos cada cosa que la persona pierde.)
Años cobrando en mano, sin aportes ni obra social, y cuando te echan, no figurás en ningún lado. Te vas sin indemnización, con sueldos adeudados y con tu jubilación agujereada. Si no hacés nada, tu ex empleador se queda con todo eso.
SOLUCIÓN · Velocidad 3 · (Sacá tu propio celular y mostralo a cámara justo cuando digas que las pruebas están en el bolsillo.)
La ley te reconoce cada año trabajado aunque estés en negro. La relación laboral se prueba, y casi todos tienen las pruebas en el bolsillo sin saberlo. Con eso se arma un reclamo por despido con tu antigüedad real.
CTA · Velocidad 5 · (Guardá el celular, volvé la mirada a cámara y señalá hacia abajo.)
Si querés recuperar lo que te corresponde por esos años, escribime acá abajo (gesto con el dedo hacia abajo) para analizar tu caso y ver qué pruebas ya tenés, antes de que el tiempo corra y tu reclamo prescriba.

### Ejemplo B · «¿Firmaste tu liquidación y cobraste? Ojo» (USD 0,44 por mensaje) — SOLO como referencia de formato: Tomás (25/10) no quiere ángulos sobre gente que ya firmó
HOOK · Velocidad 5 · (Cámara trasera. Te acercás levemente a la cámara.)
Estabas en blanco, te despidieron, y firmaste la liquidación sin que nadie te explicara cómo la calcularon. Te pagaron, te dijeron que era lo que correspondía por ley, lo firmaste porque necesitabas la plata rápido. Ojo, porque ese número casi nunca está bien calculado.
PROBLEMA · (Apoyás una hoja sobre el escritorio mientras hablás. Gesticulás con una mano al nombrar cada punto.)
Cuando estabas en blanco con antigüedad, con un puesto de responsabilidad o con variables como bono anual, horas extra o viáticos, la liquidación tiene que calcularse sobre tu mejor remuneración normal y habitual, no sobre el sueldo básico del último recibo. Ahí es donde las empresas ajustan para pagar menos: dejan afuera el bono, las horas extra, la proporción real de aguinaldo y las vacaciones no gozadas. Cada uno de esos ítems mal calculados significa plata tuya que quedó en la empresa.
SOLUCIÓN · (Cambiá el ángulo de la cámara. Apoyá la carpeta y mirá directo.)
Nosotros hacemos una revisión puntual de tu liquidación para detectar diferencias salariales, recalcular sobre la base correcta y reclamar lo que te corresponde, incluso si ya firmaste y cobraste.
CTA · Velocidad 5 · (Te acercás al celular, inclinás el cuerpo hacia adelante y señalás fuerte.)
Si estabas en blanco y te despidieron, escribime acá abajo (gesto con el dedo hacia abajo) y reviso personalmente tu liquidación antes de que se cumpla el plazo para reclamar.

### Ejemplo C · «¿Te están empujando a renunciar?» (USD 0,51 por mensaje)
HOOK · Velocidad 5 · (Arrancá con cámara trasera, sostené el celular mostrando el escritorio o el lugar de trabajo; hablá rápido y marcando pausas.)
No te despiden… pero hacen todo para que te vayas.
PROBLEMA · Velocidad 3 · (Con cámara trasera, apoyá el celular, contá con los dedos y marcá cada punto con el cuerpo.)
Te cambian condiciones o te presionan todos los días. No te despiden… pero buscan que te vayas solo. El problema es que si renunciás, perdés tus derechos laborales. Y, por desgaste, terminás aceptando sin saber lo que implica.
SOLUCIÓN · Velocidad 3 · (Acercate a cámara, señalá con un dedo como marcando algo clave.)
Cuando hay presión para renunciar, no es una simple incomodidad. Se puede considerar un despido encubierto. No es firmar e irte: es analizar la situación y encuadrarla correctamente para no perder el reclamo.
CTA · Velocidad 5 · (Volvé a cámara frontal, señalá hacia abajo indicando los comentarios, hablá más enérgico y claro.)
Si sentís que te están empujando a renunciar, escribime ahora acá abajo (gesto con el dedo hacia abajo) y analizo tu caso de forma personal para que no pierdas tus derechos como trabajador.

### Ejemplo D · «¿Te despidieron y trabajabas en negro?» (USD 0,87 por mensaje)
HOOK · Velocidad 5 · (Cámara trasera. Arrancá serio, como si le hablaras a alguien que acabás de cruzar en la calle. Acercate un poco a la cámara en la primera frase.)
¿Te despidieron y trabajabas en negro? Seguro un día te dijeron «no vengas más». Esperá, porque te están por hacer perder la indemnización más alta de tu vida.
PROBLEMA · Velocidad 3 · (Sentate en un escritorio o con una biblioteca de fondo. Contale la situación tranquilo, mirando a la cámara como si la persona estuviera enfrente.)
Muchos años trabajaste cobrando en mano, sin recibo, sin aportes. Y ahora que te echaron pensás que no te corresponde nada porque estabas en negro. Mientras tanto, el que te usó todo ese tiempo se queda tranquilo.
SOLUCIÓN · Velocidad 4 · (Gesticulá con las manos cuando marcás que tenés derecho a más. Contá con los dedos cuando nombrás los años.)
Lo que nadie te contó: estar en negro no te deja afuera, te da derecho a reclamar más. [cifra legal del guion original: no copiar sin que la revise Tomás] Y cuantos más años tenés, más grande es el reclamo.
CTA · Velocidad 5 · (Acercate de nuevo a la cámara y bajá el dedo hacia los comentarios cuando lo decís.)
Si querés recuperar la indemnización completa por todos esos años antes de que el plazo se te venza, escribime acá abajo (gesto con el dedo hacia abajo) para que revisemos tu caso y te diga cuánto te corresponde, antes de que se vuelva imposible probarlo.

## Lo más nuevo (octubre de 2026)
- El CTA pide un dato para calificar en el primer mensaje (antigüedad, qué parte no estaba en el recibo) y cierra con «escribime acá abajo».
- La solución nombra la vía sin cifras ni plazos y suma el descargo que filtra («depende de la antigüedad y de lo que se pueda probar»).
`
