// CI15 — Higiene de mapas OpenStreetMap para una app publicada en tiendas.
// · URL sin el subdominio {s} obsoleto (OSM pide el host único tile.openstreetmap.org).
// · Atribución completa y visible "© OpenStreetMap contributors" (política de uso).
// · errorTileUrl transparente + aviso amable si las teselas no cargan (sin señal o
//   bloqueo del servidor de OSM) en vez de los iconos de imagen rota.
// La migración a Google Maps queda fuera de esta tanda (decisión aparte).

export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// Tesela transparente de 1×1 (Leaflet la escala al tamaño del tile): evita el icono
// de "imagen rota" y deja ver el fondo del mapa cuando una tesela falla.
const TESELA_VACIA =
  'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

export const OSM_TILE_OPTS = {
  maxZoom: 19,
  attribution: '© OpenStreetMap contributors',
  errorTileUrl: TESELA_VACIA,
};

/**
 * Muestra un aviso discreto en la esquina del mapa la primera vez que fallan las
 * teselas (p. ej. sin señal). `L` es el módulo Leaflet ya importado por el llamador.
 */
export function avisoTilesOffline(L: any, map: any): void {
  let mostrado = false;
  map.on('tileerror', () => {
    if (mostrado) return;
    mostrado = true;
    const ctrl = L.control({ position: 'bottomleft' });
    ctrl.onAdd = () => {
      const div = L.DomUtil.create('div');
      div.style.cssText =
        'background:rgba(0,0,0,.72);color:#fff;padding:6px 10px;border-radius:8px;' +
        'font-size:12px;max-width:220px;line-height:1.3;';
      div.textContent = 'Mapa sin conexión. Se verá completo cuando haya señal.';
      return div;
    };
    ctrl.addTo(map);
  });
}
