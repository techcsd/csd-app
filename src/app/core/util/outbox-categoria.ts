import { OutboxOp } from '../db/app-db';

/**
 * BG1 — las TRES categorías de un fallo del outbox (contrato
 * docs/BG1-outbox-3-categorias-contrato.md). Antes eran dos (transitorio vs
 * permanente); la tercera —'sistema'— nace de las bitácoras REALES de un
 * ingeniero atascadas por "new row violates row-level security policy": un
 * error que NO es culpa del usuario ni de su dato, sino del sistema mal
 * configurado. Regla madre de la tanda: la data real de obra NUNCA se pierde.
 *
 * | Categoría    | Señal (SQLSTATE / red)                    | Manejo |
 * |--------------|-------------------------------------------|--------|
 * | transitorio  | red, 5xx, 40001, 57014                     | auto-retry con backoff |
 * | dato         | 22023 (campo), 22P02, 23502, 23503, 23505 | "Corregir", sin auto-retry |
 * | sistema      | 42501 RLS, 23514 check, 22001 varchar, PGRST2xx | conservar indefinidamente; reintento post-fix; Descartar escondido |
 */
export type OutboxCategoria = 'transitorio' | 'dato' | 'sistema';

type FalloOp = Pick<
  OutboxOp,
  'estado' | 'error_kind' | 'error_code' | 'error_campo' | 'permanente'
>;

/**
 * Clasifica un item del outbox por el CÓDIGO del error (no por el texto): una
 * sola fuente de verdad para la UI de "Pendientes de envío" y para la telemetría.
 */
export function outboxCategoria(op: FalloOp): OutboxCategoria {
  // Aún no falló (pending/syncing) o transitorio agotado sin causa permanente.
  if (op.estado !== 'error') return 'transitorio';

  const code = (op.error_code ?? '').trim();
  const kind = op.error_kind ?? '';

  // ── DATO ── el servidor señaló un campo concreto (error tipado 22023) o el
  // código dice "corrige tu dato". Estos NO se auto-reintentan: se corrigen.
  if (op.error_campo) return 'dato';
  if (/^22023/.test(code) || /^22P02/.test(code) || /^23502/.test(code) || /^23503/.test(code) || /^23505/.test(code)) {
    return 'dato';
  }

  // ── SISTEMA ── RLS mal configurada (42501), check/columna desactualizada
  // (23514 / 22001 varchar), o desajuste de firma/esquema (PGRST2xx). El permiso
  // de NEGOCIO existe; lo que falla es la configuración del servidor. Regla de
  // desempate del contrato: "si el server puede decir 'esto lo arreglo yo', es
  // sistema". Se conserva indefinidamente y se reintenta cuando se publique el fix.
  if (/^42501/.test(code) || /^23514/.test(code) || /^22001/.test(code)) return 'sistema';
  if (kind === 'permiso' || kind === 'incompatible') return 'sistema';

  // ── Foto perdida en el teléfono ── necesita acción del usuario (recapturar):
  // se trata como 'dato' (sin auto-retry, con salida clara), no como 'sistema'.
  if (kind === 'foto') return 'dato';

  // Familias de dato por clasificación previa (validación del RPC, referencia rota,
  // conflicto/duplicado, destino inexistente): el usuario corrige o descarta.
  if (kind === 'validacion' || kind === 'datos' || kind === 'referencia' || kind === 'conflicto' || kind === 'no-encontrado') {
    return 'dato';
  }

  // Transitorio agotado (red inestable) sin marca de permanente: se puede
  // reintentar en bloque. Si quedó permanente sin causa clara, lo tratamos como
  // sistema (conservar + reintento manual) — nunca invitamos a borrar data real.
  return op.permanente ? 'sistema' : 'transitorio';
}

/**
 * BG1 — el mensaje de la categoría 'sistema' NO culpa al usuario: el permiso de
 * negocio existe; lo que falla es la configuración del servidor. Reemplaza el
 * texto viejo "No tienes permiso para enviar esto. Contacta a un administrador".
 */
export const MENSAJE_SISTEMA =
  'Esto es un problema del sistema — ya quedó reportado a Tecnología. Podrás reintentarlo cuando se publique la corrección. Tu información sigue guardada aquí.';

/** BG1 — advertencia de pérdida para el descarte (data real de obra). */
export const AVISO_PERDIDA_SISTEMA =
  'Esta bitácora es data real de la obra y NO está guardada en el servidor. Si la borras, se pierden para siempre sus datos y fotos.';

/** BG1 — etiqueta y tono del chip de categoría para la UI. */
export function categoriaPill(cat: OutboxCategoria): { label: string; tone: 'sistema' | 'dato' | 'transitorio' } {
  if (cat === 'sistema') return { label: 'Problema del sistema', tone: 'sistema' };
  if (cat === 'dato') return { label: 'Revisar dato', tone: 'dato' };
  return { label: 'Esperando envío', tone: 'transitorio' };
}
