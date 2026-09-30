/**
 * CD8 — UUID v5 determinista (RFC 4122, SHA-1) para idempotencia estable.
 *
 * `crypto.randomUUID()` (v4) sirve para operaciones NUEVAS (cada captura es única).
 * Pero al REENVIAR una echada rechazada necesitamos el MISMO `client_uuid` en cada
 * intento del usuario: así el servidor (`reenviar_echada`, idempotente por
 * `(reenvio_de, client_uuid)`) nunca crea dos reenvíos de la misma echada, aunque el
 * chofer pulse "reenviar" dos veces o reabra la pantalla. v5(namespace, nombre) es
 * estable: mismo nombre → mismo UUID.
 */

/** Namespace fijo de la app para los client_uuid derivados (v4 generado una vez). */
export const CSD_UUID_NAMESPACE = '6d1f2c8a-7b3e-4e5a-9c1d-2f8a6b4c9e70';

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function bytesToUuid(b: Uint8Array): string {
  const h: string[] = [];
  for (let i = 0; i < 16; i++) h.push(b[i].toString(16).padStart(2, '0'));
  return (
    h[0] + h[1] + h[2] + h[3] + '-' + h[4] + h[5] + '-' + h[6] + h[7] + '-' + h[8] + h[9] + '-' + h[10] + h[11] + h[12] + h[13] + h[14] + h[15]
  );
}

/**
 * UUID v5 (SHA-1) de `name` bajo `namespace`. Determinista: mismo (namespace, name)
 * → mismo UUID, siempre. Requiere `crypto.subtle` (contexto seguro — la app corre en
 * https/capacitor). Async por el digest.
 */
export async function uuidV5(name: string, namespace: string = CSD_UUID_NAMESPACE): Promise<string> {
  const nsBytes = hexToBytes(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const data = new Uint8Array(nsBytes.length + nameBytes.length);
  data.set(nsBytes, 0);
  data.set(nameBytes, nsBytes.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', data));
  const bytes = digest.slice(0, 16);
  // versión 5 (0101) en el nibble alto del byte 6; variante RFC (10xx) en el byte 8.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}
