import Link from "next/link";
import { ESTILO_WHATSAPP } from "@/components/crm/estilosWhatsApp";
import type { ReactNode } from "react";
import type { FichaLead } from "@/lib/crm/contratos";
import { CAMPOS_CONTEXTO, CAMPOS_ESTADO, ETIQUETA_CAMPO, datosFichaDesde, esLink } from "@/lib/crm/ficha";
import { claveIdentidad } from "@/lib/crm/pantalla";
import { urlPerfilInstagram, type InstagramAgenda } from "@/lib/crm/instagram";
import { urlChat } from "@/lib/crm/presentacion";
import type { Campo } from "@/lib/crm/sheets/columnas";
import { FormularioFicha } from "./FormularioFicha";
import { NotasReagenda } from "./NotasReagenda";

// El cuerpo de la ficha del lead (docs/arquitectura.md §Ficha), igual en la página
// /lead/[hoja]/[fila] (server component) y en el panel lateral del tablero (cliente, con
// `obtenerFicha`). Sin hooks ni datos del servidor: todo entra por props.

type Props = {
  ficha: FichaLead;
  /** El bloque "Acciones de hoy" (va primero): las tarjetas con los mismos botones que "Mi día". */
  accion: ReactNode;
  /** true en la página (dos columnas en la computadora); false en el panel de 420 px. */
  dosColumnas?: boolean;
};

// Links con área táctil de 44 px sin cambiar el alto de la línea (texto de 20 px + 12 px arriba y abajo).
const LINK = "-my-3 inline-block py-3 font-semibold text-dorado-oscuro underline underline-offset-2";

export function ContenidoFicha({ ficha, accion, dosColumnas = false }: Props) {
  const { identidad, valores, historial } = ficha;
  const telefono = valores.telefono.trim();
  // Mismo criterio que la tarjeta: sin ningún dígito ("-", "sin tel") no hay llamada ni chat
  // (sería un link a "https://web.whatsapp.com/send?phone=" sin número); se muestra el texto tal cual.
  const tieneTelefono = /\d/.test(telefono);
  const chat = urlChat(identidad.hoja, telefono);
  const email = valores.email.trim();
  // Si en esta fila ahora hay otro lead (alguien ordenó la planilla o le corrigió el nombre o el
  // teléfono), las notas y el formulario se vuelven a montar con lo suyo: lo escrito para el anterior
  // no se guarda en este sin que el closer lo decida, y si quedó algo sin guardar se avisa (con lo
  // escrito, para copiarlo), con lo que cada uno anota en la pestaña.
  const lead = claveIdentidad(identidad);

  return (
    <div className={dosColumnas ? "lg:grid lg:grid-cols-2 lg:items-start lg:gap-4" : ""}>
      <div className="space-y-4">
        <section>
          <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-dorado-oscuro">
            Acciones de hoy
          </h2>
          {accion}
        </section>

        {/^cerrado en /i.test(valores.situacion.trim()) && <section className="rounded-2xl border border-dorado bg-blanco p-4"><h2 className="text-lg font-bold">Plan de cobro</h2><p className="mt-2 text-sm text-gris-texto">Si quedaron cuotas pendientes, cargalas en Cuotas. El pago recibido en el cierre no se importa automáticamente.</p><Link href={`/cuotas?${new URLSearchParams({nuevo:"si",nombre:identidad.nombre,telefono:identidad.telefono,hoja:identidad.hoja}).toString()}`} className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-dorado px-3 font-bold">Crear plan de cuotas</Link></section>}
        <section className="rounded-2xl border border-gris-linea bg-blanco p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gris-texto">Contacto</h2>
          <dl className="text-sm">
            <Dato etiqueta="Teléfono">
              {!telefono ? (
                "—"
              ) : !tieneTelefono ? (
                telefono
              ) : (
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <a href={`tel:${telefono.replace(/[^\d+]/g, "")}`} className={LINK}>
                    {telefono}
                  </a>
                  {/* Mismo enlace a WhatsApp Web que en la tarjeta, sin mensaje precargado. */}
                  <a
                    href={chat.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-bold ${ESTILO_WHATSAPP}`}
                  >
                    WhatsApp Web <span aria-hidden="true">&nbsp;↗</span>
                  </a>
                </span>
              )}
            </Dato>
            <Dato etiqueta="Email">
              {email ? (
                <a href={`mailto:${email}`} className={`${LINK} break-all`}>
                  {email}
                </a>
              ) : (
                "—"
              )}
            </Dato>
            <Dato etiqueta={ETIQUETA_CAMPO.fechaCall}>{valores.fechaCall.trim() || "—"}</Dato>
            <Dato etiqueta={ETIQUETA_CAMPO.linkCall}>
              <Valor texto={valores.linkCall} />
            </Dato>
          </dl>
        </section>

        <section className="rounded-2xl border border-gris-linea bg-blanco p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gris-texto">Estado</h2>
          <dl className="text-sm">
            {CAMPOS_ESTADO.map((c) => (
              <Dato key={c} etiqueta={ETIQUETA_CAMPO[c]}>
                {valores[c].trim() || <span className="text-gris-texto">—</span>}
              </Dato>
            ))}
          </dl>
        </section>

        <section className="rounded-2xl border border-gris-linea bg-blanco p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gris-texto">{ETIQUETA_CAMPO.datosReagenda} · notas</h2>
          <NotasReagenda key={lead} identidad={identidad} original={datosFichaDesde(valores)} />
        </section>
      </div>

      <div className={`mt-4 space-y-4 ${dosColumnas ? "lg:mt-0" : ""}`}>
        <section className="rounded-2xl border border-gris-linea bg-blanco p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gris-texto">Antes de la call</h2>
          <Contexto valores={valores} instagram={ficha.instagram} />
        </section>

        <section className="rounded-2xl border border-gris-linea bg-blanco p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gris-texto">Cierre y grabaciones</h2>
          <FormularioFicha key={lead} identidad={identidad} original={datosFichaDesde(valores)} />
        </section>

        <section className="rounded-2xl border border-gris-linea bg-blanco p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gris-texto">Historial (Log App)</h2>
          {historial.length === 0 ? (
            <p className="text-sm text-gris-texto">Todavía no hay acciones registradas desde la app.</p>
          ) : (
            <ul className="divide-y divide-gris-linea text-sm">
              {historial.map((e, i) => (
                <li key={`${e.operacion}-${e.columna}-${i}`} className="py-2">
                  <p className="tabular text-xs text-gris-texto">
                    {e.fecha} · {e.closer}
                  </p>
                  <p className="wrap-anywhere">
                    <span className="font-semibold">{ETIQUETA_CAMPO[e.campo as Campo] ?? e.columna}</span>: {e.antes || "—"} →{" "}
                    <span className="font-semibold">{e.despues || "—"}</span>
                  </p>
                  {e.motivo && <p className="break-words text-xs text-gris-texto">{e.motivo}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-gris-linea py-2 last:border-b-0">
      <dt className="w-32 shrink-0 text-gris-texto">{etiqueta}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

/** Un texto de la planilla: link si lo es, "—" si está vacío. */
function Valor({ texto }: { texto: string }) {
  const valor = texto.trim();
  if (!valor) return <span className="text-gris-texto">—</span>;
  if (esLink(valor)) {
    return (
      <a href={valor} target="_blank" rel="noopener noreferrer" className={`${LINK} break-all`}>
        {valor}
      </a>
    );
  }
  return <>{valor}</>;
}

function Contexto({ valores, instagram }: { valores: Record<Campo, string>; instagram?: InstagramAgenda }) {
  const conValor = CAMPOS_CONTEXTO.filter((c) => valores[c].trim());
  const texto = instagram?.estado === "disponible" ? instagram.texto : "";
  const perfil = urlPerfilInstagram(texto);
  return (
    <dl className="text-sm">
      <Dato etiqueta="Instagram">
        {perfil ? <a href={perfil} target="_blank" rel="noopener noreferrer" className={`${LINK} break-all`}>{texto}<span className="sr-only"> (abre otra pestaña)</span></a>
          : texto || <span className="text-gris-texto">{instagram?.estado === "no_disponible" ? "No disponible" : "—"}</span>}
      </Dato>
      {conValor.map((c) => (
        <Dato key={c} etiqueta={ETIQUETA_CAMPO[c]}>
          <Valor texto={valores[c]} />
        </Dato>
      ))}
    </dl>
  );
}
