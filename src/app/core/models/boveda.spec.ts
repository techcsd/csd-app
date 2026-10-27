import { estadoRotacionDe } from './boveda.model';

const hoy = new Date().toISOString();
const haceDias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

describe('estadoRotacionDe', () => {
  it('sin rotar_cada_dias → sin_rotacion', () => {
    expect(estadoRotacionDe({ rotar_cada_dias: null, ultima_rotacion: null, created_at: hoy })).toBe('sin_rotacion');
  });
  it('rotada hoy, cada 30 días → al_dia', () => {
    expect(estadoRotacionDe({ rotar_cada_dias: 30, ultima_rotacion: haceDias(0), created_at: hoy })).toBe('al_dia');
  });
  it('a 5 días de vencer (rotar cada 30, rotada hace 25) → por_rotar', () => {
    expect(estadoRotacionDe({ rotar_cada_dias: 30, ultima_rotacion: haceDias(25), created_at: hoy })).toBe('por_rotar');
  });
  it('ya vencida (rotar cada 30, rotada hace 40) → vencida', () => {
    expect(estadoRotacionDe({ rotar_cada_dias: 30, ultima_rotacion: haceDias(40), created_at: hoy })).toBe('vencida');
  });
});
