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

/**
 * Comprime una imagen (Blob/File) según el perfil de destino (por defecto
 * 'evidencia'). Devuelve el original si no es imagen, si falla la recodificación,
 * o si la "compresión" salió más pesada (imágenes ya muy optimizadas) — nunca
 * subir más bytes de los que llegaron.
 */
export async function comprimirImagen(
  source: Blob,
  perfil: PerfilCompresion = 'evidencia',
): Promise<Blob> {
  if (!source.type.startsWith('image/')) return source;
  const { maxLado, calidad } = PERFILES_COMPRESION[perfil] ?? PERFILES_COMPRESION.evidencia;
  try {
    const bitmap = await createImageBitmap(source);
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
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', calidad),
    );
    // Liberar el canvas explícitamente (móviles low-mem MIUI/OUKITEL).
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) return source;
    if (blob.size >= source.size) return source;
    return blob;
  } catch {
    return source;
  }
}
