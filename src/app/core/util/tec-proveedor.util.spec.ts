import { correoUrl, filtrarProveedoresLocal, normalizarBusqueda, telUrl, whatsappUrl } from './tec-proveedor.util';
import { TecProveedorRow } from '../models/tec-proveedor.model';

const fila = (p: Partial<TecProveedorRow>): TecProveedorRow => ({
  id: 'x', nombre: '', nombre_comercial: null, categoria: null, servicio: null, estado: 'activo',
  valoracion: null, etiquetas: [], contacto_nombre: null, contacto_telefono: null, contacto_whatsapp: null,
  contacto_correo: null, coincidencia: null, puntaje: 0, ...p,
});

describe('tec-proveedor.util', () => {
  it('normaliza tildes y mayúsculas', () => {
    expect(normalizarBusqueda('  Cerradura Inteligente ÁÉÑ ')).toBe('cerradura inteligente aen');
  });

  it('filtra por servicio/etiqueta sin importar tildes y exige todas las palabras', () => {
    const rows = [
      fila({ id: '1', nombre: 'Accesos Dominicanos', categoria: 'Cerraduras y control de acceso', etiquetas: ['puertas', 'cerradura'] }),
      fila({ id: '2', nombre: 'Redes SRL', categoria: 'Redes y cableado' }),
    ];
    expect(filtrarProveedoresLocal(rows, 'PUERTAS').map((r) => r.id)).toEqual(['1']);
    expect(filtrarProveedoresLocal(rows, 'cerradura puertas').map((r) => r.id)).toEqual(['1']);
    expect(filtrarProveedoresLocal(rows, 'cerradura redes')).toEqual([]);
    expect(filtrarProveedoresLocal(rows, '').length).toBe(2);
  });

  it('arma tel:, wa.me y mailto: y rechaza datos inválidos', () => {
    expect(telUrl('(809) 555-1234')).toBe('tel:8095551234');
    expect(telUrl('+1 809 555 1234')).toBe('tel:+18095551234');
    expect(telUrl('123')).toBe('');
    expect(whatsappUrl('809-555-1234')).toBe('https://wa.me/18095551234');
    expect(whatsappUrl('+34 600 111 222')).toBe('https://wa.me/34600111222');
    expect(whatsappUrl(null)).toBe('');
    expect(correoUrl('a@b.com')).toBe('mailto:a@b.com');
    expect(correoUrl('no-es-correo')).toBe('');
  });
});
