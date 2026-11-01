// ── Bienvenida con la identidad de Capital Jurídico (31/10/2026) ─────────────────────────────────────────────
// Pedido de Tomás: "en la bienvenida también mejorá mucho la identidad visual". crearDoc_ llama a esto solo si
// p.estilo === 'cj'; sin estilo el doc sale como antes. Colores y letras del Manual de Identidad (Sitka no está en
// Docs: Merriweather para títulos, Source Serif 4 para el texto). Si algo de la marca falla, el doc queda igual creado.
var MARCA_CJ = {
  oro: '#BE8F49', marfil: '#F2EADC', verde: '#012D25', bordo: '#7F202C', tinta: '#1D1D1B',
  titulos: 'Merriweather', texto: 'Source Serif 4',
  // Imagen del encabezado (PNG en Drive): Script Property ENCABEZADO_BIENVENIDA_ID. Sin ella el doc sale sin encabezado
  encabezadoId: String(PropertiesService.getScriptProperties().getProperty('ENCABEZADO_BIENVENIDA_ID') || '').trim()
}

/** Con el doc abierto (DocumentApp): encabezado, letras, colores y links. */
function marcaCjEnDoc_(doc) {
  var body = doc.getBody()
  body.setMarginTop(28).setMarginBottom(48).setMarginLeft(62).setMarginRight(62)
  var T = DocumentApp.ElementType, H = DocumentApp.ParagraphHeading, A = DocumentApp.Attribute
  var n = body.getNumChildren()
  for (var i = 0; i < n; i++) {
    var el = body.getChild(i), tipo = el.getType()
    if (tipo !== T.PARAGRAPH && tipo !== T.LIST_ITEM) continue
    var par = tipo === T.PARAGRAPH ? el.asParagraph() : el.asListItem()
    var txt = par.editAsText(), largo = txt.getText().length
    if (!largo) continue
    var base = {}; base[A.FONT_FAMILY] = MARCA_CJ.texto; base[A.FONT_SIZE] = 11; base[A.FOREGROUND_COLOR] = MARCA_CJ.tinta; base[A.BOLD] = false
    var h = par.getHeading()
    if (h === H.HEADING1) {
      base[A.FONT_FAMILY] = MARCA_CJ.titulos; base[A.FONT_SIZE] = 24; base[A.FOREGROUND_COLOR] = MARCA_CJ.verde; base[A.BOLD] = true
      txt.setAttributes(base)
      // El titular en dos tonos del manual: "Capital Jurídico" en oro
      var r = txt.findText('Capital Jurídico')
      if (r) txt.setForegroundColor(r.getStartOffset(), r.getEndOffsetInclusive(), MARCA_CJ.oro)
      par.setSpacingBefore(14).setSpacingAfter(10).setLineSpacing(1.1)
    } else if (h === H.HEADING2) {
      base[A.FONT_FAMILY] = MARCA_CJ.titulos; base[A.FONT_SIZE] = 13; base[A.FOREGROUND_COLOR] = MARCA_CJ.bordo; base[A.BOLD] = true
      txt.setAttributes(base)
      par.setSpacingBefore(20).setSpacingAfter(6)
    } else {
      txt.setAttributes(base)
      par.setLineSpacing(1.35).setSpacingAfter(tipo === T.LIST_ITEM ? 4 : 8)
      if (i === n - 1) { txt.setItalic(true); txt.setForegroundColor(MARCA_CJ.verde); par.setSpacingBefore(18) } // firma
    }
    // Links clickeables, en bordó (el color de los botones del manual)
    var m, re = /https?:\/\/[^\s)]+/g, s = txt.getText()
    while ((m = re.exec(s))) {
      var fin = m.index + m[0].length - 1
      txt.setLinkUrl(m.index, fin, m[0]); txt.setForegroundColor(m.index, fin, MARCA_CJ.bordo); txt.setUnderline(m.index, fin, true)
    }
  }
  // Encabezado: la placa con el imagotipo en oro, a lo ancho del texto (los márgenes van en puntos; la imagen, en píxeles)
  if (!MARCA_CJ.encabezadoId) return
  var ancho = Math.round((body.getPageWidth() - body.getMarginLeft() - body.getMarginRight()) * 4 / 3)
  // body.clear() deja un párrafo vacío arriba: se usa ese (si no está, se agrega)
  var c0 = body.getChild(0)
  var p0 = c0.getType() === T.PARAGRAPH && !c0.asParagraph().getText() ? c0.asParagraph() : body.insertParagraph(0, '')
  p0.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingAfter(4)
  var img = p0.appendInlineImage(DriveApp.getFileById(MARCA_CJ.encabezadoId).getBlob())
  img.setHeight(Math.round(img.getHeight() * ancho / img.getWidth())).setWidth(ancho)
}

/** Con el doc ya guardado (servicio avanzado Docs): filete oro bajo los subtítulos y fondo marfil. */
function marcaCjConApi_(docId) {
  var d = Docs.Documents.get(docId)
  var oro = { color: { rgbColor: { red: 0xBE / 255, green: 0x8F / 255, blue: 0x49 / 255 } } }
  var pedidos = [{ updateDocumentStyle: { documentStyle: { background: { color: { color: { rgbColor: { red: 0xF2 / 255, green: 0xEA / 255, blue: 0xDC / 255 } } } } }, fields: 'background' } }]
  ;(d.body.content || []).forEach(function (c) {
    if (c.paragraph && c.paragraph.paragraphStyle && c.paragraph.paragraphStyle.namedStyleType === 'HEADING_2') {
      pedidos.push({ updateParagraphStyle: {
        range: { startIndex: c.startIndex, endIndex: c.endIndex },
        paragraphStyle: { borderBottom: { color: oro, width: { magnitude: 0.75, unit: 'PT' }, padding: { magnitude: 3, unit: 'PT' }, dashStyle: 'SOLID' } },
        fields: 'borderBottom'
      } })
    }
  })
  Docs.Documents.batchUpdate({ requests: pedidos }, docId)
}
