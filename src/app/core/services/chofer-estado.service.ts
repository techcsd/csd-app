import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { LocalStore } from './local-store.service';
import { NetworkService } from './network.service';
import { UserContextService } from './user-context.service';

/** AF28 — los 6 estados de disponibilidad del chofer (mismo enum que el backend). */
export type EstadoChofer =
  | 'disponible'
  | 'en_ruta'
  | 'descanso'
  | 'almuerzo'
  | 'inactivo'
  | 'otros';

export interface EstadoMeta {
  key: EstadoChofer;
  label: string;
  icon: string;
  tint: string;
  /** true = lo fija el sistema (En ruta), no se ofrece como botón manual. */
  auto?: boolean;
}

/** Metadatos de cada estado (label en español RD, color para el chip/mapa). */
export const ESTADOS_CHOFER: EstadoMeta[] = [
  { key: 'disponible', label: 'Disponible', icon: '🟢', tint: '#16a34a' },
  { key: 'en_ruta', label: 'En ruta', icon: '🚚', tint: '#2563eb', auto: true },
  { key: 'descanso', label: 'Descanso', icon: '☕', tint: '#ca8a04' },
  { key: 'almuerzo', label: 'Hora de almuerzo', icon: '🍽️', tint: '#f97316' },
  { key: 'inactivo', label: 'Inactivo', icon: '🌙', tint: '#6b7280' },
  { key: 'otros', label: 'Otros', icon: '✏️', tint: '#7c3aed' },
];

/** Estados que el chofer puede elegir a mano (En ruta es automático por ruta). */
export const ESTADOS_MANUALES = ESTADOS_CHOFER.filter((e) => !e.auto);

export function estadoMeta(key: EstadoChofer | null | undefined): EstadoMeta {
  return ESTADOS_CHOFER.find((e) => e.key === key) ?? ESTADOS_CHOFER[0];
}

/** Duración de la hora de almuerzo (1h, el backend la respeta con el cron). */
const ALMUERZO_MS = 60 * 60 * 1000;
const STORE_KEY = 'chofer_estado';

interface EstadoSnap {
  estado: EstadoChofer;
  otrosTexto: string | null;
  almuerzoInicio: number | null; // epoch ms
  desde: number; // epoch ms
}

/**
 * AF28 — estado de disponibilidad del chofer. Fuente de verdad del servidor
 * (`set_chofer_estado`/`choferes_estado`), con espejo LOCAL para pintar el
 * countdown de almuerzo y sobrevivir un arranque offline. "En ruta" lo fija el
 * backend al iniciar/terminar ruta (no es un botón manual). El estado alimenta el
 * Seguimiento del jefe de flota (AF27).
 */
@Injectable({ providedIn: 'root' })
export class ChoferEstadoService {
  private supabase = inject(SupabaseService);
  private store = inject(LocalStore);
  private net = inject(NetworkService);
  private ctx = inject(UserContextService);

  private _estado = signal<EstadoChofer>('disponible');
  private _otros = signal<string | null>(null);
  private _almuerzoInicio = signal<number | null>(null);
  private _desde = signal<number>(Date.now());
  private hydrated = false;
  /** Cambio hecho offline aún no confirmado al servidor (se reintenta al volver). */
  private dirty = false;

  estado = this._estado.asReadonly();
  otrosTexto = this._otros.asReadonly();
  almuerzoInicio = this._almuerzoInicio.asReadonly();

  /** Latido de 1s (solo mientras hay almuerzo activo) para refrescar el countdown. */
  private _tick = signal(Date.now());
  private timer: ReturnType<typeof setInterval> | null = null;

  /** ms restantes del almuerzo (o null si no está almorzando). */
  almuerzoRestanteMs = computed(() => {
    if (this._estado() !== 'almuerzo') return null;
    const inicio = this._almuerzoInicio();
    if (!inicio) return null;
    this._tick(); // depende del latido
    return Math.max(0, ALMUERZO_MS - (Date.now() - inicio));
  });

  /** "45:12" — mm:ss restantes del almuerzo (o null). */
  almuerzoRestanteLabel = computed(() => {
    const ms = this.almuerzoRestanteMs();
    if (ms == null) return null;
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  });

  constructor() {
    // Al recuperar señal, re-empuja un cambio de estado hecho offline (para que el
    // servidor no quede con un estado viejo y el Seguimiento del jefe lo vea).
    effect(() => {
      if (this.net.online() && this.dirty) void this.pushEstado();
    });
  }

  /** Hidrata el estado: espejo local al instante + revalida contra el servidor. */
  async load(): Promise<void> {
    if (!this.hydrated) {
      const raw = await this.store.get(STORE_KEY);
      if (raw) {
        try {
          const s = JSON.parse(raw) as EstadoSnap;
          this._estado.set(s.estado);
          this._otros.set(s.otrosTexto ?? null);
          this._almuerzoInicio.set(s.almuerzoInicio ?? null);
          this._desde.set(s.desde ?? Date.now());
        } catch {
          /* ignore */
        }
      }
      this.hydrated = true;
      this.syncTimer();
    }
    await this.refreshFromServer();
  }

  private async refreshFromServer(): Promise<void> {
    // No pisar un cambio local aún sin confirmar (offline) con el estado viejo del servidor.
    if (this.dirty) return;
    try {
      const { data, error } = await this.supabase.client.rpc('choferes_estado');
      if (error) return;
      const uid = this.ctx.profile()?.id;
      const row = ((data as Array<Record<string, unknown>>) ?? []).find(
        (r) => r['usuario_id'] === uid,
      );
      if (!row) return;
      const estado = (row['estado'] as EstadoChofer) ?? 'disponible';
      // El almuerzo vence al pasar 1h aunque el cron aún no lo haya reseteado.
      const almInicio = row['almuerzo_inicio']
        ? new Date(row['almuerzo_inicio'] as string).getTime()
        : null;
      if (estado === 'almuerzo' && almInicio && Date.now() - almInicio >= ALMUERZO_MS) {
        this._estado.set('disponible');
        this._almuerzoInicio.set(null);
      } else {
        this._estado.set(estado);
        this._almuerzoInicio.set(almInicio);
      }
      this._otros.set((row['otros_texto'] as string) ?? null);
      this._desde.set(
        row['desde'] ? new Date(row['desde'] as string).getTime() : Date.now(),
      );
      await this.persist();
      this.syncTimer();
    } catch {
      /* offline — conserva el espejo local */
    }
  }

  /**
   * Fija el estado. Optimista + espejo local (para el countdown offline) y llama
   * al RPC best-effort; si no hay señal, el estado local vale y se resincroniza al
   * volver (semántica "estado actual" = last-write-wins, no encolamos estados viejos).
   */
  async set(estado: EstadoChofer, texto: string | null = null): Promise<void> {
    this._estado.set(estado);
    this._otros.set(estado === 'otros' ? texto : null);
    this._almuerzoInicio.set(estado === 'almuerzo' ? Date.now() : null);
    this._desde.set(Date.now());
    this.dirty = true;
    await this.persist();
    this.syncTimer();
    await this.pushEstado();
  }

  /** Empuja el estado actual al servidor; si falla/offline, queda dirty para reintentar. */
  private async pushEstado(): Promise<void> {
    if (!this.net.online()) return;
    try {
      await this.supabase.client.rpc('set_chofer_estado', {
        p_estado: this._estado(),
        p_texto: this._otros(),
      });
      this.dirty = false;
    } catch {
      /* se reintenta al volver la señal (effect) */
    }
  }

  /** AF28 — historial propio de cambios de estado (RLS: el chofer ve el suyo). */
  async historial(limite = 30): Promise<
    { estado: EstadoChofer; otros_texto: string | null; origen: string; created_at: string }[]
  > {
    const uid = this.ctx.profile()?.id;
    if (!uid) return [];
    const { data, error } = await this.supabase.client
      .from('chofer_estado_historial')
      .select('estado, otros_texto, origen, created_at')
      .eq('usuario_id', uid)
      .order('created_at', { ascending: false })
      .limit(limite);
    if (error) return [];
    return (data as Array<{
      estado: EstadoChofer;
      otros_texto: string | null;
      origen: string;
      created_at: string;
    }>) ?? [];
  }

  private async persist(): Promise<void> {
    const snap: EstadoSnap = {
      estado: this._estado(),
      otrosTexto: this._otros(),
      almuerzoInicio: this._almuerzoInicio(),
      desde: this._desde(),
    };
    await this.store.set(STORE_KEY, JSON.stringify(snap));
  }

  /** Enciende el latido solo mientras hay almuerzo activo; al vencer, a Disponible. */
  private syncTimer(): void {
    if (this._estado() === 'almuerzo' && !this.timer) {
      this.timer = setInterval(() => {
        this._tick.set(Date.now());
        if (this.almuerzoRestanteMs() === 0) {
          void this.set('disponible');
        }
      }, 1000);
    } else if (this._estado() !== 'almuerzo' && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
