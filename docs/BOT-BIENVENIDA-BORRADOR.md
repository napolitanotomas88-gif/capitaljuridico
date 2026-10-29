> **REFERENCIA TÉCNICA HISTÓRICA SANEADA.** Las marcas antiguas «hecho», «falta publicar», «pendiente» y sus fechas describen el contexto de origen; no acreditan el estado actual ni autorizan activar una integración. Los ejemplos e identificadores son ficticios o marcadores. Prevalecen `CONTEXTO-HUB.md`, `FLUJOS-VIGENTES.md`, `CONFIGURACION-PRIVADA.md` y `RUNBOOK.md`; WhatsApp permanece apagado. Se excluyeron casos, recibos, contactos y configuración operativa.

# Bienvenida del cliente nuevo: borrador para RESPONSABLE_HUB

Paso 6 del bot de altas (ver `docs/BOT-ALTA-CJ.md`). **Todavía no se manda nada.** El código está en `lib/bot/alta/bienvenida.ts`, es puro y no sale a internet. Los tests están en `scripts/test-bot-bienvenida.mjs`.

El mensaje del grupo ya es **el texto oficial de RESPONSABLE_HUB** (24/10/2026, en `docs/BOT-ALTA-CJ.md`, "Mensaje de bienvenida oficial"). Los tests lo comparan palabra por palabra con ese doc: si alguien cambia el texto en un lado y no en el otro, fallan.

Los cuatro ejemplos de abajo salen tal cual de `armarBienvenida()`. Los nombres, teléfonos y correos son inventados.

## Qué arma el bot

| Pieza | Dónde va | Qué lleva |
|---|---|---|
| `mensajeGrupo` | Grupo General de la comunidad del cliente, como **pie del video** de Skool | El mensaje oficial: saludo, presentación de {FIRMA_OPERACIONES}, el próximo paso (el video), el link de Skool y el aviso de que le va a llegar la invitación a su correo (el del #ALTA). |
| `videoUrl` | Mismo mensaje | El video de Skool, que va como archivo. |
| `bloquesDoc` (doc "Bienvenida - Nombre") | Carpeta "Nombre - C.J" del Drive, con `crearDoc` del Puente Drive | Qué hay en Guiones, Crudos y Editados, cómo subir los crudos, próximos pasos y a quién escribir. Solo cambió lo de Skool: el próximo paso es entrar con la invitación que llega al correo, y las invitaciones las manda CUENTA_QA. |
| `avisoVerificaciones` | Grupo Verificaciones C.J | "Nombre ya pagó. Invitalo a Skool: Configuración → Invitar → correo: correo". Sin correo en el #ALTA: "Nombre ya pagó, pero el #ALTA no trae correo: pedíselo al closer antes de invitarlo a Skool." |
| `avisos` | Solo para quien aprueba | Por ejemplo: falta el correo, o no se pudo deducir si va "bienvenido" o "bienvenida". |

## Lo que ya decidió RESPONSABLE_HUB (24/10/2026)

- **Texto:** el oficial, tal cual: mismo texto, los emojis 🙌🏽 y 💪🏼 y los mismos saltos de línea.
- **Firma:** se presenta {FIRMA_OPERACIONES}, encargada de operaciones, como en el texto oficial.
- **Tratamiento:** "vos", fijo, como el oficial ("Cómo va", "tengas", "avisame"). Ya no cambia según el país. Con socios va en plural.
- **Skool por invitación por correo (24/10/2026):** ya no es "el cliente pide acceso y COORDINACION acepta". COORDINACION lo invita desde Skool → Configuración → Invitar → "Invitar a personas por correo electrónico", que da acceso instantáneo. El bot le avisa en Verificaciones C.J; ella pega el correo y toca "Enviar invitación".
- **Video:** va como archivo y el texto como pie. El pie de WhatsApp admite 1024 caracteres. Los ejemplos tienen entre 663 y 698; con tres socios de nombres largos, cada uno con su correo larguísimo (24/10/2026), da unos 940. Un test lo controla. Si algún día pasara el límite, el bot avisa (`entraComoPie: false`) y el texto va aparte, después del video.

## Las únicas variaciones del texto oficial

1. **{nombre}:** el primer nombre del #ALTA, sin "Dr." ni "Dra." y con mayúsculas normales ("LUCÍA BENÍTEZ" → "Lucía").
2. **"Muy bienvenido" o "Muy bienvenida"** según el nombre:
   - primero mira el título: "Dra." → bienvenida, "Dr." → bienvenido;
   - después una lista de nombres frecuentes en español (Isabel, CUENTA_QA, Rocío, CUENTA_QA… / CUENTA_QA, CUENTA_QA, Luca, CUENTA_QA…);
   - después la terminación: -a, -dad y -triz → bienvenida; -o → bienvenido;
   - si hay duda (Alex, Noel, EDITOR…), queda "bienvenido" y el bot avisa a quien aprueba para que lo revise.
3. **Socios con nombre:** "Hola {nombre} y {socio}! Cómo va? Muy bienvenidos a Capital Jurídico!" y el resto en plural:
   - "les comparto", "van a encontrar", "les van a servir", "tengan";
   - "Les va a llegar una invitación a su correo"; si los socios traen su correo (RESPONSABLE_HUB, 24/10/2026: también entran a Skool), "Les va a llegar una invitación a sus correos (cliente@…, socio@…)".

   Con tres o más: "Hola CUENTA_QA, Ana y CUENTA_QA!". Si el #ALTA trae socios sin nombre (solo un teléfono), va en singular y el bot lo avisa.
4. **Última línea con el correo** (invitación por correo, 24/10/2026): "Te va a llegar una invitación a tu correo ({correo}) para entrar a la plataforma." Sin correo en el #ALTA va sin el paréntesis y el bot avisa que falta. Reemplaza a la de antes ("Una vez que te hayas creado la cuenta y envíes la solicitud…, avisame así te acepto").

## La línea personalizada (apagada)

La línea con el resumen de Fathom de la llamada de venta, o con la rama y la ciudad, **no va en el mensaje oficial**. Sigue disponible pero apagada por defecto:

- se prende con `incluirLineaPersonalizada: true`;
- prendida, va debajo de la presentación de CUENTA_QA, en el mensaje y en el doc;
- si con ella el pie pasara de 1024 caracteres, se deja afuera y el bot avisa.

Las funciones (`promptLineaFathom()`, `limpiarLineaPersonalizada()`, `lineaDesdeRamaYCiudad()`) y sus reglas no cambiaron: no inventar datos, sin montos ni cifras, tono sobrio y `SIN_CONTEXTO` si el resumen no alcanza.

---

## Ejemplo 1: hombre, con correo

**#ALTA:** CUENTA_QA CUENTA_QA, +54 9 341 …, sin socios, <EMAIL_PRIVADO_CONFIGURADO>.

### Mensaje del grupo General (pie del video, 684 caracteres)

```text
Hola CUENTA_QA! Cómo va? Muy bienvenido a Capital Jurídico!
Me presento: soy {FIRMA_OPERACIONES}, encargada de operaciones de la empresa. 
Estamos muy contentos de que comencemos a trabajar juntos por todos los objetivos planteados! 🙌🏽

Por acá te comparto el próximo paso, es un video explicativo de la plataforma Skool, donde vas a encontrar módulos con herramientas y videos que te van a servir durante todo el proceso. 

Cualquier duda o consulta que tengas, estamos a disposición! 
A avanzar con todo! 💪🏼

Link de la plataforma:
<URL_CONFIGURADA_PRIVADAMENTE>

Te va a llegar una invitación a tu correo (<EMAIL_PRIVADO_CONFIGURADO>) para entrar a la plataforma.
```

### Aviso en Verificaciones C.J

```text
CUENTA_QA CUENTA_QA ya pagó. Invitalo a Skool: Configuración → Invitar → correo: <EMAIL_PRIVADO_CONFIGURADO>
```

---

## Ejemplo 2: mujer, con correo

**#ALTA:** Lucía Benítez, +54 9 341 …, sin socios, <EMAIL_PRIVADO_CONFIGURADO>. Cambia solo "Muy bienvenida".

### Mensaje del grupo General (pie del video, 688 caracteres)

```text
Hola Lucía! Cómo va? Muy bienvenida a Capital Jurídico!
Me presento: soy {FIRMA_OPERACIONES}, encargada de operaciones de la empresa. 
Estamos muy contentos de que comencemos a trabajar juntos por todos los objetivos planteados! 🙌🏽

Por acá te comparto el próximo paso, es un video explicativo de la plataforma Skool, donde vas a encontrar módulos con herramientas y videos que te van a servir durante todo el proceso. 

Cualquier duda o consulta que tengas, estamos a disposición! 
A avanzar con todo! 💪🏼

Link de la plataforma:
<URL_CONFIGURADA_PRIVADAMENTE>

Te va a llegar una invitación a tu correo (<EMAIL_PRIVADO_CONFIGURADO>) para entrar a la plataforma.
```

### Aviso en Verificaciones C.J

```text
Lucía Benítez ya pagó. Invitalo a Skool: Configuración → Invitar → correo: <EMAIL_PRIVADO_CONFIGURADO>
```

---

## Ejemplo 3: con una socia (plural)

**#ALTA:** CUENTA_QA Salas, +54 9 11 …, socia Ana Gómez +54 9 11 …, <EMAIL_PRIVADO_CONFIGURADO>. Va "Hola CUENTA_QA y Ana! … Muy bienvenidos" y el resto en plural. El correo es el del cliente (el del #ALTA).

### Mensaje del grupo General (pie del video, 698 caracteres)

```text
Hola CUENTA_QA y Ana! Cómo va? Muy bienvenidos a Capital Jurídico!
Me presento: soy {FIRMA_OPERACIONES}, encargada de operaciones de la empresa. 
Estamos muy contentos de que comencemos a trabajar juntos por todos los objetivos planteados! 🙌🏽

Por acá les comparto el próximo paso, es un video explicativo de la plataforma Skool, donde van a encontrar módulos con herramientas y videos que les van a servir durante todo el proceso. 

Cualquier duda o consulta que tengan, estamos a disposición! 
A avanzar con todo! 💪🏼

Link de la plataforma:
<URL_CONFIGURADA_PRIVADAMENTE>

Les va a llegar una invitación a su correo (<EMAIL_PRIVADO_CONFIGURADO>) para entrar a la plataforma.
```

### Aviso en Verificaciones C.J

```text
CUENTA_QA Salas ya pagó. Invitalo a Skool: Configuración → Invitar → correo: <EMAIL_PRIVADO_CONFIGURADO>
```

---

## Ejemplo 4: sin correo en el #ALTA

**#ALTA:** CUENTA_QA CUENTA_QA, +54 9 341 …, sin socios, sin correo. La última línea va sin el correo entre paréntesis, y el aviso de Verificaciones C.J pide el correo al closer antes de invitarla a Skool.

### Mensaje del grupo General (pie del video, 663 caracteres)

```text
Hola CUENTA_QA! Cómo va? Muy bienvenida a Capital Jurídico!
Me presento: soy {FIRMA_OPERACIONES}, encargada de operaciones de la empresa. 
Estamos muy contentos de que comencemos a trabajar juntos por todos los objetivos planteados! 🙌🏽

Por acá te comparto el próximo paso, es un video explicativo de la plataforma Skool, donde vas a encontrar módulos con herramientas y videos que te van a servir durante todo el proceso. 

Cualquier duda o consulta que tengas, estamos a disposición! 
A avanzar con todo! 💪🏼

Link de la plataforma:
<URL_CONFIGURADA_PRIVADAMENTE>

Te va a llegar una invitación a tu correo para entrar a la plataforma.
```

### Aviso en Verificaciones C.J

```text
CUENTA_QA CUENTA_QA ya pagó, pero el #ALTA no trae correo: pedíselo al closer antes de invitarlo a Skool.
```

**Avisos para quien aprueba:** Falta el correo del #ALTA: la última línea va sin el correo y COORDINACION no tiene a dónde mandar la invitación de Skool (pedírselo al closer).

---

## Doc "Bienvenida - Lucía Benítez" (solo cambió lo de Skool)

Con socios pasa al plural de la misma forma ("Graben…", "Suban…", "avísennos").

```text
[Título] Bienvenida a Capital Jurídico

Lucía, esta carpeta es el espacio de trabajo que compartimos con vos durante el programa. Acá vas a encontrar los guiones de tus videos, vas a subir tus grabaciones y vas a ver los videos editados que usamos en los anuncios.

[Subtítulo] Qué hay en esta carpeta
• Guiones: los textos de tus videos. Los escribe nuestro equipo y avisamos en el grupo Contenido cuando hay una tanda lista para grabar.
• Crudos: tus grabaciones tal como salen del celular, sin editar.
• Editados: los videos terminados, listos para los anuncios.

[Subtítulo] Cómo subir las grabaciones
• Grabá con la cámara del celular, sin filtros.
• Dejá uno o dos segundos de silencio antes y después de hablar, mirando a cámara.
• Subí el archivo original a la carpeta Crudos desde la app de Google Drive (botón +, Subir). No lo mandes por WhatsApp: se comprime y pierde calidad.
• Un archivo por guion, con el número o el título del guion en el nombre.
• Cuando termines de subir, avisanos en el grupo Contenido.

[Subtítulo] Próximos pasos
• Mirar el video de bienvenida sobre Skool: ${AUTH_BASE_URL}/v/<ID_PRIVADO_CONFIGURADO>.mp4
• Entrar a la comunidad de Skool con la invitación que llega al correo <EMAIL_PRIVADO_CONFIGURADO>: <URL_CONFIGURADA_PRIVADAMENTE>
• Completar el onboarding en Skool (Classroom → Onboarding).
• Agendar la llamada de kickoff desde el onboarding.
• Grabar la primera tanda de guiones cuando la compartamos.

[Subtítulo] A quién escribir
• Grupo General: accesos, Skool y dudas generales. Las invitaciones a Skool las manda CUENTA_QA, de operaciones.
• Grupo Contenido: guiones, grabaciones y edición.
• Grupo Ventas: cómo atender las consultas que lleguen por los anuncios.

Equipo de Capital Jurídico
```

---

## Para que decida RESPONSABLE_HUB

1. ~~**Socios y correo.**~~ **Decidido por RESPONSABLE_HUB el 24/10/2026:** los socios también entran a Skool. El #ALTA trae el correo de cada socio (un socio sin correo es un faltante), el mensaje dice "Les va a llegar una invitación a sus correos (…)" con los de todos y el aviso a COORDINACION lista todos los correos ("Invitalo"). Ver docs/BOT-ALTA-CJ.md, "Socios con correo".
2. **Socias mujeres.** Con socios va siempre "Muy bienvenidos", como se aprobó. Si son todas mujeres, ¿va "Muy bienvenidas"?
3. **Firma del doc de Drive.** El doc sigue firmado por "Equipo de Capital Jurídico". ¿Queda así, o lo firma CUENTA_QA como el mensaje?
4. **Consejos de grabación del doc.** Salen de la bóveda ("Proceso de delivery y CSM": cámara del celular sin filtros, mirar a cámara, subir el original a Drive y no por WhatsApp). Hay dos propuestas mías para confirmar:
   - "un archivo por guion, con el número o el título en el nombre";
   - "avisar en el grupo Contenido cuando terminás de subir".
5. **Grupo Ventas en el doc:** "cómo atender las consultas que lleguen por los anuncios". ¿Así se le explica al cliente para qué es ese grupo?
6. **Video de Skool.** El video actual dice que hay que pedir acceso con el link; con la invitación por correo ese paso ya no va. El video nuevo tendría que mostrar cómo entrar con la invitación que llega al correo.

## Cómo se manda cuando esté aprobado (todavía no está hecho)

1. El bot publica en Verificaciones C.J el mensaje, el doc y los avisos, y espera el "OK" citado.
2. Con el OK:
   - crea el doc con `crearDoc` del Puente Drive, en la carpeta del cliente;
   - manda al grupo General el video como archivo, con el texto como pie. Si `entraComoPie` es false, manda el video y después el texto aparte;
   - publica el `avisoVerificaciones` para que COORDINACION mande la invitación desde Skool (Configuración → Invitar).
3. Con un "NO" y el motivo, no se manda nada y se corrige a mano.


## Firma configurable

`BOT_BIENVENIDA_FIRMA` configura `{FIRMA_OPERACIONES}` sin roster en Git. El fallback genérico es Operaciones; las pruebas usan Operaciones QA. No implica permiso de acceso ni habilita un envío.
