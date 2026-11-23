import { MOTIVO_MIN, motivoFalta, motivoLongitud } from './motivo';

describe('motivo (DX11)', () => {
  it('mínimo 10', () => expect(MOTIVO_MIN).toBe(10));
  it('"DUPLICADA" (9) no cumple: falta 1', () => {
    expect(motivoLongitud('DUPLICADA')).toBe(9);
    expect(motivoFalta('DUPLICADA')).toBe(1);
  });
  it('ignora espacios sobrantes', () => expect(motivoFalta('   corta   ')).toBe(5));
  it('"REQUISICIÓN DUPLICADA" cumple', () => expect(motivoFalta('REQUISICIÓN DUPLICADA')).toBe(0));
  it('null/undefined = vacío', () => {
    expect(motivoFalta(null)).toBe(10);
    expect(motivoFalta(undefined)).toBe(10);
  });
});
