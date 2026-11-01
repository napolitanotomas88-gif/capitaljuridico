/**
 * Puente Drive · Despacho Capital Jurídico (versión en VERSION)
 * Corre con la cuenta del administrador que publica el puente. Le permite al bot del Despacho:
 *   - subir el comprobante de pago a "DFY - SKWD / Subidos"
 *   - crear la carpeta del cliente y sus subcarpetas (Crudos, Editados) con crearCarpeta
 *   - crear el doc de bienvenida
 *   - copiar la plantilla de guiones como "Guiones - X" (un Google Doc) en la carpeta del cliente (24/10/2026). Solo
 *     copia archivos cuyo nombre empieza con "Plantilla": frena que se copie el "Guiones - X" de un cliente.
 *   - mandar a la papelera: archivos de "Subidos" o de una carpeta de prueba, y carpetas de prueba ("PRUEBA BOT…")
 *   - agregar una tanda de guiones al final del doc "Guiones - X" de un cliente con agregarTanda (25/10/2026). Solo en docs
 *     cuyo nombre empieza con "Guiones - "; idempotente por la clave (marcador "[tanda:<clave>]" chico y gris al final).
 *   - quitarle al cliente (y a sus socios) el acceso a su carpeta "<Nombre> - C.J" con quitarAccesoCliente (26/10/2026, etapa
 *     Bajas): saca a esos correos como editores o lectores; la carpeta y su contenido quedan intactos. Nunca saca al dueño,
 *     al correo de organización configurado ni a una cuenta de servicio. Si la carpeta es "cualquiera con el enlace", NO lo cambia: lo informa.
 * Solo responde si el pedido trae la clave secreta del Despacho. La clave NO está en este archivo: se guarda en las
 * propiedades del proyecto (⚙ Configuración del proyecto → Propiedades de la secuencia de comandos → SECRETO), con el
 * mismo valor que PUENTE_DRIVE_SECRETO de .env.local. Sin esa propiedad, el puente rechaza todo.
 * Al buscar "si ya existe", lo que está en la papelera no cuenta (los iteradores de DriveApp también lo devuelven).
 * (24/10/2026) Se quitó crearCarpetaCliente: creaba "Guiones - X" como carpeta y la convención es un Google Doc.
 * Apps Script junta todos los .gs del proyecto en un solo espacio de nombres (está también Vigia.gs): los nombres nuevos
 * de acá no pueden repetir ninguno de allá (scripts/test-puente-vigia.mjs y scripts/test-puente-drive.mjs lo controlan).
 */
var VERSION = '2026-10-26a';
var PREFIJO_PRUEBA = 'PRUEBA BOT';
var PREFIJO_PLANTILLA = 'Plantilla';
var CARPETA_COMPROBANTES = String(PropertiesService.getScriptProperties().getProperty('DRIVE_CARPETA_COMPROBANTES') || '').trim();
var PREFIJO_DOC_GUIONES = 'Guiones - ';
var TANDA_MAX_BLOQUES = 600;
var TANDA_MAX_TEXTO = 5000;
var TANDA_COLOR_MARCA = '#bbbbbb';
var TANDA_TAMANO_MARCA = 8;
var SUFIJO_CARPETA_CLIENTE = ' - C.J';
var CORREO_SKYWARD = String(PropertiesService.getScriptProperties().getProperty('PUENTE_CORREO_ORGANIZACION') || '').trim().toLowerCase();
var ACCESO_MAX_CORREOS = 20;

function doPost(e) {
  var p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return resp_({ ok: false, error: 'JSON inválido' }); }
  var secreto = PropertiesService.getScriptProperties().getProperty('SECRETO');
  if (!secreto) return resp_({ ok: false, error: 'no autorizado (al puente le falta la propiedad SECRETO)' });
  if (!p || typeof p.secreto !== 'string' || p.secreto !== secreto) return resp_({ ok: false, error: 'no autorizado' });
  // Una instalación incompleta no realiza operaciones de Drive ni de permisos. Ping queda disponible para diagnóstico.
  if (p.accion !== 'ping' && !/^[A-Za-z0-9_-]{20,100}$/.test(CARPETA_COMPROBANTES)) return resp_({ ok: false, error: 'falta DRIVE_CARPETA_COMPROBANTES configurada' });
  if (p.accion !== 'ping' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(CORREO_SKYWARD)) return resp_({ ok: false, error: 'falta PUENTE_CORREO_ORGANIZACION configurado' });
  try {
    switch (p.accion) {
      case 'ping': return resp_({ ok: true, cuenta: Session.getEffectiveUser().getEmail(), version: VERSION });
      case 'subirArchivo': return resp_(subirArchivo_(p));
      case 'crearCarpeta': return resp_(crearCarpeta_(p.padreId, p.nombre));
      case 'crearDoc': return resp_(crearDoc_(p));
      case 'aPapelera': return resp_(aPapelera_(p.id));
      case 'copiarArchivo': return resp_(copiarArchivo_(p));
      case 'aPapeleraCarpeta': return resp_(aPapeleraCarpeta_(p.id));
      case 'agregarTanda': return resp_(agregarTanda_(p));
      case 'cargarEnChips': return resp_(cargarEnChips_(p));
      case 'estadoChips': return resp_(estadoChips_(p));
      case 'quitarAccesoCliente': return resp_(quitarAccesoCliente_(p));
      default: return resp_({ ok: false, error: 'acción desconocida: ' + p.accion });
    }
  } catch (err) {
    return resp_({ ok: false, error: String(err && err.message || err) });
  }
}

function resp_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Primer archivo o carpeta del iterador que NO esté en la papelera (null si no hay).
function primeroNoBorrado_(it) {
  while (it.hasNext()) { var x = it.next(); if (!x.isTrashed()) return x; }
  return null;
}

// Sube un archivo (base64) a una carpeta. Si ya existe uno con el mismo nombre, no lo duplica.
function subirArchivo_(p) {
  var carpeta = DriveApp.getFolderById(p.carpetaId);
  var f0 = primeroNoBorrado_(carpeta.getFilesByName(p.nombre));
  if (f0) return { ok: true, id: f0.getId(), url: f0.getUrl(), yaExistia: true };
  var blob = Utilities.newBlob(Utilities.base64Decode(p.base64), p.mimeType || 'application/octet-stream', p.nombre);
  var f = carpeta.createFile(blob);
  return { ok: true, id: f.getId(), url: f.getUrl(), yaExistia: false };
}

// Crea una carpeta dentro de otra; si ya existe con ese nombre, devuelve la existente.
function crearCarpeta_(padreId, nombre) {
  var padre = DriveApp.getFolderById(padreId);
  var c0 = primeroNoBorrado_(padre.getFoldersByName(nombre));
  if (c0) return { ok: true, id: c0.getId(), url: c0.getUrl(), yaExistia: true };
  var c = padre.createFolder(nombre);
  return { ok: true, id: c.getId(), url: c.getUrl(), yaExistia: false };
}

// Crea un Google Doc en una carpeta a partir de bloques simples:
// [{tipo:'titulo'|'subtitulo'|'parrafo'|'lista', texto:'...'}]
function crearDoc_(p) {
  var carpeta = DriveApp.getFolderById(p.carpetaId);
  var f0 = primeroNoBorrado_(carpeta.getFilesByName(p.nombre));
  if (f0) return { ok: true, id: f0.getId(), url: f0.getUrl(), yaExistia: true };
  var doc = DocumentApp.create(p.nombre);
  var body = doc.getBody();
  body.clear();
  (p.bloques || []).forEach(function (b) {
    if (b.tipo === 'titulo') body.appendParagraph(b.texto).setHeading(DocumentApp.ParagraphHeading.HEADING1);
    else if (b.tipo === 'subtitulo') body.appendParagraph(b.texto).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    else if (b.tipo === 'lista') body.appendListItem(b.texto).setGlyphType(DocumentApp.GlyphType.BULLET);
    else body.appendParagraph(b.texto);
  });
  // Identidad de Capital Jurídico (BienvenidaMarca.gs, 31/10/2026): solo con estilo 'cj'. Si falla, el doc queda creado
  // igual, sin marca, y se avisa en avisoMarca
  var marca = p.estilo === 'cj', avisoMarca = null;
  if (marca) { try { marcaCjEnDoc_(doc); } catch (e) { avisoMarca = String(e).slice(0, 160); } }
  doc.saveAndClose();
  var archivo = DriveApp.getFileById(doc.getId());
  archivo.moveTo(carpeta);
  if (marca && !avisoMarca) { try { marcaCjConApi_(doc.getId()); } catch (e) { avisoMarca = String(e).slice(0, 160); } }
  var res = { ok: true, id: archivo.getId(), url: archivo.getUrl(), yaExistia: false };
  if (avisoMarca) res.avisoMarca = avisoMarca;
  return res;
}

// Manda un archivo a la papelera (se recupera 30 días). Solo si está en "Subidos" (los comprobantes: el bot deshace una
// carga a medias) o dentro de una carpeta de prueba ("PRUEBA BOT…"). Cualquier otro archivo se rechaza (por ejemplo,
// los "Guiones - X" de los clientes).
function aPapelera_(id) {
  var f = DriveApp.getFileById(id);
  if (!enSubidosOPrueba_(f)) return { ok: false, error: 'solo se mandan a la papelera archivos de "Subidos" o de una carpeta "' + PREFIJO_PRUEBA + '…"' };
  f.setTrashed(true);
  return { ok: true };
}

// ¿El archivo está directamente en "Subidos" o en una carpeta cuyo nombre empieza con "PRUEBA BOT"?
function enSubidosOPrueba_(f) {
  var padres = f.getParents();
  while (padres.hasNext()) {
    var c = padres.next();
    if (c.getId() === CARPETA_COMPROBANTES || c.getName().indexOf(PREFIJO_PRUEBA) === 0) return true;
  }
  return false;
}

// Copia la plantilla de guiones a una carpeta con otro nombre ("Guiones - ClaudiaR"). Solo copia archivos cuyo nombre
// empieza con "Plantilla" ("Plantilla Guiones - C.J"). Si en la carpeta ya hay un archivo con ese nombre, devuelve ese
// y no lo duplica. Sin archivoId, carpetaId o nombre, responde el error sin tocar Drive.
function copiarArchivo_(p) {
  if (!p.archivoId || !p.carpetaId || !p.nombre) return { ok: false, error: 'faltan archivoId, carpetaId o nombre' };
  var origen = DriveApp.getFileById(p.archivoId);
  if (origen.getName().indexOf(PREFIJO_PLANTILLA) !== 0) return { ok: false, error: 'solo se copian plantillas (el nombre del archivo tiene que empezar con "' + PREFIJO_PLANTILLA + '")' };
  var carpeta = DriveApp.getFolderById(p.carpetaId);
  var f0 = primeroNoBorrado_(carpeta.getFilesByName(p.nombre));
  if (f0) return { ok: true, id: f0.getId(), url: f0.getUrl(), yaExistia: true };
  var copia = origen.makeCopy(p.nombre, carpeta);
  return { ok: true, id: copia.getId(), url: copia.getUrl(), yaExistia: false };
}

// Solo para limpiar las pruebas del bot: manda a la papelera una carpeta (con lo que tenga adentro) si su nombre
// empieza con "PRUEBA BOT". Cualquier otra carpeta se rechaza. Se recupera desde la papelera durante 30 días.
function aPapeleraCarpeta_(id) {
  var c = DriveApp.getFolderById(id);
  if (c.getName().indexOf(PREFIJO_PRUEBA) !== 0) return { ok: false, error: 'solo se mandan a la papelera carpetas de prueba (el nombre tiene que empezar con "' + PREFIJO_PRUEBA + '")' };
  c.setTrashed(true);
  return { ok: true };
}

// Agrega una tanda de guiones AL FINAL del Google Doc "Guiones - X" de un cliente (lo usa lib/bot/guiones/envio.ts).
// Cuerpo: { docId, clave, bloques: [{ tipo: 'titulo'|'subtitulo'|'parrafo'|'indicacion', texto }] } ('indicacion' = párrafo en
// cursiva). Solo escribe en docs cuyo nombre empieza con "Guiones - " (no en la plantilla ni en cualquier otro archivo).
// Idempotente por la clave: si el doc ya tiene "[tanda:<clave>]", no escribe nada y devuelve yaExistia: true; si no, escribe
// los bloques y al final el marcador, chico y gris. Con el candado del script: dos pedidos iguales a la vez (un reintento
// mientras el primero sigue corriendo) no la escriben dos veces. Valida todo ANTES de tocar el doc.
function agregarTanda_(p) {
  if (!p.docId || typeof p.docId !== 'string') return { ok: false, error: 'falta docId' };
  if (typeof p.clave !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(p.clave)) return { ok: false, error: 'clave inválida (letras, números, _ . : - y hasta 100 caracteres)' };
  if (!Array.isArray(p.bloques) || !p.bloques.length) return { ok: false, error: 'faltan bloques' };
  if (p.bloques.length > TANDA_MAX_BLOQUES) return { ok: false, error: 'demasiados bloques (máximo ' + TANDA_MAX_BLOQUES + ')' };
  for (var i = 0; i < p.bloques.length; i++) {
    var b = p.bloques[i];
    if (!b || ['titulo', 'subtitulo', 'parrafo', 'indicacion'].indexOf(b.tipo) < 0) return { ok: false, error: 'bloque ' + (i + 1) + ': tipo inválido (titulo, subtitulo, parrafo o indicacion)' };
    if (typeof b.texto !== 'string' || b.texto.length > TANDA_MAX_TEXTO) return { ok: false, error: 'bloque ' + (i + 1) + ': texto inválido (hasta ' + TANDA_MAX_TEXTO + ' caracteres)' };
  }
  var f = DriveApp.getFileById(p.docId);
  if (f.isTrashed()) return { ok: false, error: 'el doc está en la papelera' };
  if (f.getMimeType() !== MimeType.GOOGLE_DOCS) return { ok: false, error: 'no es un Google Doc' };
  if (f.getName().indexOf(PREFIJO_DOC_GUIONES) !== 0) return { ok: false, error: 'solo se escribe en docs cuyo nombre empieza con "' + PREFIJO_DOC_GUIONES + '"' };
  var marca = '[tanda:' + p.clave + ']';
  var candado = LockService.getScriptLock();
  if (!candado.tryLock(30000)) return { ok: false, error: 'el puente está ocupado con otra tanda: probá de nuevo en un rato' };
  try {
    var doc = DocumentApp.openById(p.docId);
    var body = doc.getBody();
    if (body.getText().indexOf(marca) >= 0) return { ok: true, id: f.getId(), url: f.getUrl(), yaExistia: true };
    p.bloques.forEach(function (b) {
      var par = body.appendParagraph(b.texto);
      par.setHeading(b.tipo === 'titulo' ? DocumentApp.ParagraphHeading.HEADING1 : b.tipo === 'subtitulo' ? DocumentApp.ParagraphHeading.HEADING2 : DocumentApp.ParagraphHeading.NORMAL);
      formatoTandaLimpio_(par, b.tipo === 'indicacion');
    });
    var pie = body.appendParagraph(marca);
    pie.setHeading(DocumentApp.ParagraphHeading.NORMAL);
    var t = pie.editAsText();
    t.setItalic(false);
    t.setForegroundColor(TANDA_COLOR_MARCA);
    t.setFontSize(TANDA_TAMANO_MARCA);
    doc.saveAndClose();
    return { ok: true, id: f.getId(), url: f.getUrl(), yaExistia: false };
  } finally {
    candado.releaseLock();
  }
}

// Un párrafo nuevo hereda el formato del último del doc (por ejemplo, el marcador gris de 8 pt de la tanda anterior): se
// limpia color y tamaño (vuelven a los del estilo del párrafo) y la cursiva queda solo en las indicaciones. La negrita no se
// toca: la ponen los estilos de título de la plantilla.
function formatoTandaLimpio_(par, cursiva) {
  var t = par.editAsText();
  if (!t.getText().length) return;
  t.setItalic(cursiva);
  // null = "el del estilo"; si Apps Script no lo acepta o lo ignora y quedó lo del marcador, se pone a mano
  try { t.setForegroundColor(null); } catch (err) { /* abajo */ }
  if (t.getForegroundColor() === TANDA_COLOR_MARCA) t.setForegroundColor('#000000');
  try { t.setFontSize(null); } catch (err) { /* abajo */ }
  if (t.getFontSize() === TANDA_TAMANO_MARCA) t.setFontSize(11);
}

// Para probar a mano desde el editor: Ejecutar → probar (dice si la propiedad SECRETO está cargada, sin mostrarla)
// Le quita al cliente (y a sus socios) el acceso a SU carpeta (lo usa lib/bot/bajas al confirmar una baja).
// Cuerpo: { carpetaId, correos: [..] }. Solo carpetas "<Nombre> - C.J" (o de prueba "PRUEBA BOT…"). Saca cada correo como
// editor o lector; la carpeta y su contenido quedan intactos. Nunca saca al dueño, al correo de organización configurado, a la cuenta que corre
// el script ni a una cuenta de servicio (…gserviceaccount.com): esos van a "protegidos". Idempotente: un correo que ya no
// tenía acceso va a "noTenian". El acceso general ("cualquiera con el enlace" o del dominio) NO se cambia: se devuelve en
// "acceso" y "enlacePublico" para que lo decida una persona. Valida todo antes de tocar la carpeta.
function quitarAccesoCliente_(p) {
  if (!p || typeof p.carpetaId !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(p.carpetaId)) return { ok: false, error: 'falta carpetaId (un id de Drive)' };
  if (!Array.isArray(p.correos) || !p.correos.length) return { ok: false, error: 'faltan los correos' };
  if (p.correos.length > ACCESO_MAX_CORREOS) return { ok: false, error: 'demasiados correos (máximo ' + ACCESO_MAX_CORREOS + ')' };
  var correos = [];
  for (var i = 0; i < p.correos.length; i++) {
    var co = typeof p.correos[i] === 'string' ? p.correos[i].trim().toLowerCase() : '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(co)) return { ok: false, error: 'correo inválido en la posición ' + (i + 1) };
    if (correos.indexOf(co) < 0) correos.push(co);
  }
  var c = DriveApp.getFolderById(p.carpetaId);
  if (c.isTrashed()) return { ok: false, error: 'la carpeta está en la papelera' };
  var nombre = c.getName();
  var esCliente = nombre.length > SUFIJO_CARPETA_CLIENTE.length && nombre.slice(-SUFIJO_CARPETA_CLIENTE.length) === SUFIJO_CARPETA_CLIENTE;
  if (!esCliente && nombre.indexOf(PREFIJO_PRUEBA) !== 0) return { ok: false, error: 'solo carpetas de cliente ("<Nombre>' + SUFIJO_CARPETA_CLIENTE + '") o de prueba' };
  var duenio = c.getOwner();
  var protegidosFijos = [CORREO_SKYWARD, String(Session.getEffectiveUser().getEmail() || '').toLowerCase()];
  if (duenio) protegidosFijos.push(String(duenio.getEmail() || '').toLowerCase());
  var mails = function (lista) { return lista.map(function (u) { return String(u.getEmail() || '').toLowerCase(); }); };
  var editores = mails(c.getEditors()), lectores = mails(c.getViewers());
  var quitados = [], noTenian = [], protegidos = [];
  correos.forEach(function (co) {
    if (protegidosFijos.indexOf(co) >= 0 || /gserviceaccount\.com$/.test(co)) { protegidos.push(co); return; }
    if (editores.indexOf(co) >= 0) { c.removeEditor(co); quitados.push({ correo: co, como: 'editor' }); return; }
    if (lectores.indexOf(co) >= 0) { c.removeViewer(co); quitados.push({ correo: co, como: 'lector' }); return; }
    noTenian.push(co);
  });
  var acceso = String(c.getSharingAccess());
  var enlacePublico = acceso === String(DriveApp.Access.ANYONE) || acceso === String(DriveApp.Access.ANYONE_WITH_LINK) || acceso === String(DriveApp.Access.DOMAIN_WITH_LINK) || acceso === String(DriveApp.Access.DOMAIN);
  return { ok: true, carpeta: nombre, quitados: quitados, noTenian: noTenian, protegidos: protegidos, acceso: acceso, enlacePublico: enlacePublico };
}

function probar() {
  Logger.log('Cuenta ejecutora disponible: ' + !!Session.getEffectiveUser().getEmail());
  Logger.log('SECRETO cargado: ' + !!PropertiesService.getScriptProperties().getProperty('SECRETO'));
}
