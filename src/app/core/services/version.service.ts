import { inject, Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { environment } from '../../../environments/environment';

const CATALOG_KEY = 'version_publicada';

export interface VersionPublicada {
  version_publicada: string | null;
  notas: string | null;
  apk_url: string | null;
  version_minima: string | null;
  version_code?: number | null;
  version_minima_code?: number | null;
}

export type Plataforma = 'web' | 'movil';

/** Cambio etiquetado (estilo "Keep a Changelog"). AJ1: `m` = módulo (opcional)
 *  para agrupar los bullets por módulo en la pantalla de actualización. */
export interface CambioItem {
  t: 'nuevo' | 'mejora' | 'arreglo' | 'seguridad' | string;
  d: string;
  m?: string | null;
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
  /**
   * APP-022 — el gate de "versión mínima" y el aviso de "hay versión nueva" son de
   * la APK de Android (descarga/instala un archivo). En la PWA/web NO aplican: el
   * navegador/PWA se actualiza SOLO por el service worker (UpdateService). Forzar el
   * gate en web dejaba a los usuarios en un BUCLE (el gate recarga, pero la versión
   * del bundle no cambia → gate otra vez). En web nunca bloqueamos ni avisamos aquí.
   */
  private readonly esNativo = Capacitor.isNativePlatform();

  /** Refresh from the server (cached). Safe to call at startup. */
  async check(): Promise<void> {
    const data = await this.catalog.refresh<VersionPublicada>(CATALOG_KEY, () => this.fetchRpc());
    if (data) this.info.set(data);
  }

  /**
   * Force a FRESH read of version_publicada() bypassing the read-through cache
   * (V2). The cached path is fine for the startup nudge, but the explicit
   * "Buscar actualización" tap must never report an old cached answer — it hits
   * the RPC directly and only falls back to cache when genuinely offline.
   * Returns true on a successful server read, false if we had to use the cache.
   */
  async checkFresh(): Promise<boolean> {
    try {
      const data = await this.fetchRpc();
      this.info.set(data);
      await this.catalog.refresh<VersionPublicada>(CATALOG_KEY, async () => data);
      return true;
    } catch (e) {
      console.warn('VersionService.checkFresh failed, using cache:', e);
      const cached = await this.catalog.read<VersionPublicada>(CATALOG_KEY);
      if (cached) this.info.set(cached);
      return false;
    }
  }

  /**
   * Y1 (historial confiable) — auto-reporta la versión instalada al historial
   * (`registrar_version`, idempotente). Es una RED DE SEGURIDAD además del script
   * de release: si un admin abre un build nuevo, la versión queda registrada sola
   * (sin correr ningún comando). El RPC es admin/service_role, así que para los
   * usuarios de campo hace no-op silencioso. Solo en builds de producción.
   */
  async autoRegistrar(): Promise<void> {
    if (!environment.production) return;
    try {
      await this.supabase.client.rpc('registrar_version', {
        p_plataforma: 'movil',
        p_version: this.local,
      });
    } catch {
      /* admin/service_role only — silencioso para el resto (no molesta al campo) */
    }
  }

  private async fetchRpc(): Promise<VersionPublicada> {
    const { data, error } = await this.supabase.client.rpc('version_publicada');
    if (error) throw new Error(error.message);
    return (
      (data as VersionPublicada) ?? {
        version_publicada: null,
        notas: null,
        apk_url: null,
        version_minima: null,
      }
    );
  }

  /** The label to show in About/Perfil — the published version, or the build. */
  get etiquetaVersion(): string {
    return this.info()?.version_publicada ?? this.local;
  }

  /** True when the local build is below the published minimum → must update.
   *  Solo en la APK nativa: la PWA/web se actualiza sola por service worker. */
  debeActualizar(): boolean {
    if (!this.esNativo) return false;
    const min = this.info()?.version_minima;
    return !!min && cmpVersion(this.local, min) < 0;
  }

  /** True when a newer published version exists (non-blocking nudge). Native-only. */
  hayNueva(): boolean {
    if (!this.esNativo) return false;
    const pub = this.info()?.version_publicada;
    return !!pub && cmpVersion(pub, this.local) > 0;
  }

  get apkUrl(): string | null {
    return this.info()?.apk_url ?? null;
  }

  get notas(): string | null {
    return this.info()?.notas ?? null;
  }

  /**
   * AJ1 — Changelog estructurado de la versión publicada (móvil), para pintar
   * bullets agrupados por módulo en la pantalla de actualización. `app_versiones`
   * es legible por `authenticated` (RLS using(true)); si no hay red o la versión
   * no trae `cambios`, la pantalla cae al texto plano de `notas`. Best-effort.
   */
  async cambiosPublicados(): Promise<CambioItem[]> {
    const pub = this.info()?.version_publicada;
    if (!pub) return [];
    try {
      const { data, error } = await this.supabase.client
        .from('app_versiones')
        .select('cambios')
        .eq('plataforma', 'movil')
        .eq('version', pub)
        .maybeSingle();
      if (error || !data) return [];
      const cambios = (data as { cambios: CambioItem[] | null }).cambios;
      return Array.isArray(cambios) ? cambios : [];
    } catch {
      return [];
    }
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
