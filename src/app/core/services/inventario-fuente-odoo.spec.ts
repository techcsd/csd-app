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

// Builder de supabase-js mínimo: select/eq/order/limit encadenan y el await devuelve { data }.
function cadena(data: unknown[]) {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b;
  b['then'] = (ok: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(ok);
  return b;
}

// DT-T1b — ajuste que queda en almacén Odoo = Conteo físico (abrir → guardar → cerrar → aplicar).
type Res = { data: unknown; error: { code?: string; message?: string } | null };
function montarFisico(respuestas: Record<string, Res | (() => Promise<Res>)>, pendientes: { id: string }[] = []) {
  const llamadas: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    llamadas.push({ fn, args });
    const r = respuestas[fn];
    if (typeof r === 'function') return r();
    return r ?? { data: null, error: null };
  });
  TestBed.configureTestingModule({
    providers: [
      InventarioService,
      { provide: SupabaseService, useValue: { client: { rpc, from: () => cadena(pendientes) } } },
      { provide: CatalogService, useValue: { refresh: vi.fn() } },
      { provide: SyncService, useValue: { register: vi.fn() } },
    ],
  });
  return { s: TestBed.inject(InventarioService), llamadas };
}
const ITEMS = [{ articulo_id: 'a1', cantidad_contada: 5 }];
const ENTRADA = { bodegaId: B1, items: ITEMS, motivo: 'conteo mensual' };

describe('InventarioService.aplicarConteoFisico (DT-T1b)', () => {
  it('camino feliz: abrir → guardar → cerrar → aplicar, con los argumentos del RPC', async () => {
    const { s, llamadas } = montarFisico({
      conteo_fisico_abrir: { data: 'C1', error: null },
      conteo_fisico_aplicar: { data: { ok: true, ajustados: 1 }, error: null },
    });
    expect(await s.aplicarConteoFisico(ENTRADA)).toEqual({ ajustados: 1 });
    expect(llamadas.map((l) => l.fn)).toEqual(['conteo_fisico_abrir', 'conteo_fisico_guardar', 'conteo_fisico_cerrar', 'conteo_fisico_aplicar']);
    expect(llamadas[0].args).toEqual({ p_bodega_id: B1, p_ciego: false });
    expect(llamadas[1].args).toEqual({ p_conteo_id: 'C1', p_items: ITEMS });
    expect(llamadas[3].args).toEqual({ p_conteo_id: 'C1', p_motivo: 'conteo mensual' });
  });
  it('reintento: cerrar ya hecho (AT409 estado: contado) no falla', async () => {
    const { s } = montarFisico({
      conteo_fisico_abrir: { data: 'C1', error: null },
      conteo_fisico_cerrar: { data: null, error: { code: 'AT409', message: 'Solo un borrador se puede cerrar (estado: contado)' } },
      conteo_fisico_aplicar: { data: { ok: true, ajustados: 1 }, error: null },
    });
    await expect(s.aplicarConteoFisico(ENTRADA)).resolves.toEqual({ ajustados: 1 });
  });
  it('reintento: aplicar ya hecho (AT409 estado: aplicado) cuenta como éxito', async () => {
    const { s } = montarFisico({
      conteo_fisico_abrir: { data: 'C1', error: null },
      conteo_fisico_aplicar: { data: null, error: { code: 'AT409', message: 'Solo un conteo cerrado (contado) se puede aplicar (estado: aplicado)' } },
    });
    await expect(s.aplicarConteoFisico(ENTRADA)).resolves.toEqual({ ajustados: 1 });
  });
  it('conteo pendiente de aplicar (abrir AT409): mensaje claro y no sigue', async () => {
    const { s, llamadas } = montarFisico({
      conteo_fisico_abrir: { data: null, error: { code: 'AT409', message: 'Ya hay un conteo de esta bodega por aplicar.' } },
    });
    await expect(s.aplicarConteoFisico(ENTRADA)).rejects.toMatchObject({ causa: 'pendiente' });
    expect(llamadas.map((l) => l.fn)).toEqual(['conteo_fisico_abrir']);
  });
  it('conteo «contado» pendiente con los MISMOS ítems: se reanuda (solo aplica, no vuelve a guardar)', async () => {
    const { s, llamadas } = montarFisico(
      {
        conteo_fisico_abrir: { data: null, error: { code: 'AT409', message: 'Ya hay un conteo de esta bodega por aplicar.' } },
        conteo_fisico_detalle: { data: { items: [{ articulo_id: 'a1', cantidad_contada: 5 }] }, error: null },
        conteo_fisico_aplicar: { data: { ok: true, ajustados: 1 }, error: null },
      },
      [{ id: 'P1' }],
    );
    await expect(s.aplicarConteoFisico(ENTRADA)).resolves.toEqual({ ajustados: 1 });
    expect(llamadas.map((l) => l.fn)).toEqual(['conteo_fisico_abrir', 'conteo_fisico_detalle', 'conteo_fisico_aplicar']);
    expect(llamadas[2].args).toEqual({ p_conteo_id: 'P1', p_motivo: 'conteo mensual' });
  });
  it('conteo pendiente con ítems DISTINTOS: no lo aplica (el usuario no lo vio) → mensaje', async () => {
    const { s, llamadas } = montarFisico(
      {
        conteo_fisico_abrir: { data: null, error: { code: 'AT409', message: 'Ya hay un conteo de esta bodega por aplicar.' } },
        conteo_fisico_detalle: { data: { items: [{ articulo_id: 'a1', cantidad_contada: 9 }] }, error: null },
      },
      [{ id: 'P1' }],
    );
    await expect(s.aplicarConteoFisico(ENTRADA)).rejects.toMatchObject({ causa: 'pendiente' });
    expect(llamadas.map((l) => l.fn)).not.toContain('conteo_fisico_aplicar');
  });
  it('conteo pendiente que la app no puede ver (sin fila): mensaje, no aplica nada', async () => {
    const { s, llamadas } = montarFisico({
      conteo_fisico_abrir: { data: null, error: { code: 'AT409', message: 'Ya hay un conteo de esta bodega por aplicar.' } },
    });
    await expect(s.aplicarConteoFisico(ENTRADA)).rejects.toMatchObject({ causa: 'pendiente' });
    expect(llamadas.map((l) => l.fn)).toEqual(['conteo_fisico_abrir']);
  });
  it('sin permiso (42501): causa permiso, sin texto técnico', async () => {
    const { s } = montarFisico({ conteo_fisico_abrir: { data: null, error: { code: '42501', message: 'x' } } });
    const e = await s.aplicarConteoFisico(ENTRADA).catch((x) => x);
    expect(e.causa).toBe('permiso');
    expect(e.message).toBe('No tienes permiso para aplicar conteos de inventario.');
  });
  it('sin red (el cliente lanza): causa red', async () => {
    const { s } = montarFisico({
      conteo_fisico_abrir: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(s.aplicarConteoFisico(ENTRADA)).rejects.toMatchObject({ causa: 'red' });
  });
  it('error raro del servidor: mensaje genérico (sin SQLSTATE ni texto del servidor)', async () => {
    const { s } = montarFisico({
      conteo_fisico_abrir: { data: 'C1', error: null },
      conteo_fisico_guardar: { data: null, error: { code: 'XX000', message: 'relation x does not exist' } },
    });
    const e = await s.aplicarConteoFisico(ENTRADA).catch((x) => x);
    expect(e.causa).toBe('otro');
    expect(e.message).not.toMatch(/relation|XX000/);
  });
});
