import { inject, Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { environment } from '../../../environments/environment';

const CATALOG_KEY = 'version_publicada';

export interface VersionPublicada {
  version_publicada: string | null;
  notas: string | null;
  apk_url: string | null;
  version_minima: string | null;
}

export type Plataforma = 'web' | 'movil';

/** Cambio etiquetado (estilo "Keep a Changelog"). */
export interface CambioItem {
  t: 'nuevo' | 'mejora' | 'arreglo' | 'seguridad' | string;
  d: string;
}

export const CAMBIO_LABEL: Record<string, string> = {
  nuevo: 'Nuevo',
  mejora: 'Mejora',
  arreglo: 'Arreglo',
  seguridad: 'Seguridad',
};

/** Fila del historial de versiones (timeline admin). */
export interface VersionHistorial {
  id: string;
  version: string;
  plataforma: Plataforma;
  fecha: string | null;
  titulo: string | null;
  cambios: CambioItem[];
  url: string | null;
  apk_url: string | null;
}

/**
 * Staged rollout (R15). The "published" version is decided by admins in SGC and
 * is independent from the internal build. On startup we read version_publicada()
 * and: block the app if the local build is below the minimum, and nudge when a
 * newer published version exists. The last value is cached for offline.
 */
@Injectable({ providedIn: 'root' })
export class VersionService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);

  readonly local = environment.version;
  info = signal<VersionPublicada | null>(null);

  /** Refresh from the server (cached). Safe to call at startup. */
  async check(): Promise<void> {
    const data = await this.catalog.refresh<VersionPublicada>(CATALOG_KEY, async () => {
      const { data, error } = await this.supabase.client.rpc('version_publicada');
      if (error) throw new Error(error.message);
      return (data as VersionPublicada) ?? { version_publicada: null, notas: null, apk_url: null, version_minima: null };
    });
    if (data) this.info.set(data);
  }

  /** The label to show in About/Perfil — the published version, or the build. */
  get etiquetaVersion(): string {
    return this.info()?.version_publicada ?? this.local;
  }

  /** True when the local build is below the published minimum → must update. */
  debeActualizar(): boolean {
    const min = this.info()?.version_minima;
    return !!min && cmpVersion(this.local, min) < 0;
  }

  /** True when a newer published version exists (non-blocking nudge). */
  hayNueva(): boolean {
    const pub = this.info()?.version_publicada;
    return !!pub && cmpVersion(pub, this.local) > 0;
  }

  get apkUrl(): string | null {
    return this.info()?.apk_url ?? null;
  }

  get notas(): string | null {
    return this.info()?.notas ?? null;
  }

  /** Historial de versiones (ambas plataformas), más reciente primero. Solo admin. */
  async historial(): Promise<VersionHistorial[]> {
    const { data, error } = await this.supabase.client
      .from('app_versiones')
      .select('id, version, plataforma, fecha, titulo, cambios, url, apk_url')
      .order('fecha', { ascending: false, nullsFirst: false })
      .order('version', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as unknown as VersionHistorial[]) ?? [];
  }
}

/** Compare dotted numeric versions: -1 | 0 | 1. */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0);
  const pb = b.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}
