import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { DudaCategoria, GuiaVisual, GuiaVideoFirmado } from '../models/ayuda.model';

interface AyudaRow {
  tipo: 'guia' | 'duda_categoria';
  contenido: GuiaVisual | DudaCategoria;
}

// CK5 — bucket PRIVADO donde el padre sube los videos tutoriales (se firma 1h).
const TUTORIALES_BUCKET = 'tutoriales';

/**
 * Z30 — Contenido de ayuda (Dudas + Guías) desde `sgc.ayuda_contenido`. Misma
 * fuente que la web; cacheado offline por el canal de catálogos (read-through).
 * El filtrado por módulo/rol se hace en la pantalla (igual que la web).
 */
@Injectable({ providedIn: 'root' })
export class AyudaService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);

  async getContenido(): Promise<{ guias: GuiaVisual[]; categorias: DudaCategoria[] }> {
    const rows = await this.catalog.refresh<AyudaRow[]>('ayuda_contenido', async () => {
      const { data, error } = await this.supabase.client
        .from('ayuda_contenido')
        .select('tipo, contenido, orden')
        .eq('activo', true)
        .order('orden', { ascending: true });
      if (error) throw new Error(error.message);
      return (data as AyudaRow[]) ?? [];
    });
    const list = rows ?? [];
    return {
      guias: list.filter((r) => r.tipo === 'guia').map((r) => r.contenido as GuiaVisual),
      categorias: list.filter((r) => r.tipo === 'duda_categoria').map((r) => r.contenido as DudaCategoria),
    };
  }

  /** CK5 — ¿la guía trae un video adjunto? Devuelve su path (o null). */
  pathVideo(g: GuiaVisual): string | null {
    return g.video_path ?? g.video ?? null;
  }

  /**
   * CK5 — Firma las URLs del video de una guía desde el bucket PRIVADO
   * `tutoriales` (signed URL 1h). Best-effort: si algo falla devuelve null y la UI
   * cae al mensaje correspondiente (los pasos de texto siguen visibles). NO
   * descarga ni precachea el video: solo firma la URL; el `<video preload="metadata">`
   * pide bytes recién al reproducir. El llamador DEBE verificar que hay conexión
   * antes de invocar (no firmar/streamear offline).
   */
  async firmarVideoGuia(g: GuiaVisual): Promise<GuiaVideoFirmado | null> {
    const path = this.pathVideo(g);
    if (!path) return null;
    const url = await this.firmar(path);
    if (!url) return null;
    const posterRaw = g.poster ?? g.poster_path ?? null;
    const subsRaw = g.subtitulos ?? g.subtitulos_path ?? null;
    return {
      url,
      poster: posterRaw ? await this.firmarOUrl(posterRaw) : null,
      subtitulos: subsRaw ? await this.firmar(subsRaw) : null,
      duracion: this.fmtDuracion(g.duracion),
    };
  }

  private async firmar(path: string): Promise<string | null> {
    try {
      const { data } = await this.supabase.client.storage
        .from(TUTORIALES_BUCKET)
        .createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    } catch {
      return null;
    }
  }

  /** Póster: si ya es una URL http(s), úsala tal cual; si es ruta de bucket, fírmala. */
  private async firmarOUrl(path: string): Promise<string | null> {
    if (/^https?:\/\//i.test(path)) return path;
    return this.firmar(path);
  }

  private fmtDuracion(d: string | number | undefined): string | null {
    if (d == null || d === '') return null;
    if (typeof d === 'number') {
      const m = Math.floor(d / 60);
      const s = Math.round(d % 60);
      return `${m}:${String(s).padStart(2, '0')}`;
    }
    return String(d);
  }
}
