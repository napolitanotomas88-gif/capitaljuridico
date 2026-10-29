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
    var tanda = p.tanda || elegirTandaChips_(doc, body, p.clave);
    if (!tanda) return { ok: false, error: 'el doc no tiene ninguna «TANDA N°» con todos los chips vacíos: agregá una tanda nueva en el Doc' };
    var plan = tandaChips_(body, tanda);
    if (!plan) return { ok: false, error: 'el doc no tiene el título «TANDA ' + tanda + '°»' };
    if (!plan.chips.length) return { ok: false, error: 'la TANDA ' + tanda + '° no tiene ningún chip «Video:»' };
    var guiones = p.guiones.slice().sort(function (a, b) { return a.numero - b.numero; });
    var maximo = guiones[guiones.length - 1].numero;
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
    // 3) De abajo hacia arriba: lo que se escribe bajo un chip no mueve a los de arriba
    var reemplazados = 0;
    for (var m = guiones.length - 1; m >= 0; m--) {
      if (escribirBajoChip_(doc, body, tanda, guiones[m], p.clave)) reemplazados++;
    }
    doc.saveAndClose();
    return { ok: true, id: f.getId(), url: f.getUrl(), yaExistia: false, tanda: tanda, cargados: guiones.length, agregados: agregados, reemplazados: reemplazados };
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
    if (!libre && estados.every(function (e) { return e === 'vacio'; })) libre = nums[k];
  }
  return libre;
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

// Escribe el guion debajo de su chip. Si el bot ya lo había cargado, primero borra eso (lo marcado por su rango con nombre).
// Devuelve si reemplazó.
function escribirBajoChip_(doc, body, tanda, g, clave) {
  var nombre = nombreChips_(clave, g.numero), viejos = doc.getNamedRanges(nombre), reemplazo = viejos.length > 0;
  viejos.forEach(function (r) {
    r.getRange().getRangeElements().forEach(function (re) {
      var el = re.getElement();
      if (el.getParent() && body.getChildIndex(el) < body.getNumChildren() - 1) el.removeFromParent();
      else if (el.getType() === DocumentApp.ElementType.PARAGRAPH) el.asParagraph().setText('');
    });
    r.remove();
  });
  var plan = tandaChips_(body, tanda);
  var idx = plan.chips[g.numero - 1] + 1, rango = doc.newRange();
  g.parrafos.forEach(function (x) {
    var par = body.insertParagraph(idx++, x.texto);
    par.setHeading(DocumentApp.ParagraphHeading.NORMAL);
    formatoChips_(par, x.tipo);
    rango.addElement(par);
  });
  doc.addNamedRange(nombre, rango.build());
  return reemplazo;
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
