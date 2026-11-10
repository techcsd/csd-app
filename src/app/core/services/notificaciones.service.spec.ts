import { notifAppRoute } from './notificaciones.service';

describe('notifAppRoute — DL4 (PROMPT 139)', () => {
  it('wa_recordatorio → /compa con la pregunta de pendientes precargada', () => {
    expect(notifAppRoute({ tipo: 'wa_recordatorio', ruta: null })).toBe(
      `/compa?q=${encodeURIComponent('¿Qué me falta de los grupos?')}`,
    );
  });

  it('wa_recap → /compa con la pregunta de recap precargada', () => {
    expect(notifAppRoute({ tipo: 'wa_recap', ruta: null })).toBe(
      `/compa?q=${encodeURIComponent('¿Qué se decidió ayer en mis grupos?')}`,
    );
  });

  it('tipo desconocido sin ruta → /home (sin regresión)', () => {
    expect(notifAppRoute({ tipo: 'algo_que_no_existe', ruta: null })).toBe('/home');
  });
});
