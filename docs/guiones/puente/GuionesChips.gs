/**
 * Guiones en los chips del Doc del cliente · Puente Drive (27/10/2026, pedido de RESPONSABLE_HUB: «tal cual como lo vinimos haciendo»)
 * Los Docs «Guiones - X» (copias de «Plantilla Guiones - C.J») tienen, por tanda, un título «TANDA N°» y debajo un renglón con
 * viñeta por video: encabezado 4 «Video:» + un chip desplegable de estado (No iniciado / Para grabar / Grabado completo) que
 * se pliega con la flechita. El guion va DEBAJO de su chip, en párrafos normales: la sección en negrita (HOOK), «Velocidad N»,
 * la indicación entre paréntesis resaltada en rosa (#f4cccc), el texto (con «(gesto con el dedo hacia abajo)» resaltado) y un
 * renglón vacío. Así están cargados los Docs de CUENTA_QA, CUENTA_QA y CUENTA_QA.
 * Acción cargarEnChips (la usa lib/bot/guiones/envio.ts):
 *   { docId, tanda, clave, guiones: [{ numero, parrafos: [{ tipo: 'seccion'|'velocidad'|'indicacion'|'texto'|'vacio', texto }] }] }
 *   · tanda 0 = la elige el puente: la que ya cargó el bot con esta clave (una corrección vuelve a la misma) o, si no, la
 *     PRIMERA «TANDA N°» con todos sus chips vacíos (27/10: el Doc de CUENTA_QA CUENTA_QA ya tenía la TANDA 1° cargada a mano y la
 *     tanda 1 del bot es su segunda). Devuelve en «tanda» la que usó.
 *   · tanda 0 y ninguna libre (5/11/2026): se AGREGA al final la tanda siguiente a la más alta con el mismo formato (copia
 *     de su título «TANDA N°» y de su último chip «Video:», uno por guion) y se carga ahí; sus chips vuelven a «No iniciado»
 *     por la Docs API (GuionesEstadoChips.gs). Devuelve creada: true y reiniciados (cuántos, o el error de ese paso).
 *   · El guion N va debajo del N-ésimo chip «Video:» de «TANDA <tanda>°». Si faltan chips (6.º guion), se agregan copiando el
 *     último de la tanda (con su renglón vacío).
 *   · Solo escribe debajo de un chip VACÍO o de uno que ya cargó el bot con esta clave (rango con nombre invisible
 *     «cjg|<clave>|<numero>»): una corrección reemplaza lo suyo. Si una persona ya escribió debajo de algún chip de los que
 *     tocaría, frena SIN tocar nada. Valida todo antes de escribir y usa el candado del script (como agregarTanda).
 *   · El valor del chip («No iniciado» → «Para grabar») no se puede cambiar por script: Apps Script no maneja los chips.
 * Va en su propio archivo del proyecto del puente (Apps Script junta todos los .gs: los nombres de acá empiezan con «chips»
 * o terminan en «Chips_» para no chocar). Usa PREFIJO_DOC_GUIONES y resp_ de Codigo.gs. En el switch de doPost de Codigo.gs:
 *   case 'cargarEnChips': return resp_(cargarEnChips_(p));
 * Pruebas: scripts/test-puente-chips.mjs (node:vm con un Doc de juguete).
 */
var CHIPS_MAX_GUIONES = 12;
var CHIPS_MAX_PARRAFOS = 40;
var CHIPS_MAX_TEXTO = 3000;
var CHIPS_COLOR_INDICACION = '#f4cccc';
var CHIPS_GESTO = '(gesto con el dedo hacia abajo)';
var CHIPS_TIPOS = ['seccion', 'velocidad', 'indicacion', 'texto', 'vacio'];

function cargarEnChips_(p) {
  if (!p || typeof p.docId !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(p.docId)) return { ok: false, error: 'falta docId (un id de Drive)' };
  if (typeof p.tanda !== 'number' || p.tanda !== Math.floor(p.tanda) || p.tanda < 0 || p.tanda > 99) return { ok: false, error: 'tanda inválida (un número de 0 a 99; 0 = la elige el puente)' };
  if (typeof p.clave !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(p.clave)) return { ok: false, error: 'clave inválida (letras, números, _ . : - y hasta 100 caracteres)' };
  if (!Array.isArray(p.guiones) || !p.guiones.length || p.guiones.length > CHIPS_MAX_GUIONES) return { ok: false, error: 'guiones inválidos (de 1 a ' + CHIPS_MAX_GUIONES + ')' };
  var vistos = {};
  for (var i = 0; i < p.guiones.length; i++) {
    var g = p.guiones[i];
    if (!g || typeof g.numero !== 'number' || g.numero !== Math.floor(g.numero) || g.numero < 1 || g.numero > CHIPS_MAX_GUIONES || vistos[g.numero]) return { ok: false, error: 'guion ' + (i + 1) + ': número inválido o repetido' };
    vistos[g.numero] = true;
    if (!Array.isArray(g.parrafos) || !g.parrafos.length || g.parrafos.length > CHIPS_MAX_PARRAFOS) return { ok: false, error: 'guion ' + g.numero + ': párrafos inválidos' };
    for (var j = 0; j < g.parrafos.length; j++) {
      var x = g.parrafos[j];
      if (!x || CHIPS_TIPOS.indexOf(x.tipo) < 0 || typeof x.texto !== 'string' || x.texto.length > CHIPS_MAX_TEXTO) return { ok: false, error: 'guion ' + g.numero + ', párrafo ' + (j + 1) + ': tipo o texto inválido' };
    }
  }
  var f = DriveApp.getFileById(p.docId);
  if (f.isTrashed()) return { ok: false, error: 'el doc está en la papelera' };
  if (f.getMimeType() !== MimeType.GOOGLE_DOCS) return { ok: false, error: 'no es un Google Doc' };
  if (f.getName().indexOf(PREFIJO_DOC_GUIONES) !== 0) return { ok: false, error: 'solo se escribe en docs cuyo nombre empieza con "' + PREFIJO_DOC_GUIONES + '"' };
  var candado = LockService.getScriptLock();
  if (!candado.tryLock(30000)) return { ok: false, error: 'el puente está ocupado con otra tanda: probá de nuevo en un rato' };
  try {
    var doc = DocumentApp.openById(p.docId);
    var body = doc.getBody();
    var guiones = p.guiones.slice().sort(function (a, b) { return a.numero - b.numero; });
    var maximo = guiones[guiones.length - 1].numero;
    var tanda = p.tanda || elegirTandaChips_(doc, body, p.clave), creada = false;
    if (!tanda && !p.tanda) {
      // 5/11/2026 (Tomás: «que la pueda armar el bot de una»): sin tanda libre, se agrega la siguiente al final del Doc
      tanda = crearTandaChips_(body, maximo);
      creada = !!tanda;
    }
    if (!tanda) return { ok: false, error: 'el doc no tiene ninguna «TANDA N°» con chips «Video:» para copiar: agregá una tanda nueva en el Doc' };
    var plan = tandaChips_(body, tanda);
    if (!plan) return { ok: false, error: 'el doc no tiene el título «TANDA ' + tanda + '°»' };
    if (!plan.chips.length) return { ok: false, error: 'la TANDA ' + tanda + '° no tiene ningún chip «Video:»' };
    // 1) Antes de tocar nada: cada chip que se va a usar tiene que estar vacío o ser del bot
    for (var k = 0; k < guiones.length; k++) {
      var n = guiones[k].numero;
      if (n <= plan.chips.length && estadoChip_(doc, body, plan, n, p.clave) === 'ajeno') {
        return { ok: false, error: 'debajo del video ' + n + ' de la TANDA ' + tanda + '° ya hay texto que no cargó el bot: no se tocó nada' };
      }
    }
    // 2) Los chips que falten (copias del último de la tanda, con su renglón vacío adelante)
    var agregados = 0;
    while (plan.chips.length < maximo) {
      var ultimo = body.getChild(plan.chips[plan.chips.length - 1]).asListItem();
      body.insertParagraph(plan.fin, '');
      body.insertListItem(plan.fin + 1, ultimo.copy());
      agregados++;
      plan = tandaChips_(body, tanda);
    }
    // 3) De abajo hacia arriba: lo que se escribe bajo un chip no mueve a los de arriba.
    //    11/11/2026 (Tomás): PRIMERO se escribe todo lo nuevo (justo debajo de cada chip, arriba de lo viejo) y RECIÉN
    //    DESPUÉS se borra lo viejo de esa tanda. Si algo falla escribiendo, se saca lo nuevo y el Doc queda como estaba.
    var escritos = [];
    try {
      for (var m = guiones.length - 1; m >= 0; m--) escritos.push(escribirBajoChip_(doc, body, tanda, guiones[m], p.clave));
    } catch (err) {
      escritos.forEach(function (w) { w.nuevos.slice().reverse().forEach(function (el) { quitarParrafoChips_(body, el); }); });
      return { ok: false, error: 'no se pudo escribir la tanda (el Doc quedó como estaba): ' + String(err && err.message || err).slice(0, 200) };
    }
    var reemplazados = 0;
    escritos.forEach(function (w) {
      w.viejos.forEach(function (r) {
        r.getRange().getRangeElements().forEach(function (re) { quitarParrafoChips_(body, re.getElement()); });
        r.remove();
      });
      doc.addNamedRange(w.nombre, w.rango.build());
      if (w.viejos.length) reemplazados++;
    });
    doc.saveAndClose();
    // Los chips de la tanda nueva son copias de otro (pueden venir en «Grabado completo»): vuelven a «No iniciado»
    var reiniciados = creada ? reiniciarChipsTanda_(p.docId, tanda) : null;
    // 9/11/2026: el ancla del título de la tanda, para que el link al cliente vaya directo a «TANDA N°» (null si no se pudo)
    var ancla = anclaTanda_(p.docId, tanda);
    return { ok: true, id: f.getId(), url: f.getUrl(), yaExistia: false, tanda: tanda, creada: creada, reiniciados: reiniciados, cargados: guiones.length, agregados: agregados, reemplazados: reemplazados, ancla: ancla };
  } finally {
    candado.releaseLock();
  }
}

// La tanda en el cuerpo del doc: dónde están sus chips «Video:» y dónde termina (el próximo «TANDA N°» o el final).
// null si no está el título. Toma «TANDA 1°», «TANDA 1º», «TANDA 1:» o «TANDA 1», con cualquier estilo de párrafo.
function tandaChips_(body, tanda) {
  var esTanda = /^\s*TANDA\s+(\d+)\s*[°º:]?\s*$/i, ini = -1, fin = body.getNumChildren(), chips = [];
  for (var i = 0; i < body.getNumChildren(); i++) {
    var el = body.getChild(i), tipo = el.getType();
    if (tipo === DocumentApp.ElementType.PARAGRAPH) {
      var t = esTanda.exec(el.asParagraph().getText());
      if (!t) continue;
      if (ini < 0) { if (Number(t[1]) === tanda) ini = i; } else { fin = i; break; }
    } else if (ini >= 0 && tipo === DocumentApp.ElementType.LIST_ITEM && /^\s*Video\b/i.test(el.asListItem().getText())) {
      chips.push(i);
    }
  }
  return ini < 0 ? null : { ini: ini, fin: fin, chips: chips };
}

// tanda 0: la que ya cargó el bot con esta clave o, si no, la primera con todos sus chips vacíos. 0 si no hay ninguna.
function elegirTandaChips_(doc, body, clave) {
  var nums = [], esTanda = /^\s*TANDA\s+(\d+)\s*[°º:]?\s*$/i;
  for (var i = 0; i < body.getNumChildren(); i++) {
    var el = body.getChild(i);
    if (el.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
    var t = esTanda.exec(el.asParagraph().getText());
    if (t && nums.indexOf(Number(t[1])) < 0) nums.push(Number(t[1]));
  }
  var libre = 0;
  for (var k = 0; k < nums.length; k++) {
    var plan = tandaChips_(body, nums[k]);
    if (!plan.chips.length) continue;
    var estados = plan.chips.map(function (_, j) { return estadoChip_(doc, body, plan, j + 1, clave); });
    if (estados.indexOf('bot') >= 0) return nums[k];
    if (!libre && estados.every(function (e) { return e === 'vacio'; }) && !textoFueraDeChips_(body, plan)) libre = nums[k];
  }
  return libre;
}

// 11/11/2026 (Doc de A151): una tanda puede tener guiones viejos cargados a mano con el «Video:» como título y no como renglón
// con viñeta. Esos no cuentan como chips, pero la tanda NO está libre: si hay texto en la tanda fuera de las zonas de los chips
// (entre el título y el primer chip), se considera ocupada.
function textoFueraDeChips_(body, plan) {
  var hasta = plan.chips.length ? plan.chips[0] : plan.fin;
  for (var i = plan.ini + 1; i < hasta; i++) {
    var el = body.getChild(i);
    if (el.getType() !== DocumentApp.ElementType.PARAGRAPH || el.asParagraph().getText().trim()) return true;
  }
  return false;
}

// Agrega al final del doc la tanda siguiente a la más alta, con el mismo formato: copia del título «TANDA N°» de la última
// tanda (con el número nuevo) y <cantidad> copias de su último chip «Video:», separados por un renglón vacío como en la
// plantilla. Devuelve el número nuevo o 0 si el doc no tiene ninguna tanda con chips para copiar (no toca nada).
function crearTandaChips_(body, cantidad) {
  var esTanda = /^\s*TANDA\s+(\d+)\s*[°º:]?\s*$/i, mayor = 0, titulo = null, chip = null;
  for (var i = 0; i < body.getNumChildren(); i++) {
    var el = body.getChild(i);
    if (el.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
    var t = esTanda.exec(el.asParagraph().getText());
    if (t && Number(t[1]) >= mayor) {
      var plan = tandaChips_(body, Number(t[1]));
      if (plan && plan.chips.length) { mayor = Number(t[1]); titulo = el.asParagraph(); chip = body.getChild(plan.chips[plan.chips.length - 1]).asListItem(); }
    }
  }
  if (!titulo || !chip) return 0;
  var nueva = mayor + 1;
  body.appendParagraph('').setHeading(DocumentApp.ParagraphHeading.NORMAL);
  var nuevoTitulo = body.appendParagraph(titulo.copy());
  nuevoTitulo.replaceText('\\d+', String(nueva));
  for (var k = 0; k < Math.max(1, cantidad); k++) {
    if (k > 0) body.appendParagraph('').setHeading(DocumentApp.ParagraphHeading.NORMAL);
    body.appendListItem(chip.copy());
  }
  body.appendParagraph('').setHeading(DocumentApp.ParagraphHeading.NORMAL);
  return nueva;
}

// El id del título «TANDA N°» (Docs API: headingId) y de su pestaña, para armar «…/edit?tab=t.0#heading=h.xxx». Nunca tira:
// sin ancla el link va al Doc entero.
function anclaTanda_(docId, tanda) {
  try {
    var d = Docs.Documents.get(docId, { includeTabsContent: true });
    var tab = d.tabs && d.tabs[0];
    if (!tab || !tab.documentTab) return null;
    var esTanda = /^\s*TANDA\s+(\d+)\s*[°º:]?\s*$/i, hallado = null;
    (tab.documentTab.body.content || []).forEach(function (se) {
      if (hallado || !se.paragraph) return;
      var texto = (se.paragraph.elements || []).map(function (e) { return e.textRun ? e.textRun.content : ''; }).join('');
      var t = esTanda.exec(texto);
      var h = se.paragraph.paragraphStyle && se.paragraph.paragraphStyle.headingId;
      if (t && Number(t[1]) === tanda && h) hallado = h;
    });
    return hallado ? { tab: (tab.tabProperties && tab.tabProperties.tabId) || null, heading: hallado } : null;
  } catch (err) {
    return null;
  }
}

// Pone en «No iniciado» los chips de la tanda (Docs API, como GuionesEstadoChips.gs). Solo para una tanda que acaba de crear
// el bot. Devuelve cuántos cambió, o un texto con el error (la carga ya quedó hecha: el estado se corrige a mano).
function reiniciarChipsTanda_(docId, tanda) {
  try {
    var d = Docs.Documents.get(docId, { includeTabsContent: true });
    var tab = d.tabs && d.tabs[0];
    if (!tab || !tab.documentTab) return 'el doc no tiene pestañas legibles';
    var defs = tab.documentTab.dropdownDefinitions || {}, pedidos = [];
    chipsDeTandaApi_(tab.documentTab.body.content || [], tanda).forEach(function (c) {
      if (c.valor === CHIPS_ESTADO_DESDE) return;
      var opcion = opcionChips_(defs[c.definicion], CHIPS_ESTADO_DESDE);
      if (opcion) pedidos.push({ updateDropdownProperties: { dropdownId: c.id, tabId: tab.tabProperties.tabId, dropdownProperties: { selectedOptionId: opcion }, fields: 'selectedOptionId' } });
    });
    if (pedidos.length) Docs.Documents.batchUpdate({ requests: pedidos }, docId);
    return pedidos.length;
  } catch (err) {
    return 'no se pudieron reiniciar los chips: ' + String(err && err.message || err).slice(0, 200);
  }
}

// Lo que hay debajo del chip n (1 = el primero): de su renglón al próximo chip o al final de la tanda.
function zonaChip_(plan, n) {
  return { desde: plan.chips[n - 1] + 1, hasta: n < plan.chips.length ? plan.chips[n] : plan.fin };
}

function nombreChips_(clave, n) { return 'cjg|' + clave + '|' + n; }

// 'bot' (lo cargó el bot con esta clave DEBAJO de este chip), 'vacio' (solo renglones vacíos) o 'ajeno' (una persona escribió).
function estadoChip_(doc, body, plan, n, clave) {
  var z = zonaChip_(plan, n), rangos = doc.getNamedRanges(nombreChips_(clave, n));
  for (var r = 0; r < rangos.length; r++) {
    var els = rangos[r].getRange().getRangeElements();
    if (!els.length) continue;
    var idx = -1;
    try { idx = body.getChildIndex(els[0].getElement()); } catch (err) { /* ya no está en el cuerpo */ }
    if (idx >= z.desde && idx < z.hasta) return 'bot';
  }
  for (var i = z.desde; i < z.hasta; i++) {
    var el = body.getChild(i);
    if (el.getType() !== DocumentApp.ElementType.PARAGRAPH || el.asParagraph().getText().trim()) return 'ajeno';
  }
  return 'vacio';
}

// Escribe el guion justo debajo de su chip (arriba de lo que hubiera). NO borra nada: devuelve los párrafos nuevos, los rangos
// viejos del bot con esta clave (se borran después, cuando todo lo nuevo ya quedó escrito) y el rango nuevo. Si falla a mitad
// de un guion, saca lo que alcanzó a escribir de ESE guion antes de tirar el error.
function escribirBajoChip_(doc, body, tanda, g, clave) {
  var nombre = nombreChips_(clave, g.numero), viejos = doc.getNamedRanges(nombre);
  var plan = tandaChips_(body, tanda);
  var idx = plan.chips[g.numero - 1] + 1, rango = doc.newRange(), nuevos = [];
  try {
    g.parrafos.forEach(function (x) {
      var par = body.insertParagraph(idx++, x.texto);
      nuevos.push(par);
      par.setHeading(DocumentApp.ParagraphHeading.NORMAL);
      formatoChips_(par, x.tipo);
      rango.addElement(par);
    });
  } catch (err) {
    nuevos.slice().reverse().forEach(function (el) { quitarParrafoChips_(body, el); });
    throw err;
  }
  return { nombre: nombre, viejos: viejos, nuevos: nuevos, rango: rango };
}

// Saca un párrafo del cuerpo. El último párrafo del documento no se puede borrar, y vaciarlo con setText('') tira «No se puede
// insertar un elemento vacío de texto» (11/11/2026, Doc de A117): ese se vacía con deleteText, y si ya está vacío se deja.
function quitarParrafoChips_(body, el) {
  try {
    if (!el.getParent()) return;
    if (body.getChildIndex(el) < body.getNumChildren() - 1) { el.removeFromParent(); return; }
    var t = el.editAsText(), s = t.getText();
    if (s.length) t.deleteText(0, s.length - 1);
  } catch (err) { /* ya no está en el cuerpo */ }
}

// Como en los Docs cargados a mano: sección en negrita, indicación resaltada en rosa, el gesto del CTA resaltado; lo demás
// sin negrita, sin cursiva y sin resaltar (un párrafo nuevo puede heredar el formato del vecino).
function formatoChips_(par, tipo) {
  var t = par.editAsText(), s = t.getText();
  if (!s.length) return;
  t.setBold(tipo === 'seccion');
  t.setItalic(false);
  t.setBackgroundColor(tipo === 'indicacion' ? CHIPS_COLOR_INDICACION : null);
  var i = tipo === 'texto' ? s.indexOf(CHIPS_GESTO) : -1;
  if (i >= 0) t.setBackgroundColor(i, i + CHIPS_GESTO.length - 1, CHIPS_COLOR_INDICACION);
}
