// BJ1 — Compresor ÚNICO de imágenes con perfiles por destino. Reemplaza los
// números sueltos que había regados por la app (camera.service 1280/0.7,
// in-app-camera 1280/0.7, avatar-editor 0.9). Redimensiona al lado máximo del
// perfil y recodifica a JPEG en el ÚNICO punto sin pérdida previa: la captura.
// Si el archivo no es imagen o algo falla, devuelve el original (nunca bloquea
// la subida).
//
// ⚠️ FIRMAS: NO pasar por aquí. Son trazo sobre fondo transparente (PNG); pasarlas
// a JPEG mata la transparencia. Las firmas se suben tal cual (PNG).
//
// ⚠️ NO re-comprimir bytes ya comprimidos (outbox/subida): sería pérdida
// generacional. Solo se comprime en captura/selección, antes de encolar.
//
// Paridad: los MISMOS perfiles viven en la web (shared/utils/comprimir-imagen.util).
// Si cambias un número, cámbialo en AMBOS repos (lección BH5).

export type PerfilCompresion = 'evidencia' | 'documento' | 'avatar' | 'sticker';

export interface PerfilConfig {
  /** px del lado mayor */
  maxLado: number;
  /** 0..1 JPEG */
  calidad: number;
}

// Números de la propuesta BJ1 (§F). Un solo lugar para tunear.
// evidencia: decisión Xaviel (BJ1 §F) = MÁXIMO AHORRO → 1280/0.72 en AMBOS repos.
// Antes el nativo pasaba sólo `width:1280` (dejaba el lado largo de las verticales
// sin acotar, ~1707px); ahora width+height=1280 acota ambos lados → puro ahorro sin
// subir las horizontales. Si cambias evidencia, cámbialo también en la web.
export const PERFILES_COMPRESION: Record<PerfilCompresion, PerfilConfig> = {
  evidencia: { maxLado: 1280, calidad: 0.72 }, // fotos de obra/conduce/checklist
  documento: { maxLado: 2000, calidad: 0.8 }, // legibilidad de documentos escaneados
  avatar: { maxLado: 512, calidad: 0.8 }, // foto de perfil
  sticker: { maxLado: 512, calidad: 0.8 }, // stickers propios
};

/**
 * Parámetros equivalentes para la cámara NATIVA de Capacitor (`Camera.getPhoto` /
 * `Camera.pickImages`), que redimensiona + comprime en el DISPOSITIVO (mucho más
 * rápido que decodificar la foto a resolución completa en un canvas JS). `quality`
 * es 0..100. Pasamos width Y height = maxLado para acotar el LADO MAYOR en ambas
 * orientaciones (pasar solo `width` dejaba las fotos verticales sin acotar → más peso).
 */
export function perfilNativo(perfil: PerfilCompresion = 'evidencia'): {
  quality: number;
  width: number;
  height: number;
} {
  const { maxLado, calidad } = PERFILES_COMPRESION[perfil] ?? PERFILES_COMPRESION.evidencia;
  return { quality: Math.round(calidad * 100), width: maxLado, height: maxLado };
}

/** CE6 — ¿el archivo es HEIC/HEIF (iPhone)? Por mime o por extensión del nombre. */
function esHeic(source: Blob): boolean {
  const t = (source.type || '').toLowerCase();
  const n = ((source as File).name || '').toLowerCase();
  return t.includes('heic') || t.includes('heif') || n.endsWith('.heic') || n.endsWith('.heif');
}

/**
 * CE6 — convierte un HEIC/HEIF a JPEG con `heic2any` (carga perezosa: solo pesa
 * cuando de verdad llega un HEIC). Si falla, propaga para que el llamador siga con
 * el original (y la validación de monocromo decida).
 */
async function convertirHeic(source: Blob): Promise<Blob> {
  const mod = await import('heic2any');
  const heic2any = (mod as unknown as {
    default: (o: { blob: Blob; toType?: string; quality?: number }) => Promise<Blob | Blob[]>;
  }).default;
  const out = await heic2any({ blob: source, toType: 'image/jpeg', quality: 0.92 });
  return Array.isArray(out) ? out[0] : out;
}

/**
 * CE6 — ¿el canvas quedó MONOCROMO (todo del mismo color, típicamente negro)? Es la
 * firma de una decodificación fallida (HEIC que el WebView no leyó, o un alpha que
 * se aplanó mal). Muestreamos ~2000 píxeles; si todos son (casi) iguales → true.
 */
function esMonocromo(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    const step = Math.max(4, Math.floor(data.length / 4 / 2000) * 4);
    let r0 = -1, g0 = -1, b0 = -1;
    for (let i = 0; i < data.length; i += step) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r0 < 0) { r0 = r; g0 = g; b0 = b; continue; }
      if (Math.abs(r - r0) > 6 || Math.abs(g - g0) > 6 || Math.abs(b - b0) > 6) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Comprime una imagen (Blob/File) según el perfil de destino (por defecto
 * 'evidencia'). Devuelve el original si no es imagen, si falla la recodificación,
 * o si la "compresión" salió más pesada (imágenes ya muy optimizadas) — nunca
 * subir más bytes de los que llegaron.
 *
 * CE6 — robustez de la foto de personal (caso Sonia "primera foto toda negra"):
 *  1) HEIC/HEIF del iPhone → se convierte a JPEG con `heic2any` antes de dibujar.
 *  2) **Fondo blanco ANTES de `drawImage`**: un PNG con transparencia aplanado a
 *     JPEG dejaba los píxeles transparentes en NEGRO. Pintamos blanco primero.
 *  3) Si el resultado queda MONOCROMO (negro) y el origen no era HEIC, se descarta
 *     la recodificación y se conserva el original (nunca guardar un cuadro negro).
 *  Misma función para las 5 fotos del expediente (paridad con la web, CE6).
 */
export async function comprimirImagen(
  source: Blob,
  perfil: PerfilCompresion = 'evidencia',
): Promise<Blob> {
  const esImagen = source.type.startsWith('image/') || esHeic(source);
  if (!esImagen) return source;
  const { maxLado, calidad } = PERFILES_COMPRESION[perfil] ?? PERFILES_COMPRESION.evidencia;
  const heic = esHeic(source);
  try {
    let fuente: Blob = source;
    if (heic) {
      try {
        fuente = await convertirHeic(source);
      } catch {
        /* sigue con el original: la validación de monocromo decide */
      }
    }

    const bitmap = await createImageBitmap(fuente);
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * escala);
    const h = Math.round(bitmap.height * escala);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return source;
    }
    // CE6 — fondo blanco ANTES de dibujar (transparencia → blanco, no negro).
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    // CE6 — si salió todo negro/monocromo (decodificación fallida) y no era HEIC,
    // conserva el original en vez de subir un cuadro negro.
    if (!heic && esMonocromo(ctx, w, h)) {
      canvas.width = 0;
      canvas.height = 0;
      return source;
    }

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', calidad),
    );
    // Liberar el canvas explícitamente (móviles low-mem MIUI/OUKITEL).
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) return source;
    // Un HEIC convertido SIEMPRE se queda (el original no lo renderiza Android);
    // para el resto, nunca subir más bytes de los que llegaron.
    if (!heic && blob.size >= source.size) return source;
    return blob;
  } catch {
    return source;
  }
}
