import { computed, inject, Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { I18nService } from '../i18n/i18n.service';
import { Usuario } from '../models/usuario.model';

/** AW7 — bucket público de fotos de perfil de usuario. */
const AVATARS_BUCKET = 'sgc-avatars';

// Selección del perfil + roles/módulos (misma forma que usa SGC).
const PROFILE_SELECT =
  'id, nombre, email, telefono, activo, es_prueba, avatar_path, preferencias, idioma, roles:usuarios_roles!usuario_id(rol:roles(codigo, nombre, modulos, permisos))';
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
  private i18n = inject(I18nService);

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
  /** AY1 — teléfono editable por el propio usuario. */
  telefono = computed(() => this._profile()?.telefono ?? '');

  /**
   * AY1 — edición self-service de MI nombre visible + teléfono (RPC self-scoped
   * mi_perfil_actualizar por auth.uid(); NO toca rol/permisos/login/es_prueba).
   * Refresca el perfil para que la UI muestre el cambio.
   */
  async actualizarMiPerfil(nombre: string, telefono: string): Promise<void> {
    const id = this._profile()?.id;
    if (!id) throw new Error('Sesión no cargada.');
    const { error } = await this.supabase.client.rpc('mi_perfil_actualizar', {
      p_nombre: nombre,
      p_telefono: telefono,
    });
    if (error) throw new Error(error.message);
    await this.loadProfile(id);
  }

  /**
   * BD1 — ¿el usuario prefiere el home AGRUPADO por sección? Preferencia por usuario
   * (server-side, sobrevive reinstalación/multi-dispositivo). Por defecto OFF: el
   * home vuelve al grid plano para todos; el que la quiera la activa en Perfil.
   */
  agruparHome = computed(() => this._profile()?.preferencias?.['agrupar_home'] === true);

  /**
   * BD1 — fija una preferencia del usuario (RPC self-scoped `mi_preferencia_set`).
   * Aplica OPTIMISTA en local (signal + caché de disco) para que la UI reaccione
   * al instante y sobreviva un reinicio offline; revierte si el servidor falla.
   */
  async setPreferencia(clave: string, valor: unknown): Promise<void> {
    const prev = this._profile()?.preferencias?.[clave];
    this.aplicarPreferenciaLocal(clave, valor);
    const { error } = await this.supabase.client.rpc('mi_preferencia_set', {
      p_clave: clave,
      p_valor: valor,
    });
    if (error) {
      this.aplicarPreferenciaLocal(clave, prev); // revertir
      throw new Error(error.message);
    }
  }

  /** BD1 — actualiza una preferencia en el perfil en memoria + la caché en disco. */
  private aplicarPreferenciaLocal(clave: string, valor: unknown): void {
    const p = this._profile();
    if (!p) return;
    const next: Usuario = { ...p, preferencias: { ...(p.preferencias ?? {}), [clave]: valor } };
    this._profile.set(next);
    void this.catalog.optimisticUpdate<Usuario>(`${PROFILE_CACHE_PREFIX}${p.id}`, () => next);
  }

  /**
   * AW7/BT3 — URL pública de mi foto de perfil (o null si no tengo). Se construye
   * con el helper del SDK (`getPublicUrl`), igual que la web (regla de paridad),
   * en vez de concatenar a mano; así el path se codifica bien siempre. El bucket
   * `sgc-avatars` es público → URL directa (no firma que caduque).
   */
  miAvatarUrl = computed<string | null>(() => {
    const p = this._profile()?.avatar_path;
    if (!p) return null;
    return this.supabase.client.storage.from(AVATARS_BUCKET).getPublicUrl(p).data.publicUrl;
  });

  /**
   * AW7 — sube mi foto de perfil (ya recortada por el editor) al bucket público
   * `sgc-avatars` con un nombre único (no upsert → no requiere política UPDATE) y
   * actualiza `usuarios.avatar_path` vía `actualizar_mi_avatar`. Refresca el perfil.
   */
  async actualizarMiAvatar(blob: Blob): Promise<void> {
    const id = this._profile()?.id;
    if (!id) throw new Error('Sesión no cargada.');
    const path = `${id}/avatar-${crypto.randomUUID()}.jpg`;
    const { error: upErr } = await this.supabase.client.storage
      .from(AVATARS_BUCKET)
      .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (upErr) throw new Error(upErr.message);
    const { error } = await this.supabase.client.rpc('actualizar_mi_avatar', { p_path: path });
    if (error) throw new Error(error.message);
    await this.loadProfile(id);
  }

  // R14/S15/AS5 — roles de flota ELEVADOS (mismo criterio que sgc.es_flota_elevado()
  // y UserService.esFlotaElevado de la web). El chofer (chofer_transportista) NO es
  // elevado: ve solo sus cuadros. BO2 — `logistica` (Raykler/Misael) SÍ es elevado:
  // faltaba aquí (espejo desincronizado con el padre), por eso caía al bucle del
  // conduce y al bloqueo de km como un chofer cualquiera.
  private static readonly FLOTA_ELEVADO = ['admin', 'direccion', 'gerencia', 'jefe_flota', 'logistica'];
  esFlotaElevado = computed(() =>
    this.roles().some((r) => UserContextService.FLOTA_ELEVADO.includes(r)),
  );

  // Z26 — submódulos restringidos de Tecnología ("Versiones de App", "Reportes
  // de errores"): visibles solo para estos roles (mismo criterio que
  // sgc.es_tecnologia()). El resto de Tecnología (Historial de versiones, Guía,
  // Dudas) lo ve TODO usuario.
  // BX1b — incluye `desarrollador`: tras aplicar bx1b (es_tecnologia() añade
  // 'desarrollador') en dev Y prod, la RLS de `app_error_reports` ya deja leer al rol
  // Developer, así que la pestaña "Reportes de errores" SÍ se le pinta. Espejo exacto de
  // sgc.es_tecnologia() (admin|tecnologia|gerencia|direccion|desarrollador). Las Dev notes
  // van por otro gate (esDesarrollador ↔ es_rol_desarrollador).
  private static readonly TECNOLOGIA = ['admin', 'tecnologia', 'gerencia', 'direccion', 'desarrollador'];
  esTecnologia = computed(() =>
    this.roles().some((r) => UserContextService.TECNOLOGIA.includes(r)),
  );

  // BS2 — DESARROLLADOR/programador (espejo EXACTO de sgc.es_desarrollador()).
  // BX1 — la fuente única del padre es sgc.es_rol_desarrollador(): admin | tecnologia
  // | encargado_tecnologia | **desarrollador** (rol Developer nuevo). Más estrecho que
  // esTecnologia (no incluye gerencia/dirección). Es el gate del DETALLE TÉCNICO de un
  // error (SQLSTATE + crudo) y del 🩺 Código: un trabajador de campo nunca ve jerga de
  // BD; el dev sí, para diagnosticar.
  private static readonly DESARROLLADOR = ['admin', 'tecnologia', 'encargado_tecnologia', 'desarrollador'];
  esDesarrollador = computed(() =>
    this.roles().some((r) => UserContextService.DESARROLLADOR.includes(r)),
  );

  // AC2 — el módulo Tecnología es público para TODOS los usuarios EXCEPTO el
  // rol chofer (experiencia reducida de la app). Espejo de sgc.es_chofer()
  // (rol 'chofer_transportista'); un usuario con ese rol se considera chofer
  // aunque tenga otros roles, igual que el helper del servidor.
  esChofer = computed(() => this.hasRol('chofer_transportista'));

  // AV2 — "Mi rendimiento" (informe de incentivo PERSONAL) participa SOLO el
  // Chofer y el Jefe de flota. Fuente ÚNICA del gating (menú de Transporte + guard
  // de ruta), espejo del gating por rol de la web: NO lo ven admin/gerencia/
  // dirección (esos conservan las vistas ADMINISTRATIVAS del incentivo — /incentivos
  // —, no la personal). Un `if` suelto por pantalla es justo lo que AV2 prohíbe.
  puedeVerMiRendimiento = computed(() => this.esChofer() || this.hasRol('jefe_flota'));

  // AE6 — el rol admin (Xaviel) mantiene la opción de GALERÍA en los flujos
  // solo-cámara (combustible, reporte semanal, pre-uso, entrega/devolución) para
  // QA/pruebas; nadie más la ve. Regla general del modo solo-cámara.
  esAdmin = computed(() => this.hasRol('admin'));

  // AY7 — usuario de PRUEBA: se comporta 100% como su rol (mismo menú/guards/RPCs),
  // con una diferencia visible: banner "USUARIO DE PRUEBA" (shell) + exclusión de lo
  // real (server-side). Fuente única para pintar el banner. Espejo de
  // sgc.soy_usuario_prueba(); aquí lo leemos del propio perfil (self-read).
  esPrueba = computed(() => this._profile()?.es_prueba === true);

  hasModulo(modulo: string): boolean {
    return this.modulos().includes(modulo);
  }

  hasRol(codigo: string): boolean {
    return this.roles().includes(codigo);
  }

  // ── AG12 — permisos por submódulo (`modulo.submodulo` → ver|operar) ──────────
  /** Mapa fusionado de permisos de submódulo de todos los roles del usuario. */
  private permisos = computed(() => {
    const merged: Record<string, 'ver' | 'operar'> = {};
    for (const ur of this._profile()?.roles ?? []) {
      for (const [k, v] of Object.entries(ur.rol.permisos ?? {})) {
        // operar gana sobre ver si un rol lo eleva.
        if (v === 'operar' || merged[k] !== 'operar') merged[k] = v as 'ver' | 'operar';
      }
    }
    return merged;
  });

  /**
   * Nivel efectivo sobre `modulo.submodulo` (espejo de `sgc.nivel_submodulo`):
   * admin ⇒ operar; tener el módulo padre ⇒ operar (retrocompat AG12); si no, el
   * permiso explícito del submódulo.
   */
  nivelSubmodulo(clave: string): 'ver' | 'operar' | null {
    if (this.esAdmin()) return 'operar';
    const padre = clave.split('.')[0];
    if (this.hasModulo(padre)) return 'operar';
    return this.permisos()[clave] ?? null;
  }

  puedeVerSubmodulo(clave: string): boolean {
    const n = this.nivelSubmodulo(clave);
    return n === 'ver' || n === 'operar';
  }

  puedeOperarSubmodulo(clave: string): boolean {
    return this.nivelSubmodulo(clave) === 'operar';
  }

  /**
   * AY4c — ¿puede GESTIONAR proyectos (crear/editar/borrar la obra)? Tener el módulo
   * `proyectos` por un rol que NO sea `ingeniero_oficina`. El Ingeniero de Oficina lleva
   * ese módulo SOLO para VER todas las obras + costos (cubicaciones) → es solo-lectura
   * sobre la ficha. Espejo de `sgc.puede_gestionar_proyectos()` (la RLS lo fuerza igual).
   */
  puedeGestionarProyectos = computed(
    () =>
      this.esAdmin() ||
      (this._profile()?.roles ?? []).some(
        (ur) => ur.rol.codigo !== 'ingeniero_oficina' && (ur.rol.modulos ?? []).includes('proyectos'),
      ),
  );

  /** ¿Puede ver ALGO del módulo Obra? (módulo padre o cualquier submódulo obra.*). */
  puedeVerObra = computed(() => {
    if (this.esAdmin() || this.hasModulo('obra')) return true;
    return Object.keys(this.permisos()).some((k) => k.startsWith('obra.'));
  });

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

    // BR7 — el idioma del servidor sigue al usuario entre dispositivos: adoptarlo
    // al cargar el perfil (best-effort; no re-escribe el servidor, solo aplica local).
    const idioma = (data ?? cached)?.idioma;
    if (idioma) void this.i18n.adoptFromServer(idioma);
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
