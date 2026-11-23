// DX7/F4 — QR de documentos del sistema. El QR codifica `<origen>/d/<token>` (o el legado
// `/conduce-qr/<token>` del conduce). El token NO otorga permisos: solo identifica {tipo,id};
// el servidor y la RLS deciden quién puede abrir qué.
export type TipoDocQr = 'conduce' | 'requisicion' | 'solicitud_compra';

const TOKEN_CRUDO = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){2,3}$/;

/** Extrae el token de lo que leyó la cámara: URL `/d/<token>`, URL `/conduce-qr/<token>` o token crudo. */
export function extraerTokenQr(texto: string | null | undefined): string | null {
  const t = (texto ?? '').trim();
  if (!t) return null;
  if (TOKEN_CRUDO.test(t)) return t;
  let path = '';
  try {
    path = new URL(t).pathname;
  } catch {
    return null;
  }
  const m = /^\/(?:d|conduce-qr)\/([^/]+)\/?$/.exec(path);
  if (!m) return null;
  let tok = m[1];
  try {
    tok = decodeURIComponent(tok);
  } catch {
    return null;
  }
  return TOKEN_CRUDO.test(tok) ? tok : null;
}

/** Pantalla de la app para un documento resuelto. `null` = la app no tiene pantalla para ese tipo. */
export function rutaAppDeDoc(tipo: string, id: string): { ruta: string; query?: Record<string, string> } | null {
  switch (tipo) {
    case 'conduce':
      return { ruta: '/transporte/por-confirmar', query: { abrir: id } };
    case 'requisicion':
      return { ruta: `/solicitudes/requisicion/${id}` };
    default:
      return null;
  }
}

/** Código de error de la edge → clave de mensaje (en español; se traduce con t()). */
export function mensajeErrorQr(codigo: string): string {
  switch (codigo) {
    case 'qr_desactivado':
      return 'Este tipo de QR aún no está disponible. Abre el documento desde tu bandeja.';
    case 'sin_red':
      return 'Necesitas conexión para abrir este QR.';
    case 'token_vencido':
      return 'Este QR ya venció. Pide que te compartan el documento de nuevo.';
    case 'no_encontrado':
      return 'Este documento ya no existe.';
    case 'sin_acceso':
      return 'No tienes acceso a esto.';
    case 'sin_pantalla':
      return 'Este documento se atiende desde el sistema en la computadora.';
    default:
      return 'Este QR no es válido. Pide que te compartan el documento de nuevo.';
  }
}
