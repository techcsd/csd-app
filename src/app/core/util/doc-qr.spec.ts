import { extraerTokenQr, mensajeErrorQr, rutaAppDeDoc } from './doc-qr';

const ID = '123e4567-e89b-12d3-a456-426614174000';
const TOK4 = `requisicion.${ID}.1799999999.abcDEF_-123`;
const TOK3 = `${ID}.1799999999.abcDEF_-123`;

describe('doc-qr (DX7)', () => {
  it('extrae de /d/<token>', () => expect(extraerTokenQr(`https://app.sgcconstructorasd.com/d/${TOK4}`)).toBe(TOK4));
  it('extrae del legado /conduce-qr/<token>', () => expect(extraerTokenQr(`https://x.com/conduce-qr/${TOK3}`)).toBe(TOK3));
  it('acepta token crudo', () => expect(extraerTokenQr(`  ${TOK4} `)).toBe(TOK4));
  it('rechaza URLs ajenas y basura', () => {
    expect(extraerTokenQr('https://evil.com/otra/ruta')).toBeNull();
    expect(extraerTokenQr('hola')).toBeNull();
    expect(extraerTokenQr('')).toBeNull();
    expect(extraerTokenQr(null)).toBeNull();
  });
  it('rechaza token con caracteres raros', () => expect(extraerTokenQr('https://x.com/d/a.b.<script>')).toBeNull());
  it('ruta por tipo', () => {
    expect(rutaAppDeDoc('conduce', ID)).toEqual({ ruta: '/transporte/por-confirmar', query: { abrir: ID } });
    expect(rutaAppDeDoc('requisicion', ID)?.ruta).toBe(`/solicitudes/requisicion/${ID}`);
    expect(rutaAppDeDoc('solicitud_compra', ID)).toBeNull();
  });
  it('mensajes no filtran datos', () => {
    expect(mensajeErrorQr('sin_acceso')).toBe('No tienes acceso a esto.');
    expect(mensajeErrorQr('token_firma')).toContain('no es válido');
  });
});
