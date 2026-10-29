// ── Plantilla del análisis de mercado para guiones (prompt del paso «mercado», mercado.ts) ──────────
// Copia de .cache/guiones/investigacion/plantilla-analisis-mercado.md (24/10/2026), armada junto con el análisis de San Juan
// de Laura Ortiz Molina, que Tomás usó para calibrar los guiones. Un cambio acá: subir VERSION_PLANTILLA_MERCADO.
export const VERSION_PLANTILLA_MERCADO = 'pm1-2026-10-24'

export const PLANTILLA_MERCADO = `# Plantilla — Análisis de mercado para guiones (cualquier cliente, rama, zona o país)

**Para qué:** antes de escribir guiones de anuncios (HOOK → PROBLEMA → SOLUCIÓN → CTA, 45–60 s, grabados por el abogado con el celular), entender **qué está pasando en la zona del cliente** y **qué tiene en la cabeza su avatar**. Así los ganchos suenan a «este abogado es de acá y entiende lo que me pasa» y no a un anuncio genérico.
Ejemplo de Tomás: «En Colombia, después de un terremoto reciente, la gente no va a tener mucho dinero; si es Medellín, va a haber muchas motos».

**Salida:** un archivo \`mercado-<zona>.md\` con la estructura de la sección 8. Ejemplo hecho: \`mercado-san-juan.md\` (Laura Ortiz Molina, laboral, octubre de 2026).

**Reglas fijas**
- Solo lectura. No se escribe en Drive, Docs, la bóveda, bases de datos ni Discord, y no se manda nada a nadie.
- Sin datos personales de trabajadores, clientes finales ni partes de juicios.
- Cada dato lleva **fuente (link) y fecha**. Si no hay fuente, el dato no va.
- Cada insight lleva su **confianza**: verificado / probable / a confirmar con el cliente (sección 5).
- En los anuncios: **sin cifras legales, sin promesas de resultado y sin nombres de empresas** (sección 7).

---

## 1. Insumos internos (leer primero)

| Insumo | Dónde | Qué sacar |
|---|---|---|
| Transcripción del kickoff | \`.cache/kickoff-prueba/payload-<id>.json\` (\`transcript\`) o Fathom | Todo lo que el cliente dice del mercado: quién lo consulta, de qué rubros, qué pasa en la zona, cómo es y cómo habla la gente, qué casos **no** quiere |
| Ficha extraída | \`salida-<id>.json\` (\`ficha\`: avatar, zona, presupuesto, ideas) | Avatar incluye / excluye, zona, cómo se presenta, subramas a confirmar |
| Guiones previos del cliente y de otros clientes de la misma zona o rama | Drive (lectura) y bóveda \`recursos/guiones-por-cliente/\` | Qué ganchos ya se usaron, para no repetir |
| Anuncios ganadores de la rama | \`.cache/kickoff-prueba/ganadores-<rama>.json\` | Ángulos que ya funcionan, para localizarlos |
| CRM y bóveda | \`negocio/CRM Clientes\`, \`negocio/Clientes - nombres canonicos\` (respetar el \`CLAUDE.md\` de la bóveda) | Nombre canónico y si hubo clientes en la misma zona, con qué resultados (solo datos verificados) |

**Trampas de las transcripciones:** Fathom cruza hablantes y a veces **borra palabras** (por ejemplo, «negro» en «en negro»). Los lugares quedan «de oído»: hay que verificarlos uno por uno (sección 2.B).

---

## 2. Preguntas que hay que responder

### A. El cliente y su avatar
1. ¿A quién quiere y a quién **no** quiere? Escribirlo con sus palabras y el tiempo de la grabación.
2. ¿Qué filtros duros tiene (antigüedad, registración, monto mínimo, tipo de caso, zona)? ¿Cómo se meten en el gancho o en el CTA?
3. ¿Qué experiencia le da autoridad (trabajó en un organismo, se especializó, litiga) y si quiere decirla en cámara?
4. ¿Cómo habla (formal o frontal, con humor, edad, tonada)? ¿Qué palabras **no** quiere usar?
5. ¿Dónde atiende de verdad y cómo se presenta? ¿Hace primera consulta por WhatsApp o videollamada? ¿Viaja?

### B. Geografía humana de la zona
1. Verificar **cada nombre de lugar** del kickoff: ¿existe?, ¿en qué departamento o municipio está?, ¿cuánta gente vive? Fuentes: censo, citypopulation, códigos postales, diarios locales. Si no existe, buscar el homófono más probable (por ejemplo, «el Bordón» → Albardón) y marcarlo **a confirmar**.
2. Departamentos o barrios de la zona con su población, cuáles son urbanos y cuáles rurales.
3. ¿Cómo se mueve la gente (colectivo, moto, auto)? ¿Cuánto cuesta ir al centro? ¿Qué rutas o avenidas conoce todo el mundo?
4. Lugares y referencias que todos conocen (plaza, ruta, mercado, fiesta, santuario, estadio, obra), siempre sin religión ni política.
5. Distancias: ¿el cliente está lejos de una parte de su zona? ¿Cómo se resuelve en el CTA?

### C. Economía y empleo de la zona
1. Rubros principales y empleadores típicos **por departamento**.
2. ¿Qué rubros crecen y cuáles se achican **este año**? (cierres, suspensiones, retiros, despidos, inversiones)
3. Formalidad e informalidad (EPH o equivalente), desocupación, subocupación.
4. Salarios de referencia, inflación y costo de vida local, moneda (pesos, dólares, «lucas», «palos»).
5. Para **cada rubro**: ¿encaja con el avatar? (Laboral: ¿suele estar en blanco y con antigüedad? Familia: ¿qué solvencia tiene? Previsional: ¿hubo aportes?) Marcar qué rubros hay que **evitar como gancho** porque traen casos que no se quieren.

### D. Lo que la gente tiene en la cabeza ahora (últimos 3–12 meses)
1. Noticias locales que todo el mundo comenta: cierres de empresas conocidas, obras paradas, conflictos gremiales.
2. Clima y desastres: sequía, inundación, terremoto, incendio, ola de calor, vientos. ¿Cambian el poder adquisitivo o el empleo?
3. Política y elecciones: **solo como contexto**, nunca en el anuncio.
4. Cambios de ley que la gente escuchó en la tele (por ejemplo, una reforma laboral o previsional) y **los mitos** que generan («ya no me corresponde nada»).
5. Calendario: aguinaldo, temporadas (cosecha, turismo), fiestas, vacaciones, fechas de cobro.

### E. Marco legal vigente (para no equivocarse, no para ponerlo en el anuncio)
1. ¿Qué cambió en el último año en la rama? Ley, decreto, reglamentación, fallos divididos.
2. ¿Qué afirmaciones de guiones viejos **ya no son ciertas** (multas, porcentajes, plazos)?
3. ¿Ante qué organismo se reclama localmente? (en CABA, SECLO; en provincias, la Subsecretaría o el Ministerio de Trabajo; en otros países, su equivalente)

### F. Lenguaje
1. Gentilicio, voseo o tuteo, y modismos **seguros** (que no sean groseros ni infantiles).
2. Palabras que suenan a forastero (porteñismos en el interior; argentinismos en otro país).
3. Palabras sensibles para el cliente o para el público, y palabras que **atraen al avatar excluido**.

### G. Competencia
1. Biblioteca de anuncios de Meta: buscar «<rama> <zona>», «abogado/a <rama> <ciudad>» y «<problema> <ciudad>», activos y todos.
2. ¿Cuántos estudios anuncian? ¿Qué ganchos usan? ¿Hay saturación o el terreno está libre?

### Adaptar por rama
| Rama | Preguntas extra |
|---|---|
| Laboral (despidos) | Rubros en blanco vs. sin registrar, contratistas, regímenes especiales (construcción, rural, doméstico, público), retiros voluntarios, suspensiones, reforma |
| Familia | Solvencia del avatar, divorcios por rubro (ej.: mineros o petroleros con buenos sueldos), cuota alimentaria en un contexto de caída de ingresos |
| Previsional | Edad de la población, aportes con huecos por informalidad, moratorias vigentes, jubilación de rubros especiales |
| ART / accidentes | Rubros de riesgo de la zona (minería, construcción, agro, moto-delivery), rutas peligrosas, siniestralidad |
| Sucesiones | Propiedades rurales, fincas, campos familiares, migración interna |
| Amparos de salud | Obras sociales y prepagas dominantes en la zona, hospitales de referencia |

### Otro país
- Reemplazar las fuentes argentinas por las del país (sección 3) y usar sus términos: liquidación, finiquito, cesantía, desahucio, prestaciones; tuteo o usted según el lugar.
- Revisar moneda, inflación y tipo de cambio, y la institución ante la que se reclama.
- Buscar los hechos que marcan a la zona (sismo, huracán, paro nacional, migración). En una ciudad con muchas motos, por ejemplo, hay accidentes de moto y repartidores de aplicaciones.

---

## 3. Fuentes por tipo

| Tipo | Argentina | Otros países (equivalente) |
|---|---|---|
| Estadística de empleo | INDEC (EPH por aglomerado), dirección de estadística provincial, SIPA (Secretaría de Trabajo), consultoras que procesan la EPH | DANE (Colombia), INE (Uruguay, Chile, España), INEGI (México), INEI (Perú) |
| Empleo por sector | IERIC (construcción), Secretaría de Minería, RENATRE (rural), cámaras empresarias | Ministerios sectoriales y cámaras |
| Conflictos y cierres | CEPA (mapa federal de conflictos), diarios locales, notas de gremios | Diarios locales y observatorios laborales |
| Prensa local | Los dos o tres diarios principales de la provincia (ej.: Diario de Cuyo y Tiempo de San Juan) y su sección por departamento | Los diarios de la ciudad |
| Ley y fallos | Boletín Oficial, El Economista, iProfesional legales, Diario Judicial, abogados.com.ar, KPMG o estudios grandes | Diario oficial del país y prensa jurídica |
| Geografía y población | Censo 2022, citypopulation.de, códigos postales, transporte provincial (tarifas y líneas) | Censo nacional y citypopulation |
| Lenguaje | Diccionarios o notas de modismos del diario local, diccionarios regionales universitarios | Ídem |
| Competencia | Biblioteca de anuncios de Meta (herramienta \`ads_library_search\`) | Ídem |

**Consejos de búsqueda**
- Buscar con el **nombre de la zona + año + palabra clave** («despidos», «retiro voluntario», «suspensiones», «cierre», «Subsecretaría de Trabajo»). Después abrir las notas para confirmar fecha y cifras.
- Desconfiar de la **fecha que muestra la página**: varios sitios muestran la del día de la visita. Vale la fecha del contenido.
- Descartar **homónimos** (otra ciudad con el mismo nombre en otra provincia o país).
- Un PDF oficial que el lector no abre se puede bajar y extraer con \`pypdf\`.

---

## 4. Cómo marcar la confianza

| Marca | Cuándo | ¿Puede ir en un guion? |
|---|---|---|
| **[V] verificado** | Fuente seria (organismo, diario local, informe) con fecha, en general de los últimos 12 meses, y dato concreto leído en el original | Sí, como contexto genérico (sin cifras legales ni nombres) |
| **[P] probable** | Deducción razonable a partir de datos verificados, una sola fuente, fuente vieja o dato leído solo en el resumen de un buscador | Sí, con frases que no afirmen el dato duro |
| **[C] a confirmar con el cliente** | Depende de su criterio, su experiencia, lo que quiere decir en cámara o lo que pasa en su consultorio | No, hasta que lo confirme |

Separar siempre **el dato** (verificable) de **la lectura** (qué siente el avatar), que suele ser probable.

---

## 5. Cómo convertir un insight en un gancho

**Cadena:** dato local → escena que vive el avatar → emoción o creencia equivocada → frase del abogado.

1. **Dato:** «En la zona, las cadenas ofrecen retiros voluntarios por un porcentaje a gente con 30 años de antigüedad.»
2. **Escena:** «Te llaman a una oficina y te ponen un número delante.»
3. **Creencia equivocada:** «Si es voluntario, es un regalo; si no lo acepto, me quedo sin nada.»
4. **Frase del gancho:** «¿Te están ofreciendo un "retiro voluntario"? Antes de firmar, escuchame un minuto.»

**Dónde va cada tipo de insight**
- **HOOK:** el filtro del avatar más algo local que se reconoce («Si te despidieron en San Juan y trabajabas en un súper…», «¿Te dijeron que la empresa perdió el contrato?»).
- **PROBLEMA:** la escena concreta y lo que la empresa hace a propósito, con color local (vacaciones obligadas, suspensiones, «una parte en mano»).
- **SOLUCIÓN:** el reencuadre contra el mito («la reforma cambió cosas, pero no borró tu derecho»), sin el paso a paso legal.
- **CTA:** la cercanía y el filtro («No tenés que ir al centro: escribime y contame cuántos años trabajaste»).

**Ficha de cada insight (copiar)**
\`\`\`
### I<n>. <insight en una frase>
- Dato: <qué, cuánto, dónde> ([fuente, fecha](link))
- Por qué le importa al avatar de esta zona: <1–2 líneas>
- Uso (<HOOK|PROBLEMA|SOLUCIÓN|CTA>): «<frase de ejemplo, sin cifras legales ni promesas>»
- Confianza: [V]/[P]/[C] — <qué falta confirmar>
\`\`\`

**Test de cada gancho antes de entregarlo**
1. ¿Filtra al avatar y deja afuera a los excluidos?
2. ¿Una persona de la zona lo reconoce como «de acá»?
3. ¿Suena al cliente, a su edad y a su tono?
4. ¿Está libre de cifras legales, promesas, nombres de empresas, políticos y gremios?
5. ¿Evita las palabras sensibles para el cliente?
6. ¿El dato en el que se apoya está marcado [V] o [P], y no [C] sin confirmar?

---

## 6. Semáforo para nombrar empresas, lugares y hechos

| Color | Qué | Ejemplo |
|---|---|---|
| **Verde** (se puede) | Rubro genérico, departamento o barrio, tipo de situación | «si trabajabas en un súper», «en una minera o contratista», «acá en el sur», «si sos de Chimbas» |
| **Amarillo** (con cuidado y con el OK del cliente) | Hechos públicos sin nombre: obras paradas, cierres, crisis de un sector, desastres | «en el sur se pararon obras», «el vino viene en crisis», «que te muevan el piso» |
| **Rojo** (nunca) | Nombre de empresa, marca, político, gremio, juez o juzgado. Descripciones que identifican a una sola empresa. Casos reales reconocibles | «la textil de Pocito», «los vigiladores del hospital», «la fábrica de galletitas de X» |

---

## 7. Riesgos que hay que revisar siempre
- Cifras legales que cambiaron por reformas: no ponerlas.
- Promesas de resultado o de monto.
- Dirección o sede que el cliente no tiene («estudio en el centro»).
- Tragedias usadas como chiste o como gancho barato.
- Políticas de Meta sobre atributos personales (no preguntar por salud, deudas ni situación económica en segunda persona).
- Avatares excluidos que el gancho atrae sin querer (por ejemplo, «en negro» cuando el cliente no toma trabajo sin registrar).
- Datos de personas reales.

---

## 8. Estructura del archivo de salida

1. Encabezado: cliente (nombre canónico), rama, avatar (incluye y excluye), zona, fecha, insumos usados.
2. **Resumen** de 8–10 líneas con los insights más filosos.
3. **Insights para guiones** (10–20), con la ficha de la sección 5.
4. **Geografía:** lugares verificados, nombres de oído resueltos (con confianza), población.
5. **Rubros por departamento** y si encajan con el avatar (o qué evitar).
6. **Vocabulario:** qué usar y qué evitar.
7. **Lo que dijo el cliente** (con tiempo de la grabación) y para qué sirve.
8. **Riesgos.**
9. **Pendientes para confirmar** con el cliente (lista corta).
10. **Notas de método:** fechas dudosas, homónimos descartados, datos que no se encontraron (no completarlos con suposiciones).

---

## 9. Checklist final
- [ ] Cada lugar del kickoff está verificado o marcado [C].
- [ ] Hay al menos un dato de **este año** de empleo o economía de la zona con fuente.
- [ ] Hay al menos 3 hechos locales recientes que la gente conoce.
- [ ] Se revisaron los cambios legales del último año y los mitos que generan.
- [ ] Se buscó la competencia en la Biblioteca de anuncios.
- [ ] Cada insight tiene fuente, fecha, confianza y una frase de ejemplo.
- [ ] Ninguna frase de ejemplo trae cifras legales, promesas ni nombres de empresas.
- [ ] Los rubros que traen avatares excluidos están marcados para evitar.
- [ ] La lista de pendientes para el cliente es corta y concreta.
`
