import { unzipSync } from 'fflate';

/**
 * CSD-importar — descomprime un .zip de fotos → mapa nombre de archivo → bytes.
 * La plantilla de importación (web) pide el "nombre exacto del archivo dentro del
 * .zip" por fila; se indexa por BASENAME (no por ruta completa) para que un .zip con
 * carpetas (p. ej. exportado por macOS/Windows) siga emparejando igual.
 */
export function unzipToMap(buffer: ArrayBuffer): Map<string, Uint8Array> {
  const files = unzipSync(new Uint8Array(buffer));
  const map = new Map<string, Uint8Array>();
  for (const [path, bytes] of Object.entries(files)) {
    if (!bytes.length) continue; // entradas de carpeta
    const filename = path.split('/').pop() ?? path;
    if (filename) map.set(filename, bytes);
  }
  return map;
}

/** Content-Type best-effort a partir de la extensión (para el upload a Storage). */
export function mimeForFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'heic':
    case 'heif':
      return 'image/heic';
    case 'gif':
      return 'image/gif';
    default:
      return 'image/jpeg';
  }
}
