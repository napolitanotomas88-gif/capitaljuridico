/**
 * Estado de los chips de guiones · Puente Drive (31/10/2026, pedido de RESPONSABLE_HUB: «se pasa en el chip automático para grabar»)
 * Al dar el check final, los chips «Video:» de la tanda del bot pasan SOLOS de «No iniciado» a «Para grabar».
 * Apps Script (DocumentApp) no ve los chips desplegables, pero la Docs API sí: cada chip es un ParagraphElement.dropdown
 * { dropdownId, dropdownProperties: { dropdownDefinitionId, selectedOptionId, displayValue } } y las opciones están en
 * DocumentTab.dropdownDefinitions; se cambia con updateDropdownProperties (solo ese chip). Se usa el SERVICIO AVANZADO
 * «Google Docs API» de Apps Script (identificador Docs; en el editor: Servicios → +): habilita la API en el proyecto por
 * defecto y usa el permiso de documentos que el puente ya tiene (no hace falta UrlFetchApp ni script.external_request).
 * Acción estadoChips: { docId, tanda, cantidad, estado: 'Para grabar', soloLeer? }
 *   · Los chips son los de «TANDA <tanda>°» (la que usó cargarEnChips), en orden; se tocan los primeros <cantidad>.
 *   · Solo cambia los que están en «No iniciado» (nunca baja un «Grabado completo»). Idempotente.
 *   · soloLeer: true no cambia nada y devuelve los chips de la tanda y las opciones de su desplegable (diagnóstico).
 * En el switch de doPost de Codigo.gs:  case 'estadoChips': return resp_(estadoChips_(p));
 * Pruebas: scripts/test-puente-chips.mjs (servicio Docs de juguete).
 */
var CHIPS_ESTADO_DESDE = 'No iniciado';

function estadoChips_(p) {
  if (!p || typeof p.docId !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(p.docId)) return { ok: false, error: 'falta docId (un id de Drive)' };
  if (typeof p.tanda !== 'number' || p.tanda !== Math.floor(p.tanda) || p.tanda < 1 || p.tanda > 99) return { ok: false, error: 'tanda inválida (un número de 1 a 99)' };
  if (typeof p.cantidad !== 'number' || p.cantidad !== Math.floor(p.cantidad) || p.cantidad < 1 || p.cantidad > CHIPS_MAX_GUIONES) return { ok: false, error: 'cantidad inválida (de 1 a ' + CHIPS_MAX_GUIONES + ')' };
  if (typeof p.estado !== 'string' || !p.estado.trim() || p.estado.length > 200) return { ok: false, error: 'falta el estado (por ejemplo «Para grabar»)' };
  var f = DriveApp.getFileById(p.docId);
  if (f.isTrashed()) return { ok: false, error: 'el doc está en la papelera' };
  if (f.getName().indexOf(PREFIJO_DOC_GUIONES) !== 0) return { ok: false, error: 'solo se tocan docs cuyo nombre empieza con "' + PREFIJO_DOC_GUIONES + '"' };
  var d;
  try { d = Docs.Documents.get(p.docId, { includeTabsContent: true }); } catch (err) { return { ok: false, error: 'la Docs API no leyó el doc: ' + String(err && err.message || err).slice(0, 200) }; }
  var tab = d.tabs && d.tabs[0];
  if (!tab || !tab.documentTab) return { ok: false, error: 'el doc no tiene pestañas legibles' };
  var defs = tab.documentTab.dropdownDefinitions || {};
  var chips = chipsDeTandaApi_(tab.documentTab.body.content || [], p.tanda);
  var info = chips.map(function (c, i) { return { n: i + 1, valor: c.valor }; });
  if (p.soloLeer) return { ok: true, tanda: p.tanda, chips: info, definiciones: defs };
  if (chips.length < p.cantidad) return { ok: false, error: 'la TANDA ' + p.tanda + '° tiene ' + chips.length + ' chips y hacen falta ' + p.cantidad, chips: info };
  var pedidos = [], omitidos = [];
  for (var i = 0; i < p.cantidad; i++) {
    var c = chips[i];
    if (c.valor === p.estado) continue;
    if (c.valor !== CHIPS_ESTADO_DESDE) { omitidos.push({ n: i + 1, valor: c.valor }); continue; }
    var opcion = opcionChips_(defs[c.definicion], p.estado);
    if (!opcion) return { ok: false, error: 'el desplegable del chip ' + (i + 1) + ' no tiene la opción «' + p.estado + '»', definicion: defs[c.definicion] || null };
    pedidos.push({ updateDropdownProperties: { dropdownId: c.id, tabId: tab.tabProperties.tabId, dropdownProperties: { selectedOptionId: opcion }, fields: 'selectedOptionId' } });
  }
  if (pedidos.length) {
    try { Docs.Documents.batchUpdate({ requests: pedidos }, p.docId); } catch (err) { return { ok: false, error: 'la Docs API no cambió los chips: ' + String(err && err.message || err).slice(0, 300) }; }
  }
  return { ok: true, tanda: p.tanda, cambiados: pedidos.length, omitidos: omitidos };
}

// Los chips (dropdown) de «TANDA <tanda>°» en el contenido de la Docs API, en orden.
function chipsDeTandaApi_(content, tanda) {
  var actual = 0, out = [], esTanda = /^\s*TANDA\s+(\d+)\s*[°º:]?\s*$/i;
  content.forEach(function (se) {
    if (!se.paragraph) return;
    var els = se.paragraph.elements || [];
    var texto = els.map(function (e) { return e.textRun ? e.textRun.content : ''; }).join('');
    var t = esTanda.exec(texto);
    if (t) { actual = Number(t[1]); return; }
    if (actual !== tanda) return;
    els.forEach(function (e) {
      if (!e.dropdown) return;
      var pr = e.dropdown.dropdownProperties || {};
      out.push({ id: e.dropdown.dropdownId, definicion: pr.dropdownDefinitionId, valor: pr.displayValue || null });
    });
  });
  return out;
}

// El id de la opción cuyo texto es <estado> en una definición de desplegable. La forma exacta de la definición no está
// documentada del todo: se busca en cualquier lista de objetos un campo de texto igual al estado y se toma su id.
function opcionChips_(def, estado) {
  if (!def) return null;
  var buscado = estado.trim().toLowerCase(), hallado = null;
  (function recorrer(x) {
    if (hallado || !x || typeof x !== 'object') return;
    if (!Array.isArray(x)) {
      var textos = Object.keys(x).filter(function (k) { return typeof x[k] === 'string' && x[k].trim().toLowerCase() === buscado; });
      var id = x.optionId || x.dropdownOptionId || x.id;
      if (textos.length && typeof id === 'string' && /^dropdownItem\./.test(id)) { hallado = id; return; }
    }
    Object.keys(x).forEach(function (k) { recorrer(x[k]); });
  })(def);
  return hallado;
}
