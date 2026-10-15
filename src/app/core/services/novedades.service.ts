import { effect, inject, Injectable, Injector, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { NetworkService } from './network.service';
import { NavGuardService } from './nav-guard.service';
import { BienvenidaService } from './bienvenida.service';
import type { CambioItem } from './version.service';

/** CO2 — un ítem de `novedades_pendientes().versiones[]` (mismo `cambios[]` que `app_versiones`). */
export interface NovedadVersion {
  version: string;
  titulo: string | null;
  cambios: CambioItem[] | null;
  fecha: string | null;
  url: string | null;
}

/** CO2 — forma exacta de `sgc.novedades_pendientes(p_plataforma)`. */
export interface NovedadesPendientes {
  tiene_pendientes: boolean;
  version_vista: string | null;
  versiones: NovedadVersion[];
  total_versiones: number;
  hay_mas: boolean;
  /** Frases ya armadas en texto por el servidor ("Arreglamos un error que reportaste: …"). */
  arreglado_para_ti: string[];
}

/**
 * CO2 — "Novedades" a pantalla completa: al volver a entrar, si hay versiones
 * publicadas que el usuario no vio (o arreglos que le tocan a él), se las muestra
 * una vez, con "lo que reportaste ya está arreglado" primero. Contrato:
 * `sgc.novedades_pendientes('app')` / `sgc.marcar_novedades_vistas('app', version)`
 * (PROMPT-98 F7, verificado vivo en sgc-dev).
 *
 * Orden de aparición (regla del prompt): logo (CM2) → bienvenida (CL3) → Novedades
 * → app. Nunca encima de un formulario/wizard. Capability-safe: si el RPC aún no
 * existe en el entorno, no pasa nada (no se muestra, no rompe).
 */
@Injectable({ providedIn: 'root' })
export class NovedadesService {
  private supabase = inject(SupabaseService);
  private network = inject(NetworkService);
  private navGuard = inject(NavGuardService);
  private bienvenida = inject(BienvenidaService);
  private injector = inject(Injector);

  private _mostrar = signal(false);
  readonly mostrar = this._mostrar.asReadonly();
  private _datos = signal<NovedadesPendientes | null>(null);
  readonly datos = this._datos.asReadonly();

  /** "Ver historial completo" dentro de la misma pantalla (CO2 §2). */
  verTodoElHistorial = signal(false);

  private intentado = false;
  private timerEspera: ReturnType<typeof setInterval> | null = null;

  constructor() {
    void this.orquestar();
  }

  /** Espera a que la bienvenida (CL3) se decida y, si se muestra, a que se cierre. */
  private async orquestar(): Promise<void> {
    try {
      const seMostrara = await this.bienvenida.decision;
      if (seMostrara) await this.esperarCierreBienvenida();
    } catch {
      /* si la promesa de bienvenida nunca resuelve (no debería), seguimos igual */
    }
    void this.evaluar();
  }

  private esperarCierreBienvenida(): Promise<void> {
    if (!this.bienvenida.mostrar()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const ref = effect(
        () => {
          if (!this.bienvenida.mostrar()) {
            resolve();
            queueMicrotask(() => ref.destroy());
          }
        },
        { injector: this.injector },
      );
    });
  }

  /** Idempotente por sesión (una vez el intento, con o sin resultado). Offline = no-op
   *  (se reintenta en la próxima apertura con red, nunca queda "visto" sin mostrarse). */
  async evaluar(): Promise<void> {
    if (this.intentado) return;
    if (!this.network.online()) return;
    this.intentado = true;
    try {
      const { data, error } = await this.supabase.client.rpc('novedades_pendientes', { p_plataforma: 'app' });
      if (error || !data) return; // capability-safe: RPC aún no existe en el entorno
      const d = data as NovedadesPendientes;
      if (!d.tiene_pendientes) return;
      this._datos.set(d);
      this.mostrarCuandoSeguro();
    } catch {
      /* best-effort */
    }
  }

  /** Nunca encima de un formulario/wizard en curso (espera a que se cierre, como el updater). */
  private mostrarCuandoSeguro(): void {
    const intentar = (): boolean => {
      if (this.navGuard.formActivo) return false;
      this._mostrar.set(true);
      return true;
    };
    if (intentar()) return;
    this.timerEspera = setInterval(() => {
      if (intentar() && this.timerEspera) {
        clearInterval(this.timerEspera);
        this.timerEspera = null;
      }
    }, 2000);
  }

  /** "Entendido" (o Esc/atrás — cuenta como vista igual). Marca la versión más reciente mostrada. */
  async entendido(): Promise<void> {
    const d = this._datos();
    this._mostrar.set(false);
    this.verTodoElHistorial.set(false);
    const ultima = d?.versiones?.[0]?.version;
    if (!ultima) return;
    try {
      await this.supabase.client.rpc('marcar_novedades_vistas', { p_plataforma: 'app', p_version: ultima });
    } catch {
      /* best-effort: en el peor caso se vuelve a mostrar la próxima vez */
    }
  }
}
