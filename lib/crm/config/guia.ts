// Enlaces iniciales (los grabó Gerónimo; ZIP del CRM del 8/10/2026). El administrador también puede cambiarlos desde la guía:
// lo que guarda vive en la pestaña "Videos guía" de la planilla de Accesos (lib/crm/videosGuia.ts) y le gana a estos.
export const URL_VIDEO_GUIA = "https://kommodo.ai/recordings/UeVOjxnP9UFme3GAnDBL";
export const URL_VIDEO_CUOTAS = "https://kommodo.ai/recordings/D2XvkMAYzqAjoahGzQsW?onlyRecording=1";

export const SECCIONES_GUIA = [
  {
    "titulo": "Antes de empezar",
    "texto": "Mi día convierte el CRM en una lista de tareas. Cada tarjeta te dice qué hacer con un lead y cada botón registra lo que hiciste en la planilla. La app no envía mensajes por vos. Primero hacé la tarea y después marcala. Durante la prueba trabajamos en una copia: no reemplaces el trabajo en el CRM real hasta que Gerónimo confirme el cambio."
  },
  {
    "titulo": "1. Entrá y mirá tu día",
    "texto": "Entrá con tu cuenta de Google al dashboard y abrí Ventas: tu cuenta ya está vinculada a tu pestaña y no hace falta PIN. En computadora vas a ver cinco columnas; en el celular, una lista con filtros por tipo. Mirá las calls de hoy y los pendientes. Usá Actualizar si acabás de cambiar algo en la planilla."
  },
  {
    "titulo": "2. Pre-call: completá la preparación",
    "texto": "Acá aparecen los leads cuyo pre-call no dice Hecho - link a call ni Olvidar, incluso si la call ya pasó. La app deja afuera leads cerrados, sin nombre, con fecha inválida o fuera de la ventana de 60 días. Las fases actuales son CONF + DECISORES → VIDEOS CONF → DOLORES → Hecho - link a call. La tarjeta pide la fase siguiente. Mandala y tocá Enviado; no marques una fase que no hiciste. Un mismo lead puede aparecer también en otra columna."
  },
  {
    "titulo": "Listo por hoy",
    "texto": "Si hoy mandaste una fase y la siguiente puede esperar a mañana, la tarjeta baja a Listo por hoy y deja de contar como pendiente. Si la call está cerca y todavía faltan fases, sigue pendiente: podés continuar el pre-call en el mismo día. Las calls pasadas con pre-call incompleto siguen atrasadas. En No-show y Post-call, también esperan en Listo por hoy los seguimientos que coordinaste para otro día: la tarjeta dice para qué fecha quedó. Si el lead no asistió a ninguna llamada y ya decidiste No hacer en no-show, podés archivarlo con Olvidar; no envíes fases innecesarias para completar el pre-call."
  },
  {
    "titulo": "3. ¿Se presentó?: registrá la asistencia",
    "texto": "Cuando pasa la hora de la primera call, registrá si el lead asistió: Sí si vino, aunque no haya comprado; No si faltó. Sí lo lleva a Resultado. No lo lleva inmediatamente a No-show. Si más adelante asiste a una reagenda, registralo desde su tarjeta de No-show: no cambies la ausencia de la primera call."
  },
  {
    "titulo": "4. Resultado: anotá cómo terminó",
    "texto": "Si el lead vino a la primera call o a una reagenda, cargá la situación real. Si no cerró, elegí Hacer o No hacer seguimiento. Follow Up no es una opción de resultado: el seguimiento se decide por separado con Hacer o No hacer. Reagendó es un motivo de no cierre: no pide fecha ni activa preguntas de asistencia. Si cerró, completá los tres montos obligatorios en este orden: Cash día 1, Cash trato cerrado y Valor del servicio. Escribí los montos sin separadores de miles: 1500, no 1.500."
  },
  {
    "titulo": "5. No-show: recuperá la reunión",
    "texto": "Son los leads que faltaron a la primera call y todavía no asistieron a una reagenda. La app indica el siguiente seguimiento, S1 a S5. El S1 puede aparecer al registrar la ausencia; después se hace un seguimiento por día. Mandá el mensaje y tocá Enviado. Si acordaste hablar otro día, tocá Coordinar fecha (se explica en Post-call).\n\nSe presentó a la reagenda se usa solamente si el lead asistió: guarda Sí en la asistencia a la reagenda y pasa a Resultado. No se presentó a la reagenda se usa solamente si hubo una reunión reagendada y el lead faltó: guarda No y permanece en No-show. Si nunca hubo una reagenda, no marques una asistencia o ausencia ficticia. No necesitás cargar una fecha para registrar la asistencia real. La primera ausencia y los seguimientos se conservan.\n\nDespués del S5, No hacer seguimiento detiene los envíos y retira al lead de No-show. No cambia el pre-call: si dice Hecho - link a call, queda así. No hace falta tocar otro botón para quitarlo.\n\nOlvidar está en todas las tarjetas de No-show, en cualquier momento de la secuencia: usalo cuando el lead cancela, te bloquea o ya no tiene sentido seguir, aunque no hayas llegado al S5. También aparece en la tarjeta de Pre-call cuando el no-show ya está en No hacer. Lo decide el closer; no se marca automáticamente. Guarda No hacer en el seguimiento y Olvidar en el pre-call: el lead sale de No-show y de Pre-call, pero permanece en la planilla. Si lo tocaste por error, deshacelo desde Hechas hoy.\n\nSi ya enviaste el seguimiento de hoy pero la secuencia sigue abierta, la tarjeta puede permanecer para registrar la asistencia a una reagenda. No mandes otro seguimiento para sacarla."
  },
  {
    "titulo": "6. Post-call: acompañá la decisión",
    "texto": "Son leads que vinieron, no cerraron y tienen seguimiento habilitado. El S1 toca al día siguiente de la reunión; después hay un seguimiento por día hasta S5. Enviado registra el paso. Cerró abre los datos del cierre; No hacer termina el seguimiento; Reagendó permite registrar ese motivo de no cierre y decidir si seguir. Al completar S5, resolvé la tarjeta final.\n\nCoordinar fecha (también en No-show): si con el cliente acordaste hablar otro día, tocá Coordinar fecha y elegí el día. Al terminar la call podés usar Hacer · Coordinar fecha en ¿Hacer seguimiento?. Hasta ese día la tarjeta espera en Listo por hoy (al pie de la columna, con la marca \"Seguimiento el dd/mm\") y no cuenta como pendiente ni como atrasada; ese día vuelve a su columna con \"próximo seguimiento: hoy\". Mandalo y tocá Enviado: el siguiente sigue al otro día, como siempre. Si ese día no lo hacés, queda atrasada. Si hoy ya le escribiste, primero coordiná la fecha y después tocá Enviado en la tarjeta: la fecha acordada se mantiene. Con los filtros Mañana, Esta semana o Rango, Listo por hoy se abre solo y ves lo coordinado para esos días. La fecha queda en la planilla, en la columna Próximo seguimiento."
  },
  {
    "titulo": "7. Mensajes y WhatsApp",
    "texto": "El botón Mensajes abre PROCESOS VENTAS - SKWD. Elegí el texto que corresponde al caso y adaptalo al lead. El ícono verde de cada tarjeta abre su chat de WhatsApp sin texto. Enviado no manda el mensaje: solo anota en el CRM que ya lo enviaste."
  },
  {
    "titulo": "8. Filtros y atrasados",
    "texto": "Buscá por nombre o teléfono. Los filtros Hoy, Mañana, Esta semana y Rango se refieren a la fecha de la reunión de la tarjeta, no necesariamente al día en que toca mandar el seguimiento. Para revisar todo tu trabajo usá Todo. Atrasados muestra tareas pendientes de días anteriores; en No-show y Post-call siguen en su columna, debajo de las que están al día. No envíes varios seguimientos de golpe para vaciar la lista."
  },
  {
    "titulo": "9. Ficha y errores",
    "texto": "Tocá el nombre para ver contacto, contexto, links, datos de cierre, grabaciones e historial. En computadora abre un panel lateral. Si te equivocás, usá Deshacer en el aviso de cinco segundos o en Hechas hoy; algunas operaciones anteriores quedan bloqueadas si hubo cambios posteriores. Si falla el guardado, la tarjeta vuelve: revisá el error. Si alguien cambió la fila, actualizá y revisá el lead antes de repetir."
  },
  {
    "titulo": "10. Cerrá tu día",
    "texto": "Revisá Todo, sin búsqueda ni filtros que escondan tareas. El objetivo es completar los mensajes y registros que correspondan hoy.\n\nEn No-show pueden quedar tarjetas aunque el seguimiento del día esté hecho: conservan las opciones de asistencia a una reagenda real. No tenés que mandar otro mensaje para sacarlas.\n\nLos pre-calls que ya recibieron su fase de hoy y pueden esperar a mañana quedan en Listo por hoy y no cuentan como pendientes. Durante el día aparecen nuevas tareas cuando pasan las calls. No marques mensajes no enviados para bajar el contador. Si falta un lead que esperabas, avisale a Gerónimo."
  },
  {
    "titulo": "Guion para grabar el video",
    "texto": "Mostrá en este orden: login → vista del día → Pre-call y Listo por hoy → asistencia → resultado y los tres montos obligatorios → no-show, S5, No hacer y Olvidar → post-call → Mensajes y WhatsApp → ficha → Deshacer → filtros → revisión final con Todo → Cuotas, plan, pago parcial y corrección de un pago. Explicá cada sección mientras la mostrás. Para demostrar escrituras, usá la copia de prueba y deshacé los cambios al terminar."
  },
  { titulo: "Cuotas: cobros y renovaciones", texto: "Entrá a Cuotas para ver tus cobros. Creá un plan anotando arriba, en Pagado, lo que el cliente ya pagó, y abajo las cuotas pendientes con su importe en USD, su fecha y su concepto (Reserva, Cuota o Completa pago); también podés abrirlo desde una venta cerrada. Copiar plan copia todo el plan (menos las notas) desde el formulario, el detalle o el Historial. Avisar muestra los avisos previos, Cobrar hoy los vencimientos del día y Vencidas los cobros atrasados. En Avisar, mandá el mensaje por WhatsApp y tocá Avisado; registra el aviso y pausa el recordatorio. En Cobrar hoy y Vencidas están Registrar pago y Coordinar fecha. Si el cliente no paga ni acuerda otra fecha, la cuota sigue pendiente. Registrar pago acepta pagos parciales: cargá solamente lo recibido. Avisar no ofrece Registrar pago. WhatsApp aparece en todas las tarjetas. Con teléfono cargado abre el chat del cliente; sin teléfono abre WhatsApp Web y tenés que elegir el contacto. Coordinar fecha pausa los recordatorios hasta la fecha acordada. Cobrar hoy y Vencidas usan esa nueva fecha; la fecha de pago original se conserva como referencia. Las cuotas futuras o gestionadas por hoy quedan en Próximas y listas por hoy. Historial conserva todos los planes y permite anular un pago cargado por error; lo ya pagado (la fila Pagado) no se anula: se corrige o se vacía desde Editar plan. Marcar abandono detiene el reclamo de todo el plan, sin borrar deuda ni historial; podés reactivarlo. Los domingos no se hacen envíos. El administrador ve todos los responsables y carga renovaciones en Administración. Las cuotas viven en una base independiente y no se sincronizan con Google Sheets." },
] as const;
