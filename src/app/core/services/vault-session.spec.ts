import { segundosRestantesDesde } from './vault-session.service';

describe('segundosRestantesDesde', () => {
  it('120 segundos exactos cuando faltan 2 minutos', () => {
    const ahora = Date.now();
    const expiraAt = new Date(ahora + 120_000).toISOString();
    expect(segundosRestantesDesde(expiraAt, ahora)).toBe(120);
  });
  it('0 (nunca negativo) una vez vencida', () => {
    const ahora = Date.now();
    const expiraAt = new Date(ahora - 5_000).toISOString();
    expect(segundosRestantesDesde(expiraAt, ahora)).toBe(0);
  });
});
