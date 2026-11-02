/** Lee un Blob y devuelve su contenido en base64 (sin el prefijo `data:...;base64,`). */
export function blobABase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = String(r.result);
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    r.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    r.readAsDataURL(blob);
  });
}
