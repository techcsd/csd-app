import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import {
  CompraTecSelector,
  CotizacionDetalle,
  CotizacionRow,
  LeerCotizacionResultado,
} from '../models/cotizacion.model';

const BUCKET = 'compras-cotizaciones';

/**
 * CZ1/CZ2/CZ6 — cliente de la biblioteca de Cotizaciones de Tecnología. Mismas
 * RPC/tablas que el padre (sgc.tec_cotizaciones + tec_cotizacion_compras), sin
 * inventar nada server-side. Gate real = RLS (`puede_ver/operar_submodulo
 * ('tecnologia.cotizaciones')`); esta clase solo decide qué pintar.
 *
 * ONLINE-only (DZ-25): sin cola offline. Si falla por conexión, el llamador
 * muestra el mensaje y el usuario reintenta cuando vuelva a tener señal.
 */
@Injectable({ providedIn: 'root' })
export class CotizacionesService {
  private supabase = inject(SupabaseService);

  async listar(): Promise<CotizacionRow[]> {
    const { data, error } = await this.supabase.client
      .from('tec_cotizaciones')
      .select(
        'id, titulo, proveedor, fecha, moneda, subtotal, itbis, total, estado, archivo_path, archivo_nombre, notas, creado_por, created_at',
      )
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as CotizacionRow[];
    await this.resolverVinculos(rows);
    return rows;
  }

  /** Chips de vínculo (compra/equipo) para la lista — best-effort, nunca rompe la carga. */
  private async resolverVinculos(rows: CotizacionRow[]): Promise<void> {
    if (!rows.length) return;
    const ids = rows.map((r) => r.id);
    try {
      const [{ data: compras }, { data: equipos }] = await Promise.all([
        this.supabase.client.from('tec_cotizacion_compras').select('cotizacion_id, solicitud_compra_id').in('cotizacion_id', ids),
        this.supabase.client.from('tec_cotizacion_equipos').select('cotizacion_id, equipo_id').in('cotizacion_id', ids),
      ]);
      const compraByCot = new Map<string, string>();
      for (const c of (compras ?? []) as { cotizacion_id: string; solicitud_compra_id: string }[]) {
        if (!compraByCot.has(c.cotizacion_id)) compraByCot.set(c.cotizacion_id, c.solicitud_compra_id);
      }
      const equipoByCot = new Map<string, string>();
      for (const e of (equipos ?? []) as { cotizacion_id: string; equipo_id: string }[]) {
        if (!equipoByCot.has(e.cotizacion_id)) equipoByCot.set(e.cotizacion_id, e.equipo_id);
      }
      const compraIds = [...new Set(compraByCot.values())];
      const equipoIds = [...new Set(equipoByCot.values())];
      const [titulos, codigos] = await Promise.all([
        compraIds.length
          ? this.supabase.client.from('solicitudes_compra').select('id, titulo').in('id', compraIds)
          : Promise.resolve({ data: [] as { id: string; titulo: string | null }[] }),
        equipoIds.length
          ? this.supabase.client.from('tec_equipos').select('id, codigo').in('id', equipoIds)
          : Promise.resolve({ data: [] as { id: string; codigo: string | null }[] }),
      ]);
      const tMap = new Map((titulos.data ?? []).map((t) => [t.id, t.titulo]));
      const cMap = new Map((codigos.data ?? []).map((c) => [c.id, c.codigo]));
      for (const r of rows) {
        const compraId = compraByCot.get(r.id) ?? null;
        r.compra_id = compraId;
        r.compra_titulo = compraId ? (tMap.get(compraId) ?? 'Compra tecnológica') : null;
        const equipoId = equipoByCot.get(r.id) ?? null;
        r.equipo_codigo = equipoId ? (cMap.get(equipoId) ?? null) : null;
      }
    } catch {
      /* best-effort: las tarjetas se quedan sin chips */
    }
  }

  async detalle(id: string): Promise<CotizacionDetalle | null> {
    const { data, error } = await this.supabase.client
      .from('tec_cotizaciones')
      .select(
        'id, titulo, proveedor, fecha, moneda, subtotal, itbis, total, estado, archivo_path, archivo_nombre, lectura, lectura_costo_usd, notas, creado_por, created_at',
      )
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;

    const [comprasRes, equiposRes] = await Promise.all([
      this.supabase.client.from('tec_cotizacion_compras').select('solicitud_compra_id').eq('cotizacion_id', id),
      this.supabase.client.from('tec_cotizacion_equipos').select('equipo_id').eq('cotizacion_id', id),
    ]);
    const compraIds = ((comprasRes.data ?? []) as { solicitud_compra_id: string }[]).map((r) => r.solicitud_compra_id);
    const equipoIds = ((equiposRes.data ?? []) as { equipo_id: string }[]).map((r) => r.equipo_id);

    const [compras, equipos] = await Promise.all([
      compraIds.length
        ? this.supabase.client.from('solicitudes_compra').select('id, titulo, estado').in('id', compraIds)
        : Promise.resolve({ data: [] }),
      equipoIds.length
        ? this.supabase.client.from('tec_equipos').select('id, codigo, nombre').in('id', equipoIds)
        : Promise.resolve({ data: [] }),
    ]);

    const det: CotizacionDetalle = {
      ...(data as Omit<CotizacionDetalle, 'url' | 'compras' | 'equipos'>),
      url: null,
      compras: (compras.data ?? []) as CotizacionDetalle['compras'],
      equipos: (equipos.data ?? []) as CotizacionDetalle['equipos'],
    };
    if (det.archivo_path) det.url = await this.firmarArchivo(det.archivo_path);
    return det;
  }

  private async firmarArchivo(path: string): Promise<string | null> {
    try {
      const { data } = await this.supabase.client.storage.from(BUCKET).createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    } catch {
      return null;
    }
  }

  /** Compras tecnológicas visibles (para el selector opcional "Ligar a una compra"). */
  async listarComprasTec(): Promise<CompraTecSelector[]> {
    const { data, error } = await this.supabase.client
      .from('solicitudes_compra')
      .select('id, titulo, estado')
      .eq('categoria', 'tecnologia')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return [];
    return (data ?? []) as CompraTecSelector[];
  }

  /**
   * CQ1 — lee una cotización (PDF/foto) con IA; NUNCA bloquea el flujo: si falla,
   * el llamador deja al usuario llenar a mano (consentimiento de IA ya resuelto
   * por el llamador vía IaConsentGate, igual que leerRecibo).
   */
  async leerCotizacion(blob: Blob, mime: string): Promise<LeerCotizacionResultado> {
    try {
      const base64 = await this.blobToBase64(blob);
      const { data, error } = await this.supabase.client.functions.invoke('leer-cotizacion', {
        body: { archivo: { data: base64, mime } },
      });
      if (error) {
        const ctx = (error as { context?: { body?: unknown } }).context;
        if (ctx?.body) {
          try {
            const parsed = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body;
            if (parsed && typeof parsed === 'object') return { ok: false, ...parsed };
          } catch {
            /* cae al mensaje genérico */
          }
        }
        return { ok: false, error: 'No se pudo leer la cotización.' };
      }
      return data as LeerCotizacionResultado;
    } catch {
      return { ok: false, error: 'No se pudo leer la cotización.' };
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.includes(',') ? result.split(',')[1] : result);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Guarda una cotización nueva: crea la fila, sube el archivo con su id (ruta
   * `biblioteca/<id>/<nombre>`, DZ-02) y fija la ruta. Si falla justo después de
   * crear, la fila queda sin archivo (recuperable reintentando "Adjuntar" — no
   * se agrega esa pantalla esta ronda; se reporta como hueco conocido).
   */
  async crear(payload: {
    titulo: string;
    proveedor: string | null;
    fecha: string | null;
    moneda: 'DOP' | 'USD';
    subtotal: number | null;
    itbis: number | null;
    total: number | null;
    notas: string | null;
    lectura: unknown | null;
    lectura_costo_usd: number | null;
    archivo: { blob: Blob; nombre: string } | null;
    compraId: string | null;
  }): Promise<string> {
    const { data: id, error } = await this.supabase.client.rpc('cotizacion_crear', {
      p_titulo: payload.titulo,
      p_proveedor: payload.proveedor,
      p_fecha: payload.fecha,
      p_moneda: payload.moneda,
      p_subtotal: payload.subtotal,
      p_itbis: payload.itbis,
      p_total: payload.total,
      p_archivo_path: null,
      p_archivo_nombre: null,
      p_lectura: payload.lectura,
      p_lectura_costo_usd: payload.lectura_costo_usd,
      p_notas: payload.notas,
    });
    if (error) throw new Error(error.message);
    const cotizacionId = id as string;

    if (payload.archivo) {
      const path = `biblioteca/${cotizacionId}/${crypto.randomUUID()}-${payload.archivo.nombre}`;
      const { error: upErr } = await this.supabase.client.storage.from(BUCKET).upload(path, payload.archivo.blob);
      if (upErr) throw new Error(upErr.message);
      const { error: setErr } = await this.supabase.client.rpc('cotizacion_setear_archivo', {
        p_id: cotizacionId,
        p_archivo_path: path,
        p_archivo_nombre: payload.archivo.nombre,
      });
      if (setErr) throw new Error(setErr.message);
    }

    if (payload.compraId) {
      const { error: linkErr } = await this.supabase.client.rpc('cotizacion_vincular_compra', {
        p_cotizacion_id: cotizacionId,
        p_solicitud_compra_id: payload.compraId,
      });
      if (linkErr) throw new Error(linkErr.message);
    }

    return cotizacionId;
  }
}
