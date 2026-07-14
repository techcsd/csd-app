import {
  calcularCombustible,
  CONSUMO_ANORMAL_PCT,
  MIN_ECHADAS_ALERTA,
  UltimaEchada,
} from './combustible.model';
import { estadoLicencia, diasHasta } from './conductor.model';
import {
  claseVehiculo,
  esVehiculoPesado,
  itemAplica,
  ChecklistPlantillaItem,
} from './checklist-preuso.model';

const sinHistorial: UltimaEchada = { km: null, fecha: null, promedio_rendimiento: null, n_echadas: 0 };
const conHistorial = (km: number, prom: number, n: number): UltimaEchada => ({
  km,
  fecha: '2026-07-01',
  promedio_rendimiento: prom,
  n_echadas: n,
});

describe('calcularCombustible', () => {
  it('first fill-up: price only, no rendimiento', () => {
    const r = calcularCombustible(50_000, 10, 3000, sinHistorial);
    expect(r.precioPorGalon).toBe(300);
    expect(r.kmRecorridos).toBeNull();
    expect(r.rendimiento).toBeNull();
    expect(r.costoPorKm).toBeNull();
    expect(r.alertaConsumo).toBe(false);
  });

  it('normal fill-up: derives km, rendimiento, costo/km', () => {
    const r = calcularCombustible(50_100, 10, 3000, conHistorial(50_000, 10, 5));
    expect(r.kmRecorridos).toBe(100);
    expect(r.rendimiento).toBe(10);
    expect(r.costoPorKm).toBe(30);
    expect(r.alertaConsumo).toBe(false);
  });

  it('flags abnormal consumption >20% below average (>=3 records)', () => {
    // avg 10 km/gal, this fill-up 70km/10gal = 7 km/gal → 30% below → alert
    const r = calcularCombustible(50_070, 10, 3000, conHistorial(50_000, 10, 4));
    expect(r.rendimiento).toBe(7);
    expect(r.alertaConsumo).toBe(true);
  });

  it('does NOT alert with fewer than the minimum records', () => {
    const r = calcularCombustible(50_070, 10, 3000, conHistorial(50_000, 10, MIN_ECHADAS_ALERTA - 1));
    expect(r.alertaConsumo).toBe(false);
  });

  it('does not alert when just under the threshold band', () => {
    // exactly 20% below is the boundary; 8.1 (>0.8*10=8) should NOT alert
    const r = calcularCombustible(50_081, 10, 3000, conHistorial(50_000, 10, 5));
    expect(r.rendimiento).toBe(8.1);
    expect(r.alertaConsumo).toBe(false);
    expect(CONSUMO_ANORMAL_PCT).toBe(20);
  });

  it('ignores km that is not greater than the previous fill-up', () => {
    const r = calcularCombustible(49_000, 10, 3000, conHistorial(50_000, 10, 5));
    expect(r.kmRecorridos).toBeNull();
  });
});

describe('estadoLicencia', () => {
  const iso = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  };
  it('vencida when past', () => expect(estadoLicencia(iso(-1))).toBe('vencida'));
  it('por_vencer within 30 days', () => expect(estadoLicencia(iso(10))).toBe('por_vencer'));
  it('vigente when far', () => expect(estadoLicencia(iso(120))).toBe('vigente'));
  it('desconocido when null', () => expect(estadoLicencia(null)).toBe('desconocido'));
  it('diasHasta null when null', () => expect(diasHasta(null)).toBeNull());
});

describe('vehicle class + item applicability', () => {
  const mk = (aplica_a: string): ChecklistPlantillaItem => ({
    id: 'x',
    plantilla_id: 'p',
    seccion: 'Herramienta Pesado',
    etiqueta: 'Gato',
    es_critico: true,
    orden: 30,
    numero: 'P1',
    aplica_a,
  });

  it('pickup is not heavy', () => {
    expect(esVehiculoPesado('pickup')).toBe(false);
    expect(claseVehiculo('pickup')).toBe('Liviano');
  });
  it('camion is heavy', () => {
    expect(esVehiculoPesado('camion')).toBe(true);
    expect(claseVehiculo('Camión')).toBe('Pesado');
  });
  it('Ambos items always apply', () => {
    expect(itemAplica(mk('Ambos'), 'Liviano')).toBe(true);
    expect(itemAplica(mk('Ambos'), 'Pesado')).toBe(true);
  });
  it('Pesado items only apply to heavy vehicles', () => {
    expect(itemAplica(mk('Pesado'), 'Liviano')).toBe(false);
    expect(itemAplica(mk('Pesado'), 'Pesado')).toBe(true);
  });
});
