import { computed, inject, Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { Usuario } from '../models/usuario.model';

// Selección del perfil + roles/módulos (misma forma que usa SGC).
const PROFILE_SELECT =
  'id, nombre, email, activo, avatar_path, roles:usuarios_roles!usuario_id(rol:roles(codigo, nombre, modulos))';
// Prefijo de la caché en disco del perfil (offline-first).
const PROFILE_CACHE_PREFIX = 'perfil_';

/**
 * Holds the signed-in user's profile, roles and module gates — the same
 * shape SGC's UserService uses, so Home gating matches the web exactly.
 * Obra activa / vehículo a cargo are enriched from v_app_mi_contexto once
 * available; until then those signals are null and the app still works.
 *
 * El perfil (con roles/módulos) se cachea en disco (patrón cache-then-network /
 * stale-while-revalidate) para que en un arranque OFFLINE en frío el Home tenga
 * los módulos del último inicio de sesión, en vez de "Sin módulos asignados".
 */
@Injectable({ providedIn: 'root' })
export class UserContextService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);

  private _profile = signal<Usuario | null>(null);
  profile = this._profile.asReadonly();

  private _obraActiva = signal<{ id: string; nombre: string } | null>(null);
  obraActiva = this._obraActiva.asReadonly();

  /** Distinct module keys across all of the user's roles. */
  modulos = computed(() => {
    const all = this._profile()?.roles?.flatMap((ur) => ur.rol.modulos) ?? [];
    return [...new Set(all)];
  });

  roles = computed(() => this._profile()?.roles?.map((ur) => ur.rol.codigo) ?? []);

  nombre = computed(() => this._profile()?.nombre ?? '');

  // R14/S15 — roles de flota ELEVADOS (mismo criterio que sgc.es_flota_elevado()).
  // El chofer (chofer_transportista) NO es elevado: ve solo sus cuadros.
  private static readonly FLOTA_ELEVADO = ['admin', 'direccion', 'gerencia', 'jefe_flota'];
  esFlotaElevado = computed(() =>
    this.roles().some((r) => UserContextService.FLOTA_ELEVADO.includes(r)),
  );

  hasModulo(modulo: string): boolean {
    return this.modulos().includes(modulo);
  }

  hasRol(codigo: string): boolean {
    return this.roles().includes(codigo);
  }

  /**
   * Carga el perfil con cache-then-network: pinta al instante el perfil cacheado
   * (para que los módulos estén disponibles offline de una vez) y luego revalida
   * contra el servidor. Si el fetch falla (offline), conserva el cacheado en vez
   * de dejar al usuario "sin módulos". Solo queda null si NUNCA hubo caché.
   */
  async loadProfile(userId: string): Promise<void> {
    const key = `${PROFILE_CACHE_PREFIX}${userId}`;

    // 1) Hidratar del disco al instante (offline-safe).
    const cached = await this.catalog.read<Usuario>(key);
    if (cached) this._profile.set(cached);

    // 2) Revalidar: CatalogService.refresh escribe la caché si hay señal y
    //    devuelve la última copia cacheada si falla (offline/error).
    const data = await this.catalog.refresh<Usuario | null>(key, async () => {
      const { data, error } = await this.supabase.client
        .from('usuarios')
        .select(PROFILE_SELECT)
        .eq('id', userId)
        .single();
      if (error) throw new Error(error.message);
      return data as unknown as Usuario;
    });

    if (data) this._profile.set(data);
    else if (!cached) this._profile.set(null);
  }

  /**
   * Server check of whether this user is still active. Returns null when it
   * can't tell (offline / error) so callers keep the session rather than
   * locking a field user out over a dropped connection.
   */
  async checkActivo(): Promise<boolean | null> {
    const id = this._profile()?.id;
    if (!id) return null;
    const { data, error } = await this.supabase.client
      .from('usuarios')
      .select('activo')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { activo: boolean }).activo !== false;
  }

  setObraActiva(obra: { id: string; nombre: string } | null): void {
    this._obraActiva.set(obra);
  }

  clear(): void {
    this._profile.set(null);
    this._obraActiva.set(null);
    // Borra la caché del perfil en disco para que el próximo usuario no herede
    // los módulos del anterior (se limpia al cerrar sesión, online).
    void this.catalog.invalidatePrefix(PROFILE_CACHE_PREFIX);
  }
}
