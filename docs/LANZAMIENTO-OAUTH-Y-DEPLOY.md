# OAuth y despliegue: procedimiento sin configuración de entorno

Esta guía no incluye un dominio, usuario o proyecto productivo. Consultar [ACCESO-Y-ROLES.md](ACCESO-Y-ROLES.md), [CONFIGURACION-PRIVADA.md](CONFIGURACION-PRIVADA.md) y [RUNBOOK.md](RUNBOOK.md).

## OAuth

1. Preparar una credencial web del proyecto autorizado y su pantalla de consentimiento con los alcances requeridos.
2. Configurar el origen privado `AUTH_BASE_URL` y la URI que termina en `/api/auth/google/callback`. Deben coincidir exactamente; no aceptar destinos de retorno arbitrarios.
3. Guardar ID/secreto del cliente, secreto de sesión y `AUTH_USUARIOS` fuera de Git. No usar una dirección publicada como usuario por defecto.
4. Comprobar PKCE, state, nonce, emisor, audiencia, expiración y correo verificado; además exigir pertenencia a la lista autorizada.
5. Probar ausencia de sesión, actor no autorizado y actor autorizado por sección. No confundir login correcto con acceso a Finanzas o capacidad de envío.

## Candidato y producción

Las variables se cargan para el entorno correcto y se releen según el despliegue. Un cambio de roster o secreto requiere la publicación que corresponda. Rotar el secreto invalida sesiones anteriores; quitar un actor de la lista no necesita conservar su sesión hasta el vencimiento.

Preparar un candidato revisable, ejecutar checks, verificar servicios/configuración sin exponer valores y revisar el flujo real autorizado. Sólo después promover y comprobar el dominio y versión efectivos. La importación pública de Git no autoriza configurar el hosting ni mover un dominio de producción.

Mantener WhatsApp apagado, anuncios preparados en `PAUSED` y capacidad mínima por módulo. No habilitar una API del proyecto, compartir recursos o cambiar permisos como efecto lateral de una prueba no relacionada.

## Evidencia

Guardar estados HTTP, versión y resultado sin capturar tokens, sesiones, QR o datos de cliente. Distinguir build correcto, deploy listo, acceso autorizado y efecto de negocio leído de vuelta. Una captura de login o una prueba simulada no prueba la entrega externa.
