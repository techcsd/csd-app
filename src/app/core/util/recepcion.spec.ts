import { resolverConduceDeBorrador } from './recepcion';
import type { Conduce } from '../models/transporte.model';

const conduce = (id: string): Conduce => ({
  id,
  codigo: `REQ-${id}`,
  fecha: '2026-10-20',
  creado_en: '2026-10-20T10:00:00Z',
  creador: 'Raykler',
  estado: 'despachado',
  destino: 'Obra X',
  bodega: 'Almacén central',
  observaciones: null,
  foto_path: null,
  items: [],
});

describe('resolverConduceDeBorrador (CT5 — retomar recepción sin señal)', () => {
  it('usa la copia de la lista si el conduce sigue pendiente (online o cache fresco)', () => {
    const enLista = conduce('a1');
    const snapshot = conduce('a1');
    const r = resolverConduceDeBorrador('a1', snapshot, [enLista, conduce('a2')], true);
    expect(r).toBe(enLista); // la de la lista, no el snapshot
  });

  it('offline y sin match en la lista: usa el snapshot guardado (no descarta)', () => {
    const snapshot = conduce('a1');
    const r = resolverConduceDeBorrador('a1', snapshot, [conduce('a2')], false);
    expect(r).toBe(snapshot);
  });

  it('online y sin match en la lista: el servidor confirma que ya no está pendiente → null', () => {
    const snapshot = conduce('a1');
    const r = resolverConduceDeBorrador('a1', snapshot, [conduce('a2')], true);
    expect(r).toBeNull();
  });

  it('offline, sin match y sin snapshot (borrador anterior a CT5): no hay nada que ofrecer', () => {
    const r = resolverConduceDeBorrador('a1', null, [conduce('a2')], false);
    expect(r).toBeNull();
  });

  it('lista vacía (típico arranque offline sin cache): el snapshot salva el borrador', () => {
    const snapshot = conduce('a1');
    const r = resolverConduceDeBorrador('a1', snapshot, [], false);
    expect(r).toBe(snapshot);
  });
});
