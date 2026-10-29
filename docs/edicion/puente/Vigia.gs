/**
 * Vigía de Crudos · disparador del Puente Drive (archivo NUEVO "Vigia.gs" del proyecto de Apps Script, al lado de Código.gs)
 * Versión en VERSION_VIGIA. Corre a nombre de <EMAIL_PRIVADO_CONFIGURADO>, en el proyecto "Puente Drive · Despacho".
 *
 * Qué hace: cada 15 minutos, de 8:00 a 21:59 (hora de Argentina), le hace un POST al vigía del Despacho
 * (/api/bot/grabacion/vigia) con un secreto PROPIO (VIGIA_SECRETO). Hace falta porque el plan Hobby de Vercel solo permite
 * crons diarios. El vigía responde 202 enseguida y trabaja en segundo plano.
 *
 * Por qué un archivo aparte y no al final de Código.gs: Código.gs (VERSION 2026-10-24b) es de la sesión del bot de alta y
 * puede tener cambios sin publicar. Apps Script junta todos los .gs del proyecto en un solo espacio: por eso acá no se
 * repite ningún nombre de Código.gs (VERSION, probar, doPost, resp_…), todo lleva "Vigia" en el nombre.
 * Por qué un secreto propio y no CRON_SECRET: CRON_SECRET abre también /api/raw, que tiene teléfonos. VIGIA_SECRETO solo
 * dispara el vigía.
 *
 * ─── Cómo se instala (el orden importa) ──────────────────────────────────────────────────────────────────────────────
 * 1. Generar el secreto UNA vez y cargarlo en los tres lugares (ver docs/edicion/AVISOS.md → "Secretos"): en la Mac,
 *      S=$(openssl rand -hex 32); printf '\nVIGIA_SECRETO=%s\n' "$S" >> $APP_DIR \
 *      (cd $APP_DIR && printf %s "$S" | vercel env add VIGIA_SECRETO production); printf %s "$S" | pbcopy; unset S
 *    y pegarlo en Apps Script: ⚙ Configuración del proyecto → Propiedades de la secuencia de comandos → Agregar propiedad →
 *    nombre VIGIA_SECRETO, valor: pegar (Cmd+V) → Guardar. Es el mismo lugar donde ya está SECRETO, que NO se toca.
 * 2. En el editor: ＋ (Agregar un archivo) → Secuencia de comandos → nombre "Vigia". Pegar este archivo entero (copiarlo con
 *      LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pbcopy < docs/edicion/puente/Vigia.gs
 *    para que no se rompan los acentos) y guardar (Cmd+S). NO se toca Código.gs.
 * 3. Elegir la función probarVigia y tocar Ejecutar. El registro tiene que decir "VIGIA_SECRETO cargado: true" y lista los
 *    disparadores que ya tiene el proyecto (función y cantidad). Si aparece uno armado a mano que llama a OTRA función
 *    (por ejemplo, uno viejo del vigía), borrarlo a mano desde el reloj ⏰ (Activadores) de la izquierda.
 * 4. Recién cuando el Despacho esté publicado con la ruta del vigía Y con EDICION_MODO=real en Vercel (en modo dry el vigía
 *    responde 202 y no hace nada: correría cada 15 minutos sin guardar nada), elegir instalarDisparadorVigia y tocar
 *    Ejecutar UNA vez. Va a pedir permisos nuevos: "Conectarse a un servicio externo" (UrlFetchApp) y "Permitir que la
 *    aplicación se ejecute cuando no estás presente" (ScriptApp). Aceptar con la cuenta administradora configurada.
 *    Si appsscript.json tiene "oauthScopes" escritos a mano, sumar https://www.googleapis.com/auth/script.external_request
 *    y https://www.googleapis.com/auth/script.scriptapp.
 * 5. Listo. NO hace falta "Implementar → Nueva versión": el disparador corre el código GUARDADO. Publicar una versión nueva
 *    subiría además lo que tenga pendiente Código.gs (del bot de alta). La URL de la aplicación web no cambia.
 * Para apagarlo: ejecutar quitarDisparadorVigia. Si ya había un disparador de dispararVigia, instalar lo reemplaza (queda uno).
 *
 * Seguridad: el secreto nunca va en este archivo ni en un log (los mensajes dicen solo el código HTTP). La URL del vigía se
 * puede cambiar con la propiedad VIGIA_URL (por ejemplo, para un preview); sin ella, la del Despacho.
 */
var VERSION_VIGIA = '2026-10-24v1';
var VIGIA_URL_POR_DEFECTO = ''; // Configurar VIGIA_URL en Script Properties; nunca en Git.
var VIGIA_ZONA = 'America/Argentina/Buenos_Aires';
var VIGIA_DESDE = 8;     // 8:00
var VIGIA_HASTA = 22;    // hasta las 21:59
var VIGIA_CADA_MIN = 15;

/** La hora de Argentina (0–23). */
function horaArgentinaVigia_() {
  return Number(Utilities.formatDate(new Date(), VIGIA_ZONA, 'H'));
}

/** Lo llama el disparador cada 15 minutos. Fuera de horario o sin el secreto, no hace nada. */
function dispararVigia() {
  var h = horaArgentinaVigia_();
  if (h < VIGIA_DESDE || h >= VIGIA_HASTA) return;
  var props = PropertiesService.getScriptProperties();
  var secreto = props.getProperty('VIGIA_SECRETO');
  if (!secreto) { console.warn('vigía: falta la propiedad VIGIA_SECRETO (no se llamó al Despacho)'); return; }
  var url = props.getProperty('VIGIA_URL') || VIGIA_URL_POR_DEFECTO;
  if (!url) { console.warn('vigía: falta VIGIA_URL (sin llamada externa)'); return; }
  try {
    var r = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + secreto },
      payload: JSON.stringify({ origen: 'puente', version: VERSION_VIGIA }),
      muteHttpExceptions: true,
      followRedirects: false
    });
    var codigo = r.getResponseCode();
    if (codigo >= 300) console.warn('vigía: el Despacho respondió ' + codigo);   // sin el cuerpo ni el secreto
  } catch (err) {
    console.warn('vigía: no se pudo llamar al Despacho (' + String(err && err.name || 'error') + ')');
  }
}

/** Deja UN solo disparador de dispararVigia cada 15 minutos (borra los que hubiera de esa función). */
function instalarDisparadorVigia() {
  quitarDisparadorVigia();
  ScriptApp.newTrigger('dispararVigia').timeBased().everyMinutes(VIGIA_CADA_MIN).create();
  console.log('vigía: disparador instalado (cada ' + VIGIA_CADA_MIN + ' minutos, de ' + VIGIA_DESDE + ' a ' + VIGIA_HASTA + ' h)');
}

/** Borra los disparadores de dispararVigia (los de otras funciones no se tocan). */
function quitarDisparadorVigia() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dispararVigia') { ScriptApp.deleteTrigger(t); n++; }
  });
  if (n) console.log('vigía: se quitaron ' + n + ' disparador(es) de dispararVigia');
}

/** Para comprobar sin llamar al Despacho: si la propiedad está cargada (sin mostrarla) y qué disparadores hay. */
function probarVigia() {
  var props = PropertiesService.getScriptProperties();
  Logger.log('VIGIA_SECRETO cargado: ' + !!props.getProperty('VIGIA_SECRETO'));
  Logger.log('Vigía ' + VERSION_VIGIA + ' · URL: ' + (props.getProperty('VIGIA_URL') ? 'la de la propiedad VIGIA_URL' : 'la del Despacho'));
  var cuenta = {};
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    cuenta[f] = (cuenta[f] || 0) + 1;
  });
  var funciones = Object.keys(cuenta);
  if (!funciones.length) Logger.log('Disparadores del proyecto: ninguno');
  funciones.forEach(function (f) { Logger.log('Disparador: ' + f + ' × ' + cuenta[f]); });
}
