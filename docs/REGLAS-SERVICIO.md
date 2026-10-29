# Servicio, referidos y reversas

## Fechas y pausa

El fin efectivo del servicio combina contrato, extensiones confirmadas y pausas. Una extensión admite meses calendario, semanas o duración personalizada. Usar los helpers de fechas del dominio; no aproximar un mes con treinta días si la regla pide calendario.

Pausar registra el inicio y detiene el consumo de servicio. Retomar compensa el intervalo aplicable, guarda el cierre de pausa y evita contabilizarlo de nuevo. Los eventos aparecen en la línea de tiempo. La proyección/renovación debe usar el fin efectivo, no una fecha antigua guardada en otra vista.

## Cliente nuevo referido

Cuando un referido cierra y entra como cliente nuevo recibe un mes calendario adicional sin cargo. La operación comprueba que no esté incluido; conserva su procedencia e idempotencia. No otorgar además una segunda extensión por releer el mismo cierre. Este beneficio pertenece al nuevo cliente y no consume créditos del referidor.

## Renovación y meses del referidor

La vista previa calcula meses liberados, vigentes y elegibles y las fechas resultantes según los topes. Su huella se devuelve en `renovacionReferidos.huella` y la confirmación aporta `referidosEsperados`. Si cambió el saldo, rechazar y revisar otra vez.

La reserva de canje y la acción de renovación comparten transacción PostgreSQL; las celdas relacionadas de renovación/crédito se envían juntas en el batch de Sheets. Un doble clic o replay no agrega meses ni vuelve a consumir saldo. Pausar, reanudar, proyectar o cambiar de etapa no canjea créditos.

Los créditos monetarios no se consumen automáticamente. Requieren un canje separado y confirmado. Una renovación que contiene canje no se deshace como si fuese una extensión simple: conservar las restricciones del resultado y reconciliar cualquier corrección explícita.

## Pagos y contabilidad

La acción de pago requiere las capacidades de Finanzas además de Clientes. El tipo de venta (`Front-end`/`Back-end`) no se deduce de que sea una segunda cuota. Una renovación exige el tipo correspondiente. La modalidad del programa determina el tipo de pago; si es ambigua, pedir el dato en la revisión.

Escribir el ledger por el adaptador financiero y comprobar lectura de vuelta. Una extensión gratuita o una pausa no crea un cobro. No borrar registros contables al archivar un cliente. Mantener separadas las cifras contratadas, cobradas y pendientes.

## Reversas

Una reversa usa la acción original y la misma reserva/identidad. Relee celdas y rechaza si otra persona las modificó o si hubo consecuencias que impiden una reversa segura. Ante respuesta perdida, consultar/reconciliar el mismo intento antes de hacer otro. El historial no se elimina.
