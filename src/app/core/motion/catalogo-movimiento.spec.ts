import { MOVIMIENTO_CATALOGO, MOVIMIENTO_IDS } from './catalogo-movimiento';
import { CELEBRACION_TIPOS, MOMENTO_TIPOS } from '../services/motion.service';
import { DIRECTIVE_MOTION_IDS, SISTEMA_MOTION_IDS } from '../../shared/motion';

/**
 * CL2 — el catálogo es el registro ÚNICO: todo id de movimiento que la app usa
 * (directivas, celebraciones, momentos, sistema) debe estar registrado, y todo
 * registro debe usarse (sin filas muertas). Igual que la prueba del registro de la web.
 */
describe('catálogo de movimiento (CL2/CL5)', () => {
  /** Ids realmente USADOS en el código (cada fuente los exporta como su tupla). */
  const usados = new Set<string>([
    ...SISTEMA_MOTION_IDS,
    ...DIRECTIVE_MOTION_IDS,
    ...CELEBRACION_TIPOS,
    ...MOMENTO_TIPOS,
  ]);
  const registrados = new Set(MOVIMIENTO_IDS);

  it('no tiene ids duplicados', () => {
    expect(MOVIMIENTO_IDS.length).toBe(registrados.size);
  });

  it('todo id usado tiene un registro en el catálogo', () => {
    const faltan = [...usados].filter((id) => !registrados.has(id));
    expect(faltan).toEqual([]);
  });

  it('todo registro del catálogo se usa en algún lado (sin filas muertas)', () => {
    const muertos = [...registrados].filter((id) => !usados.has(id));
    expect(muertos).toEqual([]);
  });

  it('cada fila tiene los campos obligatorios de movimiento_catalogo', () => {
    for (const r of MOVIMIENTO_CATALOGO) {
      expect(r.id).toBeTruthy();
      expect(['web', 'app', 'web-app']).toContain(r.sistema);
      expect(['sistema', 'simple', 'mediano', 'grande']).toContain(r.nivel);
      expect(['en_uso', 'pendiente']).toContain(r.estado);
      expect(r.nombre.length).toBeGreaterThan(0);
      expect(Array.isArray(r.pantallas)).toBe(true);
      expect(r.pantallas.length).toBeGreaterThan(0);
      expect(r.duracion_ms).toBeGreaterThan(0);
      expect(r.curva.length).toBeGreaterThan(0);
      expect(r.reducido.length).toBeGreaterThan(0);
      expect(r.desde_version.length).toBeGreaterThan(0);
      expect(r.preview_key.length).toBeGreaterThan(0);
    }
  });
});
