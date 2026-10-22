import { validarPrefillCompa } from './combustible.model';

const VEH = '7fd95233-533f-4807-84bd-75b968321b37';

const base = {
  galones: '12',
  monto: '3360',
  km: null as string | null,
  estacion: null as string | null,
  producto: null as string | null,
  vehiculo: VEH,
};

describe('validarPrefillCompa (CV1.5 — entrada no confiable de ?desde=compa)', () => {
  it('acepta galones/monto válidos, el resto opcional', () => {
    const r = validarPrefillCompa(base, VEH);
    expect(r).toEqual({ galones: 12, monto: 3360, km: null, estacionTexto: null, producto: null });
  });

  it('acepta km entero no negativo', () => {
    const r = validarPrefillCompa({ ...base, km: '45000' }, VEH);
    expect(r?.km).toBe(45000);
  });

  it('rechaza galones basura (texto)', () => {
    expect(validarPrefillCompa({ ...base, galones: 'doce' }, VEH)).toBeNull();
  });

  it('rechaza galones negativos', () => {
    expect(validarPrefillCompa({ ...base, galones: '-5' }, VEH)).toBeNull();
  });

  it('rechaza galones fuera de rango (>500, dedazo clásico)', () => {
    expect(validarPrefillCompa({ ...base, galones: '34118' }, VEH)).toBeNull();
  });

  it('rechaza galones en cero', () => {
    expect(validarPrefillCompa({ ...base, galones: '0' }, VEH)).toBeNull();
  });

  it('rechaza monto basura', () => {
    expect(validarPrefillCompa({ ...base, monto: 'tres mil' }, VEH)).toBeNull();
  });

  it('rechaza monto negativo', () => {
    expect(validarPrefillCompa({ ...base, monto: '-1' }, VEH)).toBeNull();
  });

  it('acepta monto cero (echada de cortesía/garantía)', () => {
    expect(validarPrefillCompa({ ...base, monto: '0' }, VEH)?.monto).toBe(0);
  });

  it('km inválido (decimal/negativo/basura) se descarta solo — nunca se inventa (CV1.3)', () => {
    expect(validarPrefillCompa({ ...base, km: '45000.5' }, VEH)?.km).toBeNull();
    expect(validarPrefillCompa({ ...base, km: '-10' }, VEH)?.km).toBeNull();
    expect(validarPrefillCompa({ ...base, km: 'abc' }, VEH)?.km).toBeNull();
  });

  it('rechaza el vehículo ajeno: el query apunta a otro vehículo que el de la ruta', () => {
    expect(validarPrefillCompa({ ...base, vehiculo: 'otro-vehiculo-id' }, VEH)).toBeNull();
  });

  it('sin vehículo en el query, confía en el de la ruta (el servidor igual no lo ofrecería fuera del pool)', () => {
    expect(validarPrefillCompa({ ...base, vehiculo: null }, VEH)).not.toBeNull();
  });

  it('recorta la estación a 60 caracteres', () => {
    const larga = 'x'.repeat(200);
    expect(validarPrefillCompa({ ...base, estacion: larga }, VEH)?.estacionTexto?.length).toBe(60);
  });

  it('producto fuera del enum se ignora (queda null, no bloquea el resto)', () => {
    const r = validarPrefillCompa({ ...base, producto: 'kerosene' }, VEH);
    expect(r).not.toBeNull();
    expect(r?.producto).toBeNull();
  });

  it('producto válido se acepta', () => {
    expect(validarPrefillCompa({ ...base, producto: 'gasolina' }, VEH)?.producto).toBe('gasolina');
  });
});
