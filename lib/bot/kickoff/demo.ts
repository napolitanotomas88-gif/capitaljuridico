// ── Ejemplo FICTICIO de la pantalla de kickoff (/clientes/<id>/kickoff?demo=1, solo en desarrollo) ───────────────────
// Copia SANEADA de la ficha de la prueba del 24/10 (.cache/kickoff-prueba/salida-195704214.json, rearmada con el portfolio de
// Meta): sin mails, sin ids de cuentas, páginas ni portfolios reales (números inventados), sin el nombre de la clienta (queda
// «Clienta Ejemplo (ejemplo)», ID E157) ni los de los clientes de los ganadores («Cliente N (ejemplo)»), sin el copy de los
// anuncios ajenos y con la grabación y el link de Fathom inventados. Revisión del 24/10: tampoco quedan frases de la llamada
// real ni su ubicación (con la rama y la provincia identificaban a la clienta): la zona es otra provincia (La Pampa) con
// localidades inventadas, y TODAS las citas, los ganchos y las notas están escritos a mano. Quedan la forma, los minutos y
// los números. Los textos de Meta y los faltantes son los del código de hoy (el test de la vista controla que los
// faltantes sean los que calcula ficha.ts). La usan la página (con ?demo=1, pedidoDemo de lib/clientes/demo.ts: en
// producción nunca) y scripts/test-bot-kickoff-vista.mjs. Nada de esto sale de la base.
import { VERSION_MAPA } from './mapa-prompt'
import { combinarZonaConMapa, type ZonaVideoFicha } from './mapa-zona'
import { armarVista } from './vista'
import type { FilaFichaCliente } from './registro'
import type { FichaKickoff } from './tipos'

export const FICHA_EJEMPLO: FichaKickoff = {
  "version": 1,
  "recording_id": 100000001,
  "titulo": "CLIENTA EJEMPLO y Tomas Napolitano",
  "url": "https://fathom.video/calls/100000001",
  "fecha": "2026-10-23T12:00:00Z",
  "tipo_reunion": "kickoff",
  "resumen_corto": "Kickoff con Clara (Clari) Ejemplo, La Pampa: Laboral despidos en blanco con 1,5 años, 8 a 10 USD/día, zona Colonia Ejemplo–Villa Inventada.",
  "cliente": {
    "nombre_escuchado": "CLIENTA EJEMPLO",
    "apodo": "Clari",
    "cliente_crm": "Clienta Ejemplo (ejemplo)",
    "id_crm": "E157",
    "email": null,
    "como": "email",
    "cuentas": []
  },
  "rama": {
    "principal": "laboral",
    "texto": "Laboral: despidos",
    "cita": "Entonces, Clari, arrancamos con despidos, que es lo que más te entra.",
    "timestamp": "00:22:10",
    "textual": true,
    "aprox": null,
    "subramas": [
      {
        "texto": "despidos",
        "cita": "Entonces, Clari, arrancamos con despidos, que es lo que más te entra.",
        "timestamp": "00:22:10",
        "textual": true,
        "aprox": null
      },
      {
        "texto": "despido después de un accidente de trabajo (doble causa); a Clara le pareció bien, a confirmar en los guiones",
        "cita": "a veces el que se accidenta y vuelve, lo terminan echando: ahí hay dos temas",
        "timestamp": "00:16:00",
        "textual": true,
        "aprox": "00:18:00"
      }
    ],
    "descartadas": [
      {
        "texto": "Penal",
        "motivo": "Clara la estudió y le gusta, pero no quiere arrancar con esos casos; se eligió una sola rama (laboral) para no dividir el presupuesto",
        "cita": "penal me encanta, lo estudié, pero no me animo a llevar esos casos",
        "timestamp": "00:08:50",
        "textual": true,
        "aprox": null
      },
      {
        "texto": "Sucesiones (rama civil)",
        "motivo": "Clara la nombró como parte de su práctica, pero se arranca con una sola rama: laboral",
        "cita": "sucesiones hago bastante, pero no quiero arrancar por ahí",
        "timestamp": "00:06:37",
        "textual": true,
        "aprox": null
      }
    ],
    "a_futuro": [
      {
        "texto": "Familia (su rama preferida), cuando laboral esté funcionando y ella lo quiera; ahí apuntaría a divorcios",
        "cita": "familia es lo mío, cuando esto camine lo sumamos",
        "timestamp": "00:07:07",
        "textual": true,
        "aprox": "00:08:25"
      }
    ]
  },
  "avatar": {
    "incluye": [
      {
        "texto": "al menos un año y medio trabajando",
        "cita": "que tengan por lo menos un año y medio en el trabajo, no menos",
        "timestamp": "00:10:23",
        "textual": true,
        "aprox": null
      },
      {
        "texto": "prioridad a gente en blanco o mitad en negro y mitad en blanco",
        "cita": "prefiero a los que están en blanco, o que cobran una parte en negro",
        "timestamp": "00:12:00",
        "textual": true,
        "aprox": "00:12:19"
      }
    ],
    "excluye": [
      {
        "texto": "nada de pasantes",
        "cita": "pasantes no, y tampoco el que entró hace tres meses",
        "timestamp": "00:10:23",
        "textual": true,
        "aprox": null
      },
      {
        "texto": "nada de gente con pocos meses de trabajo (tres meses, período de prueba)",
        "cita": "el que estuvo un par de meses a prueba no me sirve",
        "timestamp": "00:10:23",
        "textual": true,
        "aprox": null
      },
      {
        "texto": "nada de trabajo totalmente en negro (igual puede escribir alguien en negro aunque el anuncio filtre)",
        "cita": "totalmente en negro no, porque después no hay cómo probar nada",
        "timestamp": "00:12:00",
        "textual": true,
        "aprox": "00:12:25"
      },
      {
        "texto": "contexto de la zona: hay mucho trabajo de temporada en el campo, casi todo en negro; queda afuera si es totalmente en negro",
        "cita": "acá en la zona hay mucho trabajo de temporada en el campo, y eso es casi todo en negro",
        "timestamp": "00:10:42",
        "textual": true,
        "aprox": "00:11:41"
      }
    ]
  },
  "zona": {
    "descripcion": "Zona marcada en el mapa en la provincia de La Pampa: Colonia Ejemplo, Paraje Norte, hasta Villa Inventada y hasta El Molino (de oído) y algunas localidades más que no se nombraron; límites exactos solo en el mapa.",
    "lugares": [
      "Colonia Ejemplo",
      "Paraje Norte",
      "Villa Inventada",
      "El Molino (de oído, verificar)"
    ],
    "radio_km": null,
    "presentarse_como": {
      "texto": "Santa Rosa capital",
      "cuando": "si un lead pregunta dónde está",
      "cita": "si alguien te pregunta, decile que atendés en Santa Rosa",
      "timestamp": "00:16:00",
      "textual": true,
      "aprox": "00:16:53"
    },
    "contexto": [
      {
        "texto": "El estudio está en Pueblo Ejemplo; Clara dice que queda a 50 km de la capital (cuarenta minutos)",
        "cita": "estoy a unos cincuenta kilómetros, en cuarenta minutos estoy en la capital",
        "timestamp": "00:16:00",
        "textual": true,
        "aprox": "00:16:35"
      },
      {
        "texto": "Acepta viajar: ya fue a Ciudad Lejana (120 km) a reuniones y si hace falta se traslada",
        "cita": "una vez me fui hasta Ciudad Lejana, son ciento veinte kilómetros, no tengo problema",
        "timestamp": "00:16:00",
        "textual": true,
        "aprox": "00:16:47"
      },
      {
        "texto": "Se busca gente cerca que pueda acercarse físicamente al estudio",
        "cita": "lo ideal es que sea gente de la zona que pueda venir al estudio",
        "timestamp": "00:16:00",
        "textual": true,
        "aprox": null
      }
    ],
    "pais": "AR",
    "mapa_en_pantalla": true,
    "cita": "agarramos Colonia Ejemplo, Paraje Norte, hasta Villa Inventada por acá y el Molino",
    "timestamp": "00:16:00",
    "textual": true,
    "aprox": "00:17:18"
  },
  "presupuesto": {
    "usd_dia_min": 8,
    "usd_dia_max": 10,
    "usd_mes": 240,
    "moneda": "USD",
    "texto": "8 a 10 dólares al día; con 8 por día, 240 dólares al mes",
    "deducido": false,
    "certeza": "confirmado",
    "cita": "arranquemos con ocho, hasta diez dólares por día",
    "timestamp": "00:15:42",
    "textual": true,
    "aprox": null,
    "evidencia_mes": {
      "cita": "con ocho por día te da unos doscientos cuarenta por mes",
      "timestamp": "00:15:48",
      "textual": true,
      "aprox": null
    }
  },
  "portfolio": {
    "instagram": {
      "estado": "no_se_hablo",
      "detalle": "",
      "cita": "",
      "timestamp": null,
      "textual": false,
      "aprox": null
    },
    "whatsapp_business": {
      "estado": "sin_verificar",
      "detalle": "Solo se dijo que los mensajes llegan a WhatsApp; no se revisó la cuenta de WhatsApp Business",
      "cita": "cuando te escriban por WhatsApp, buenos o malos, mandame todo",
      "timestamp": "00:18:59",
      "textual": true,
      "aprox": "00:19:58"
    },
    "pagina_facebook": {
      "estado": "no_se_hablo",
      "detalle": "",
      "cita": "",
      "timestamp": null,
      "textual": false,
      "aprox": null
    },
    "portfolio_comercial": {
      "estado": "no_se_hablo",
      "detalle": "",
      "cita": "",
      "timestamp": null,
      "textual": false,
      "aprox": null
    },
    "tarjeta": {
      "estado": "sin_verificar",
      "detalle": "Tomás le pidió tenerla bien cargada para que no se pausen las campañas; no se comprobó",
      "cita": "la tarjeta tenela bien cargada así no se frena nada",
      "timestamp": "00:18:59",
      "textual": true,
      "aprox": "00:19:34"
    },
    "verificacion": {
      "estado": "no_se_hablo",
      "detalle": "",
      "cita": "",
      "timestamp": null,
      "textual": false,
      "aprox": null
    },
    "accesos_equipo": {
      "estado": "no_se_hablo",
      "detalle": "",
      "cita": "",
      "timestamp": null,
      "textual": false,
      "aprox": null
    }
  },
  "acuerdos": [
    {
      "quien": "Tomás / equipo de Capital Jurídico",
      "que": "Primera entrega de guiones de despidos",
      "cuando": "mar 27/10 o mié 28/10, estimado",
      "cita": "la primera tanda de guiones te la mandamos en dos o tres días",
      "timestamp": "00:18:36",
      "textual": true,
      "aprox": null
    },
    {
      "quien": "Clara (Clari)",
      "que": "Revisar los guiones y dar feedback para mejorarlos",
      "cuando": null,
      "cita": "vos los leés, nos decís qué cambiarías y los ajustamos",
      "timestamp": "00:18:07",
      "textual": true,
      "aprox": null
    },
    {
      "quien": "Clara (Clari)",
      "que": "Grabar los videos con los guiones finales y subirlos a su carpeta de Drive (carpeta de Clari)",
      "cuando": null,
      "cita": "después los grabás y los subís a tu carpeta del Drive",
      "timestamp": "00:18:13",
      "textual": true,
      "aprox": null
    },
    {
      "quien": "Editor / equipo de Capital Jurídico",
      "que": "Editar los videos, enviárselos a Clara para que los revise y publicarlos en la campaña",
      "cuando": null,
      "cita": "nosotros los editamos, te los pasamos para que los mires y salen",
      "timestamp": "00:18:19",
      "textual": true,
      "aprox": null
    },
    {
      "quien": "Clara (Clari)",
      "que": "Mirar los módulos Esenciales y Grabación en Skool (dijo que ya los vio: hecho)",
      "cuando": null,
      "cita": "sí, ya vi los módulos en Skool",
      "timestamp": "00:18:48",
      "textual": true,
      "aprox": null
    },
    {
      "quien": "Clara (Clari)",
      "que": "Leer el material de bienvenida que le mandó Tomás (dijo que lo mira ahora)",
      "cuando": "vie 23/10",
      "cita": "dale, lo leo ahora",
      "timestamp": "00:22:24",
      "textual": true,
      "aprox": null
    },
    {
      "quien": "Clara (Clari)",
      "que": "Grabar rápido los videos, también cuando se pidan nuevos para optimizar",
      "cuando": null,
      "cita": "lo más importante es que grabes rápido, así salimos antes",
      "timestamp": "00:18:59",
      "textual": true,
      "aprox": null
    },
    {
      "quien": "Clara (Clari)",
      "que": "Mantener la tarjeta bien cargada para que no se pausen las campañas",
      "cuando": null,
      "cita": "la tarjeta tenela bien cargada así no se frena nada",
      "timestamp": "00:18:59",
      "textual": true,
      "aprox": "00:19:34"
    },
    {
      "quien": "Clara (Clari)",
      "que": "Enviar capturas de pantalla de todos los chats de WhatsApp (buenos, malos y sin respuesta)",
      "cuando": null,
      "cita": "mandame captura de todos los chats, los buenos, los malos y los que no contestan",
      "timestamp": "00:18:59",
      "textual": true,
      "aprox": "00:20:01"
    },
    {
      "quien": "Tomás",
      "que": "Optimizar los anuncios con las capturas (traer más de la gente buena, quitar la mala) y ayudar a Clara con las ventas",
      "cuando": null,
      "cita": "con eso veo de dónde viene la gente buena y traigo más de esa",
      "timestamp": "00:18:59",
      "textual": true,
      "aprox": "00:20:11"
    },
    {
      "quien": "Tomás",
      "que": "Regular la cantidad de consultas para que Clara no se sature (por eso el presupuesto más bajo)",
      "cuando": null,
      "cita": "no quiero que te lleguen más consultas de las que podés atender",
      "timestamp": "00:10:15",
      "textual": true,
      "aprox": null
    }
  ],
  "pendientes": [
    "Clara dijo que tiene que repasar la reforma laboral"
  ],
  "ideas_guiones": {
    "estado": "a_revisar",
    "revisores": [
      "Tomi",
      "Gero M"
    ],
    "ideas": [
      {
        "titulo": "Firmaste la liquidación y te pagaron de menos",
        "gancho": "¿Trabajaste más de un año y medio en blanco, te despidieron y ya firmaste la liquidación? Esperá antes de darlo por cerrado.",
        "angulo": "Toca al trabajador registrado que cobró y cree que el tema está cerrado. El reencuadre es que firmar no le cierra la puerta a revisar diferencias (bonos, horas extra, aguinaldo, base de cálculo). Funciona porque filtra solo a gente en blanco con antigüedad, que es el avatar exacto de Clara.",
        "subrama": "despidos",
        "por_que": "Se apoya en G2 (AR, USD 0,44 por mensaje), liquidación mal calculada o firmada sin revisar, y en el ejemplo de la liquidación de la base. Se suma el filtro de antigüedad."
      },
      {
        "titulo": "Parte en recibo, parte en mano",
        "gancho": "Si cobrabas una parte en el recibo y otra en mano y te echaron, escuchá esto.",
        "angulo": "Es el sueldo en gris, muy común en la zona. Se toma la potencia de los ganadores de negro, pero se filtra a quien tenía al menos parte registrada, así no entra el trabajo totalmente en negro; la antigüedad se filtra en el cuerpo del guion. El problema es que la indemnización se calcula solo sobre lo del recibo. La solución nombra el reclamo por lo no registrado, sin cifras.",
        "subrama": "despidos",
        "por_que": "Adapta G3 (AR, USD 0,45 por mensaje) y G1 (AR, USD 0,34 por mensaje), ambos de trabajo en negro o en gris. Se lleva al gris para respetar el filtro de la ficha y se usa el ángulo «sueldo en gris» de la base."
      },
      {
        "titulo": "Te empujan a renunciar",
        "gancho": "¿Te están empujando a renunciar después de años en el mismo trabajo? No firmes nada todavía.",
        "angulo": "Apunta a alguien que todavía no fue despedido: le cambian condiciones, le bajan horas o lo presionan para que se vaya solo. El reencuadre es que renunciar puede hacerle perder derechos y que existe el despido indirecto, nombrado sin el paso a paso. Capta casos antes de que el trabajador firme. La registración y la antigüedad se filtran en el cuerpo.",
        "subrama": "despidos",
        "por_que": "Se basa en G4 (AR, USD 0,51 por mensaje) y en el ejemplo de la renuncia forzada de la base. Como referencia secundaria, G9 (AR, USD 1,03 por mensaje) toca el despido indirecto."
      },
      {
        "titulo": "«No vengas más» en comercio o fábrica",
        "gancho": "Si trabajaste más de un año y medio en blanco en un comercio o una fábrica de La Pampa y te dijeron «no vengas más», esperá.",
        "angulo": "Es el despido de palabra, sin telegrama ni papeles: la persona no sabe si la echaron ni qué hacer. Se localiza con rubros urbanos de la zona (comercio, fábrica) y se evita a propósito el trabajo de temporada en el campo, que suele estar en negro. La solución es intimar para aclarar la situación, sin plazos prometidos.",
        "subrama": "despidos",
        "por_que": "Toma la estructura de gancho de G8 (AR, USD 0,87 por mensaje) y del ejemplo de «no vengas más» de la base, pero cambia la registración a en blanco para respetar el filtro. También usa el ángulo «despido de palabra» de la base."
      },
      {
        "titulo": "Volviste del accidente y te echaron",
        "gancho": "Si tuviste un accidente de trabajo, estabas en blanco y al volver te despidieron, ojo.",
        "angulo": "Es la doble causa: por un lado la lesión y por otro el despido. Muchos creen que es una cosa o la otra y no consultan, cuando puede haber dos reclamos para analizar. Se puede grabar con un certificado médico como utilería. Es un ángulo menos saturado y el prerrequisito «en blanco» encaja con el avatar.",
        "subrama": "despido después de un accidente de trabajo (doble causa); a Clara le pareció bien, a confirmar en los guiones",
        "por_que": "No se apoya en ningún ganador ni en un ejemplo directo de la base; de la base solo toma la utilería del certificado médico. La subrama cruza con ART y no se buscaron ganadores de esa rama. Clara todavía tiene que confirmar esta subrama."
      }
    ],
    "notas": "Los ganadores con más volumen (G3, G5, G7) son de trabajo en negro, que la ficha excluye: los adapté al sueldo en gris, pero conviene tener en cuenta que el público en blanco puede salir más caro. Evité el trabajo de temporada en el campo porque la ficha dice que suele estar en negro. Ojo con la localización: el estudio está en Pueblo Ejemplo pero Clara se presenta como «Santa Rosa capital», así que en los ganchos usé «La Pampa» a secas."
  },
  "fin_grabacion": "2026-10-23T12:22:30Z",
  "fin_agendado": "2026-10-23T12:45:00Z",
  "grabo": {
    "nombre": "Tomas Napolitano",
    "email": null,
    "quien": "Tomás"
  },
  "portfolio_meta": {
    "cuenta": "act_100000000000001",
    "nombre": "USD ESTUDIO JURIDICO EJEMPLO",
    "leido": true,
    "motivo": null,
    "aviso": null,
    "generado": "2026-10-24T17:52:00.878Z",
    "origen_cuenta": "descubrimiento",
    "moneda": "USD",
    "zona_horaria": "America/Argentina/Buenos_Aires"
  },
  "portfolio_final": {
    "instagram": {
      "estado": "sin_dato",
      "detalle": "No se ve Instagram en el portfolio, la cuenta ni los anuncios. Meta no nos deja ver el Instagram vinculado solo a la página: revisalo en el portfolio del cliente (Configuración del negocio → Cuentas de Instagram) · en la llamada no se habló",
      "fuente": "ninguna",
      "meta": {
        "estado": "sin_dato",
        "detalle": "No se ve Instagram en el portfolio, la cuenta ni los anuncios. Meta no nos deja ver el Instagram vinculado solo a la página: revisalo en el portfolio del cliente (Configuración del negocio → Cuentas de Instagram)"
      },
      "llamada": null,
      "discrepancia": null
    },
    "whatsapp_business": {
      "estado": "sin_dato",
      "detalle": "Todavía no hay anuncios a WhatsApp y Meta no nos deja leer el número de la página: revisalo en la página (Configuración → WhatsApp) · en la llamada se mencionó sin verificar (Solo se dijo que los mensajes llegan a WhatsApp; no se revisó la cuenta de WhatsApp Business)",
      "fuente": "ninguna",
      "meta": {
        "estado": "sin_dato",
        "detalle": "Todavía no hay anuncios a WhatsApp y Meta no nos deja leer el número de la página: revisalo en la página (Configuración → WhatsApp)"
      },
      "llamada": {
        "estado": "sin_verificar",
        "detalle": "Solo se dijo que los mensajes llegan a WhatsApp; no se revisó la cuenta de WhatsApp Business",
        "cita": "cuando te escriban por WhatsApp, buenos o malos, mandame todo",
        "timestamp": "00:18:59",
        "textual": true
      },
      "discrepancia": null
    },
    "pagina_facebook": {
      "estado": "ok",
      "detalle": "Página en el portfolio: «Estudio Clienta Ejemplo»",
      "fuente": "meta",
      "meta": {
        "estado": "ok",
        "detalle": "Página en el portfolio: «Estudio Clienta Ejemplo»"
      },
      "llamada": null,
      "discrepancia": null
    },
    "portfolio_comercial": {
      "estado": "ok",
      "detalle": "Portfolio «Estudio Ejemplo», dueño de la cuenta · sin verificar (no frena nada)",
      "fuente": "meta",
      "meta": {
        "estado": "ok",
        "detalle": "Portfolio «Estudio Ejemplo», dueño de la cuenta · sin verificar (no frena nada)"
      },
      "llamada": null,
      "discrepancia": null
    },
    "tarjeta": {
      "estado": "ok",
      "detalle": "Hay medio de pago: sí (tarjeta de crédito/débito); sin deuda",
      "fuente": "meta",
      "meta": {
        "estado": "ok",
        "detalle": "Hay medio de pago: sí (tarjeta de crédito/débito); sin deuda"
      },
      "llamada": {
        "estado": "sin_verificar",
        "detalle": "Tomás le pidió tenerla bien cargada para que no se pausen las campañas; no se comprobó",
        "cita": "la tarjeta tenela bien cargada así no se frena nada",
        "timestamp": "00:18:59",
        "textual": true
      },
      "discrepancia": null
    },
    "verificacion": {
      "estado": "ok",
      "detalle": "Cuenta publicitaria activa, sin restricciones · el portfolio no está verificado por Meta (no frena nada)",
      "fuente": "meta",
      "meta": {
        "estado": "ok",
        "detalle": "Cuenta publicitaria activa, sin restricciones · el portfolio no está verificado por Meta (no frena nada)"
      },
      "llamada": null,
      "discrepancia": null
    },
    "accesos_equipo": {
      "estado": "ok",
      "detalle": "Con acceso para anunciar: Gerónimo Actis y Valentino",
      "fuente": "meta",
      "meta": {
        "estado": "ok",
        "detalle": "Con acceso para anunciar: Gerónimo Actis y Valentino"
      },
      "llamada": null,
      "discrepancia": null
    }
  },
  "faltantes": [
    "Zona del mapa: anotar el recorte exacto para la campaña (se ve en la grabación ▶ ≈17:18; se nombró Colonia Ejemplo, Paraje Norte, Villa Inventada y El Molino)",
    "Portfolio para tildar a mano (Meta no los pudo leer y en la llamada no se confirmaron): Instagram y WhatsApp Business (WhatsApp Business solo se nombró)",
    "Portfolio · cargar act_100000000000001 en «Cuentas Meta» del CRM: hoy la encontró sola el tablero de anuncios"
  ],
  "ganadores": {
    "estado": "ok",
    "nota": "16 cuentas de la rama, 30 guiones con USD 20+ y 10+ mensajes · 1 de otra rama descartados · 4 de otro país (no AR) quedaron afuera",
    "lista": [
      {
        "id": "G1",
        "anuncio": "¿Trabajaste en negro y te echaron?",
        "copy": null,
        "subtema": "trabajo en negro / en gris",
        "cplUSD": 0.34,
        "mensajes": 279,
        "gastoUSD": 94.66,
        "pais": "AR",
        "cliente": "Cliente 1 (ejemplo)",
        "cuentaId": "act_200000000000001"
      },
      {
        "id": "G2",
        "anuncio": "¿Firmaste tu liquidación y cobraste? Ojo",
        "copy": null,
        "subtema": "liquidación mal calculada / firmar sin revisar",
        "cplUSD": 0.44,
        "mensajes": 234,
        "gastoUSD": 103.06,
        "pais": "AR",
        "cliente": "Cliente 2 (ejemplo)",
        "cuentaId": "act_200000000000002"
      },
      {
        "id": "G3",
        "anuncio": "¿Trabajabas en negro y te echaron?",
        "copy": null,
        "subtema": "trabajo en negro / en gris",
        "cplUSD": 0.45,
        "mensajes": 1048,
        "gastoUSD": 471.81,
        "pais": "AR",
        "cliente": "Cliente 3 (ejemplo)",
        "cuentaId": "act_200000000000003"
      },
      {
        "id": "G4",
        "anuncio": "te estan empujando a renunciar?",
        "copy": null,
        "subtema": "te empujan a renunciar",
        "cplUSD": 0.51,
        "mensajes": 215,
        "gastoUSD": 110.34,
        "pais": "AR",
        "cliente": "Cliente 4 (ejemplo)",
        "cuentaId": "act_200000000000004"
      },
      {
        "id": "G5",
        "anuncio": "No aceptes menos de lo que corresponde",
        "copy": null,
        "subtema": "trabajo en negro / en gris",
        "cplUSD": 0.61,
        "mensajes": 690,
        "gastoUSD": 422.54,
        "pais": "AR",
        "cliente": "Cliente 5 (ejemplo)",
        "cuentaId": "act_200000000000005"
      },
      {
        "id": "G6",
        "anuncio": "¿Te despidieron estando en negro? Mirá esto",
        "copy": null,
        "subtema": "trabajo en negro / en gris",
        "cplUSD": 0.68,
        "mensajes": 47,
        "gastoUSD": 32.02,
        "pais": "AR",
        "cliente": "Cliente 6 (ejemplo)",
        "cuentaId": "act_200000000000006"
      },
      {
        "id": "G7",
        "anuncio": "¿Te despidieron y estabas en negro?",
        "copy": null,
        "subtema": "trabajo en negro / en gris",
        "cplUSD": 0.87,
        "mensajes": 885,
        "gastoUSD": 768.65,
        "pais": "AR",
        "cliente": "Cliente 7 (ejemplo)",
        "cuentaId": "act_200000000000007"
      },
      {
        "id": "G8",
        "anuncio": "¿Te despidieron y trabajabas en negro?",
        "copy": null,
        "subtema": "trabajo en negro / en gris",
        "cplUSD": 0.87,
        "mensajes": 182,
        "gastoUSD": 158.46,
        "pais": "AR",
        "cliente": "Cliente 8 (ejemplo)",
        "cuentaId": "act_200000000000008"
      },
      {
        "id": "G9",
        "anuncio": "te estan empujando a renunciar",
        "copy": null,
        "subtema": "liquidación mal calculada / firmar sin revisar",
        "cplUSD": 1.03,
        "mensajes": 522,
        "gastoUSD": 535.64,
        "pais": "AR",
        "cliente": "Cliente 9 (ejemplo)",
        "cuentaId": "act_200000000000009"
      },
      {
        "id": "G10",
        "anuncio": "¿Trabajaste en negro y te despidieron?",
        "copy": null,
        "subtema": "trabajo en negro / en gris",
        "cplUSD": 1.05,
        "mensajes": 270,
        "gastoUSD": 283.94,
        "pais": "AR",
        "cliente": "Cliente 10 (ejemplo)",
        "cuentaId": "act_200000000000010"
      }
    ],
    "ventana": "2026-04-28 a 2026-10-24 (180 días)"
  },
  "ajustes": [
    "pendiente del portfolio sacado («No se revisó el portfolio en Meta: Instagram, página de Facebook y los accesos del equipo»): lo cubre el chequeo de Meta"
  ]
}

const clonar = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/**
 * Una lectura del mapa inventada (Meta Ads, pin con 30 km en Colonia Ejemplo: la ubicación configurada en la lista; los
 * demás nombres se leen dentro del círculo), combinada con la zona dicha del ejemplo.
 */
function mapaDemo(f: FichaKickoff): ZonaVideoFicha {
  const { mapa } = combinarZonaConMapa(f.zona, {
    hay_mapa: true, tipo: 'meta_ads', marca: 'pin_con_radio', marca_detalle: 'pin en Colonia Ejemplo con +30 km', radio_km: 30, radio_estimado_km: null,
    radio_como: '', limites: 'círculo de 30 km alrededor de Colonia Ejemplo', excluidas: [], mejor_cuadro: 6, momento: '00:18:05', legible: 'si', notas: '',
    lugares: [
      { nombre: 'Colonia Ejemplo, La Pampa, Argentina', posicion: 'lista_incluida' }, { nombre: 'Paraje Norte', posicion: 'dentro' }, { nombre: 'Laguna Quieta', posicion: 'dentro' },
      { nombre: 'Villa Inventada', posicion: 'borde' }, { nombre: 'El Molino', posicion: 'fuera' },
    ],
  })
  return {
    estado: 'ok', version: VERSION_MAPA, quien: 'tomas', download_id: 'dl_ejemplo', motivo: null, transitorio: false, mapa,
    momentos: [1028, 1038, 1053, 1073, 1098, 1158, 1218], tokens: { input_tokens: 21_000, output_tokens: 1_500, costo_usd: 0.114 },
    modelo: 'claude-opus-5-5', generado: '2026-10-24T17:55:00.000Z',
  }
}

/**
 * Las filas del ejemplo (no tocan la base):
 *   1. la ficha de arriba (con el ID pedido), «lista», con Instagram tildado a mano, el mapa leído del video (Meta Ads, pin
 *      con 30 km: El Molino queda afuera, así que el faltante pasó a «revisar» —clave zona_mapa_video— y está marcado como
 *      hecho con la nota, después de leído el video), la fecha estimada de lanzamiento cargada y las ideas aprobadas por Tomi
 *      después de pedir un cambio (falta Gero M);
 *   2. la misma llamada tres días antes, como una fila que quedó en «error» con la ficha base (sin chequeo de Meta, como
 *      las fichas viejas) y las ideas solo en la columna ideas: para ver el selector y esos dos casos.
 */
export function filasDemo(idCrm = 'E157'): FilaFichaCliente[] {
  // El ID es el de la URL (así "volver a la ficha" lleva al cliente de ejemplo de /clientes?demo=1, E001 a E009)
  const f: FichaKickoff = { ...clonar(FICHA_EJEMPLO), cliente: { ...FICHA_EJEMPLO.cliente, id_crm: idCrm.toUpperCase() } }
  const base = { titulo: f.titulo, url: f.url, cliente_crm: f.cliente.cliente_crm, id_crm: f.cliente.id_crm }
  const primera: FilaFichaCliente = {
    ...base, recording_id: f.recording_id, estado: 'lista', error: null, ficha: clonar(f), ideas: null, revision: null,
    portfolio_checks: { instagram: { valor: 'ok', nota: 'Lo vi en la página: está vinculado', quien: 'Usuario de ejemplo', email: 'ejemplo@ejemplo.test', cuando: '2026-10-24T18:05:00.000Z' } },
    faltantes_checks: {
      zona_mapa_video: { nota: 'Radio de 30 km desde Colonia Ejemplo; Villa Inventada queda adentro, El Molino afuera', quien: 'Usuario de ejemplo', email: 'ejemplo@ejemplo.test', cuando: '2026-10-24T18:07:00.000Z' },
      fecha_lanzamiento: { nota: 'jue 29/10, si graba el martes', quien: 'Usuario de ejemplo', email: 'ejemplo@ejemplo.test', cuando: '2026-10-24T18:08:00.000Z' },
    },
    creado: '2026-10-24T17:26:55.361Z', actualizado: '2026-10-24T17:52:02.881Z',
    zona_video: mapaDemo(f),
  }
  const huella = armarVista(primera)?.ideas.huella ?? ''
  primera.revision = {
    tomi: {
      estado: 'aprobada', comentario: '', cuando: '2026-10-24T18:10:00.000Z', email: 'ejemplo@ejemplo.test', huella,
      historial: [{ estado: 'cambios', comentario: 'En la 2, el gancho más corto', cuando: '2026-10-24T18:02:00.000Z', huella }],
    },
    gero_m: null,
  }

  const vieja = clonar(f) as FichaKickoff & Record<string, unknown>
  for (const k of ['portfolio_meta', 'portfolio_final', 'grabo', 'fin_grabacion', 'fin_agendado']) delete vieja[k]
  const ideasGuardadas = { ideas: clonar(f.ideas_guiones), ganadores: clonar(f.ganadores), ajustes: [], kb: null }
  vieja.recording_id = f.recording_id - 1
  vieja.fecha = '2026-10-20T12:00:00Z'
  vieja.ideas_guiones = { estado: 'no_corresponde', revisores: ['Tomi', 'Gero M'], ideas: [], notas: '', motivo: 'todavía no se pidieron' }
  vieja.ganadores = { estado: 'no_pedido', nota: '', lista: [], ventana: null }
  const segunda: FilaFichaCliente = {
    ...base, recording_id: vieja.recording_id, estado: 'error', error: 'Discord no respondió a tiempo (ejemplo)', ficha: vieja,
    ideas: ideasGuardadas, revision: null, portfolio_checks: null, faltantes_checks: null,
    creado: '2026-10-20T12:30:00.000Z', actualizado: '2026-10-20T12:31:30.000Z',
  }
  return [primera, segunda]
}
