import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { CatalogService } from '../sync/catalog.service';
import { SyncService } from '../sync/sync.service';
import { InventarioService, parseFuenteOdoo } from './inventario.service';
import { SupabaseService } from './supabase.service';

const B1 = '11111111-1111-1111-1111-111111111111';
const B2 = '22222222-2222-2222-2222-222222222222';

// DT-T1 — el aviso «Odoo manda el stock» depende solo de este mapa. Todo lo que no sea un
// `true` explícito (false, null, error, RPC ausente, formato raro, offline sin caché) = sin aviso.
function montar(rpc: () => Promise<unknown>, cache: Record<string, boolean> | null = null) {
  const catalog = {
    // mismo contrato que CatalogService.refresh: si el loader falla, devuelve la caché (o null)
    refresh: vi.fn(async (_t: string, loader: () => Promise<unknown>) => {
      try {
        return await loader();
      } catch {
        return cache;
      }
    }),
  };
  TestBed.configureTestingModule({
    providers: [
      InventarioService,
      { provide: SupabaseService, useValue: { client: { rpc: vi.fn(rpc) } } },
      { provide: CatalogService, useValue: catalog },
      { provide: SyncService, useValue: { register: vi.fn() } },
    ],
  });
  return TestBed.inject(InventarioService);
}

describe('parseFuenteOdoo (DT-T1)', () => {
  it('solo cuenta fuente_odoo === true', () => {
    expect(
      parseFuenteOdoo([
        { bodega_id: B1, fuente_odoo: true },
        { bodega_id: B2, fuente_odoo: false },
      ]),
    ).toEqual({ [B1]: true });
  });
  it('null / undefined / filas raras / no-lista → {} (desconocido)', () => {
    expect(parseFuenteOdoo(null)).toEqual({});
    expect(parseFuenteOdoo(undefined)).toEqual({});
    expect(parseFuenteOdoo({})).toEqual({});
    expect(parseFuenteOdoo([{ bodega_id: B1 }, { bodega_id: B2, fuente_odoo: null }, null, { fuente_odoo: true }])).toEqual({});
    expect(parseFuenteOdoo([{ bodega_id: B1, fuente_odoo: 'true' }])).toEqual({});
  });
});

describe('InventarioService.getBodegasFuenteOdoo (DT-T1)', () => {
  it('con true: devuelve el almacén (aviso)', async () => {
    const s = montar(async () => ({ data: [{ bodega_id: B1, fuente_odoo: true }, { bodega_id: B2, fuente_odoo: false }], error: null }));
    expect(await s.getBodegasFuenteOdoo()).toEqual({ [B1]: true });
  });
  it('sin true (todo false): {} → sin aviso', async () => {
    const s = montar(async () => ({ data: [{ bodega_id: B1, fuente_odoo: false }], error: null }));
    expect(await s.getBodegasFuenteOdoo()).toEqual({});
  });
  it('null / undefined en data: {} sin romper', async () => {
    expect(await montar(async () => ({ data: null, error: null })).getBodegasFuenteOdoo()).toEqual({});
  });
  it('PGRST202 (RPC ausente): {} aunque haya caché vieja con true', async () => {
    const s = montar(async () => ({ data: null, error: { code: 'PGRST202', message: 'not found' } }), { [B1]: true });
    expect(await s.getBodegasFuenteOdoo()).toEqual({});
  });
  it('error de red/RPC sin caché: {} sin lanzar', async () => {
    const s = montar(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await s.getBodegasFuenteOdoo()).toEqual({});
  });
  it('error de RPC con caché: usa la última caché (offline)', async () => {
    const s = montar(async () => ({ data: null, error: { code: '500', message: 'boom' } }), { [B1]: true });
    expect(await s.getBodegasFuenteOdoo()).toEqual({ [B1]: true });
  });
  it('si el propio catálogo lanza: {} sin romper', async () => {
    const s = montar(async () => ({ data: [], error: null }));
    (TestBed.inject(CatalogService) as unknown as { refresh: () => Promise<never> }).refresh = async () => {
      throw new Error('idb');
    };
    expect(await s.getBodegasFuenteOdoo()).toEqual({});
  });
});
