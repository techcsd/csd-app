/**
 * BC3 — validación en el CLIENTE con las MISMAS reglas del servidor, para que un
 * registro que el servidor va a rechazar NO entre al outbox (se corrige en el
 * formulario con el campo señalado). Espejo del contrato
 * docs/BC3-outbox-validacion-contrato.md (SGC). El motivo usa el mismo enum
 * estable que `sgc.error_campo`.
 */
export type MotivoValidacion =
  | 'requerido'
  | 'formato_invalido'
  | 'no_existe'
  | 'fuera_de_rango'
  | 'duplicado'
  | 'requerida_para_completar';

/** Error de validación de un campo (no va al outbox: se corrige antes de encolar). */
export class ValidacionCampoError extends Error {
  campo: string;
  motivo: MotivoValidacion;
  constructor(campo: string, motivo: MotivoValidacion, mensaje: string) {
    super(mensaje);
    this.campo = campo;
    this.motivo = motivo;
  }
}

/** ¿Es un UUID v4 válido y no vacío? (mismo criterio que `sgc.es_uuid`). */
export function esUuid(v: string | null | undefined): boolean {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim())
  );
}

/** Exige que `valor` sea un UUID no vacío; si no, lanza el error tipado con el campo. */
export function exigirUuid(valor: string | null | undefined, campo: string, etiqueta: string): void {
  const v = (valor ?? '').trim();
  if (!v) throw new ValidacionCampoError(campo, 'requerido', `Falta ${etiqueta}.`);
  if (!esUuid(v)) throw new ValidacionCampoError(campo, 'formato_invalido', `${etiqueta} no tiene un identificador válido.`);
}
