import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { LocalStore } from './local-store.service';
import {
  TecProveedorContacto,
  TecProveedorDetalle,
  TecProveedorFactura,
  TecProveedorFicha,
  TecProveedorRow,
  TecProveedorTrabajo,
} from '../models/tec-proveedor.model';

const BUCKET = 'tec-proveedores';
const CACHE_KEY = 'tec_proveedores_cache_v1';

/**
 * EA1 — Proveedores de Tecnología (SOLO LECTURA + contacto, DEFAULT EA-09). Las
 * tablas/RPC son del padre (PROMPT-156 F3, `sql/2026-11-24-ea1-tec-proveedores.sql`);
 * esta clase no inventa nada server-side. Gate real = RLS/RPC
 * (`puede_ver_submodulo('tecnologia.proveedores')`); la UI solo decide qué pintar.
 *
 * Offline: se guarda la última lista SIN filtro (query vacío) para poder verla y
 * filtrarla localmente sin señal. Detalle y archivos requieren conexión.
 */
@Injectable({ providedIn: 'root' })
export class TecProveedoresService {
  private supabase = inject(SupabaseService);
  private store = inject(LocalStore);

  /** Búsqueda única del servidor (nombre, servicio, contacto, trabajos, cotizaciones…). */
  async buscar(q: string, incluirInactivos = false): Promise<TecProveedorRow[]> {
    const texto = q.trim();
    const { data, error } = await this.supabase.client.rpc('buscar_tec_proveedores', {
      p_q: texto || null,
      p_incluir_inactivos: incluirInactivos,
    });
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as TecProveedorRow[]).map((r) => ({ ...r, etiquetas: r.etiquetas ?? [] }));
    if (!texto && !incluirInactivos) void this.guardarCache(rows);
    return rows;
  }

  async leerCache(): Promise<TecProveedorRow[]> {
    try {
      const raw = await this.store.get(CACHE_KEY);
      return raw ? (JSON.parse(raw) as TecProveedorRow[]) : [];
    } catch {
      return [];
    }
  }

  private async guardarCache(rows: TecProveedorRow[]): Promise<void> {
    try {
      await this.store.set(CACHE_KEY, JSON.stringify(rows));
    } catch {
      /* best-effort */
    }
  }

  async detalle(id: string): Promise<TecProveedorDetalle | null> {
    const db = this.supabase.client;
    const { data: p, error } = await db
      .from('tec_proveedores')
      .select('id, nombre, nombre_comercial, rnc, servicio, etiquetas, direccion, ciudad, web, notas, estado, valoracion, categoria:tec_proveedor_categorias(nombre)')
      .eq('id', id)
      .maybeSingle();
    if (error || !p) return null;
    const [contactos, trabajos, facturas] = await Promise.all([
      db
        .from('tec_proveedor_contactos')
        .select('id, proveedor_id, nombre, cargo, telefono, whatsapp, correo, principal, notas')
        .eq('proveedor_id', id)
        .order('principal', { ascending: false })
        .order('created_at'),
      db
        .from('tec_proveedor_trabajos')
        .select('id, proveedor_id, fecha, titulo, descripcion, costo, moneda, estado')
        .eq('proveedor_id', id)
        .order('fecha', { ascending: false, nullsFirst: false }),
      db
        .from('tec_proveedor_facturas')
        .select('id, proveedor_id, numero, fecha, monto, itbis, moneda, estado, fecha_pago, archivo_path, archivo_nombre, notas')
        .eq('proveedor_id', id)
        .order('fecha', { ascending: false, nullsFirst: false }),
    ]);
    const cat = (p as unknown as { categoria: { nombre: string } | { nombre: string }[] | null }).categoria;
    const categoria = Array.isArray(cat) ? (cat[0]?.nombre ?? null) : (cat?.nombre ?? null);
    const ficha: TecProveedorFicha = {
      id: p.id,
      nombre: p.nombre,
      nombre_comercial: p.nombre_comercial,
      rnc: p.rnc,
      categoria,
      servicio: p.servicio,
      etiquetas: p.etiquetas ?? [],
      direccion: p.direccion,
      ciudad: p.ciudad,
      web: p.web,
      notas: p.notas,
      estado: p.estado,
      valoracion: p.valoracion,
    };
    return {
      ficha,
      contactos: (contactos.data ?? []) as TecProveedorContacto[],
      trabajos: (trabajos.data ?? []) as TecProveedorTrabajo[],
      facturas: (facturas.data ?? []) as TecProveedorFactura[],
    };
  }

  /** URL firmada (1 h) del archivo de una factura — bucket PRIVADO `tec-proveedores`. */
  async urlArchivo(path: string): Promise<string | null> {
    const { data } = await this.supabase.client.storage.from(BUCKET).createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  }
}
