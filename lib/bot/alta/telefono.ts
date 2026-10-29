// ── Bot "Capital Jurídico": teléfonos del #ALTA (docs/BOT-ALTA-CJ.md) ─────────────────────────────────
// Puro y sin red. Lo usan el parser (para dejar todos los números con código de país) y la fila de Finanzas
// (para escribirlos como en la planilla). Sin libphonenumber a propósito: alcanza con Argentina + el país.

// Códigos de área de Argentina de 3 dígitos (el 11 es el único de 2; el resto, de 4). Área + número = 10 dígitos.
const AREAS_3 = new Set([
  '220', '221', '223', '230', '236', '237', '249', '260', '261', '263', '264', '266', '280', '291', '294', '297', '298',
  '299', '336', '341', '342', '343', '345', '348', '351', '353', '358', '362', '364', '370', '376', '379', '380', '381',
  '383', '385', '387', '388',
])

// Códigos de 4 dígitos que empiezan como uno de 3 (Campana 3489 empieza como Escobar 348). Se miran ANTES que AREAS_3.
// La numeración argentina no se pisa: si 3489 es un área, ningún número de 348 empieza con 9.
const AREAS_4_QUE_CHOCAN = new Set([
  '2202',                                                 // Gallardo Catán (220 Merlo)
  '2302',                                                 // General Pico (230 Pilar)
  '2646', '2647', '2648',                                 // Valle Fértil, Jáchal, Calingasta (264 San Juan)
  '2940', '2942', '2945', '2946', '2948',                 // Jacobacci, Zapala, Esquel, Choele Choel, Chos Malal (294)
  '2972',                                                 // San Martín de los Andes (297 Comodoro)
  '2982', '2983',                                         // Orense, Tres Arroyos (298 General Roca)
  '3435', '3436', '3437', '3438',                         // Nogoyá, Victoria, La Paz, Bovril (343 Paraná)
  '3454', '3455', '3456', '3458',                         // Federal, Villaguay, Chajarí, Feliciano (345 Concordia)
  '3482', '3483', '3487', '3489',                         // Reconquista, Vera, Zárate, Campana (348 Escobar)
  '3532', '3533', '3537',                                 // Oliva, Las Varillas, Bell Ville (353 Villa María)
  '3582', '3583', '3584', '3585',                         // Sampacho, Vicuña Mackenna, La Carlota, Adelia María (358)
  '3835', '3837', '3838',                                 // Andalgalá, Tinogasta, Santa María (383 Catamarca)
  '3854', '3855', '3856', '3857', '3858',                 // Frías, Suncho Corral, Ojo de Agua, Bandera, Termas (385)
  '3876', '3877', '3878',                                 // Metán, J. V. Gallardo, Orán (387 Salta)
  '3885', '3886', '3887', '3888',                         // La Quiaca, Libertador, Humahuaca, San Pedro (388 Jujuy)
])

/** Largo del código de área de un número argentino nacional (sin 54 ni 9): 2, 3 o 4. */
export function largoAreaAr(nacional: string): 2 | 3 | 4 {
  if (AREAS_4_QUE_CHOCAN.has(nacional.slice(0, 4))) return 4
  if (nacional.startsWith('11')) return 2
  return AREAS_3.has(nacional.slice(0, 3)) ? 3 : 4
}

/** Número tal como lo escribió el closer → solo dígitos CON código de país.
 *  Sin "+" ni 54, se toma como argentino cuando es claro: empieza con 0 ("011 …", "0223 …"), trae el 15 después del
 *  área ("11 15 …") o son 10 dígitos que empiezan con 11, 2 o 3 → se le antepone 549 (WhatsApp es siempre móvil).
 *  Si no es claro (ej. "15 3000-1111", sin área) quedan los dígitos como vinieron: el parser avisa. */
export function normalizarTelefono(crudo: string): string {
  const d = crudo.replace(/\D/g, '')
  if (crudo.trim().startsWith('+')) return d
  if (d.startsWith('00')) return d.slice(2)                 // 00 + país (discado internacional)
  if (d.startsWith('54') && d.length >= 12) return d        // ya trae el 54
  let nacional = d.startsWith('0') ? d.slice(1) : d
  if (nacional.length === 12) {                              // área + 15 + número
    const largo = largoAreaAr(nacional)
    if (nacional.slice(largo, largo + 2) === '15') nacional = nacional.slice(0, largo) + nacional.slice(largo + 2)
  }
  if (nacional.length === 10 && /^(11|[23])/.test(nacional)) return `549${nacional}`
  return d
}

/** true si el número (ya normalizado) no parece traer código de país: lo tiene que confirmar un humano. */
export const telefonoSinPais = (numero: string) => !numero.startsWith('54') && numero.length <= 10

// Códigos de país de 1 y 2 dígitos (E.164); el resto son de 3.
const PAISES_1 = new Set(['1', '7'])
const PAISES_2 = new Set([
  '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49', '51', '52',
  '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91', '92',
  '93', '94', '95', '98',
])

/** Largo del código de país de un número con país (1, 2 o 3 dígitos). */
export function largoCodigoPais(d: string): 1 | 2 | 3 {
  if (PAISES_1.has(d.slice(0, 1))) return 1
  return PAISES_2.has(d.slice(0, 2)) ? 2 : 3
}
