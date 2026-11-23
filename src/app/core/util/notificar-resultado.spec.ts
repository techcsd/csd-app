import { evaluarRespuestaNotificar } from './notificar-resultado';

describe('evaluarRespuestaNotificar (DX4)', () => {
  it('error de invoke = fallo (no rechaza, llega en {error})', () => {
    expect(evaluarRespuestaNotificar({ data: null, error: new Error('FunctionsFetchError') })).toEqual({
      estado: 'fallo',
      motivo: 'FunctionsFetchError',
    });
  });
  it('data.error = fallo', () => {
    expect(evaluarRespuestaNotificar({ data: { error: 'Resend 502' }, error: null }).estado).toBe('fallo');
  });
  it('skipped es legítimo y conserva su motivo', () => {
    expect(evaluarRespuestaNotificar({ data: { skipped: 'Sin destinatarios' }, error: null })).toEqual({
      estado: 'omitido',
      motivo: 'Sin destinatarios',
    });
  });
  it('ok', () => expect(evaluarRespuestaNotificar({ data: { ok: true }, error: null }).estado).toBe('enviado'));
  it('sin respuesta = fallo', () => expect(evaluarRespuestaNotificar(null).estado).toBe('fallo'));
});
