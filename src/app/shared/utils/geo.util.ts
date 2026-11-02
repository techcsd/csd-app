/** DF4 (PROMPT 129) — geometría pura para el "camión en ruta" (sin dependencia de Leaflet/Google). */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Rumbo inicial (0-360°, 0=norte, sentido horario) de `a` hacia `b` — fórmula estándar de navegación. */
export function rumboEntre(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
