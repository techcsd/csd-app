import { inject, Injectable, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { SupabaseService } from '../services/supabase.service';
import { I18nService, Idioma } from './i18n.service';

/** Marca local: este dispositivo ya pasó por el diálogo de primer ingreso. */
const FLAG_ELEGIDO = 'idioma_elegido';
/** Idioma pendiente de sellar en el servidor (elegido offline / sin capacidad). */
const FLAG_SELLO_PENDIENTE = 'idioma_sello_pendiente';

/**
 * BS4 — diálogo de primer ingreso de idioma. El selector salió del PIN/Login; el
 * idioma se elige UNA vez, tras el primer login, en un modal bloqueante (o en
 * Perfil › Idioma después).
 *
 * ¿Cuándo preguntar? El idioma canónico vive en `usuarios.idioma` (NOT NULL default
 * 'es'), así que su presencia NO indica "el usuario ya eligió". La única señal fiable
 * es `usuario_preferencias.idioma_elegido_at` (lo sella `set_mi_preferencia('idioma',…)`
 * la primera vez, en la web O en la app). Se consulta con `mis_preferencias()`
 * **detrás de comprobación de capacidad**: si la RPC/tabla aún no existe o no hay red,
 * se degrada a la marca LOCAL y se reintenta sellar el servidor al próximo arranque.
 *
 * Regla de oro: se muestra a lo sumo una vez por dispositivo (marca local) y nunca si
 * el servidor ya tiene el idioma sellado (cross-device: quien eligió en la web no lo
 * ve en la app y entra ya traducido).
 */
@Injectable({ providedIn: 'root' })
export class IdiomaOnboardingService {
  private supabase = inject(SupabaseService);
  private i18n = inject(I18nService);

  private _mostrar = signal(false);
  /** El shell pinta el modal cuando esto es true (y no estamos en /auth). */
  mostrar = this._mostrar.asReadonly();

  /** Idioma preseleccionado en el diálogo = dispositivo si ∈{es,en,ht}, si no `es`. */
  private _preseleccion = signal<Idioma>('es');
  preseleccion = this._preseleccion.asReadonly();

  /** Una decisión por sesión: evita re-preguntar tras confirmar/detectar sellado. */
  private decidido = false;
  private evaluando = false;

  /**
   * BS4 — decide si mostrar el diálogo. Idempotente: llamar tras el primer login
   * y en cada arranque con sesión (fuera de /auth). No lanza nunca.
   */
  async evaluar(): Promise<void> {
    if (this.decidido || this._mostrar() || this.evaluando) return;
    this.evaluando = true;
    try {
      // 0) Reintento best-effort del sello pendiente (elegido offline en un arranque
      //    previo). Si lo logra, ya está sellado en el servidor (cross-device).
      await this.reintentarSelloPendiente();

      // 1) Marca local: este dispositivo ya eligió → no preguntar.
      try {
        const { value } = await Preferences.get({ key: FLAG_ELEGIDO });
        if (value === '1') {
          this.decidido = true;
          return;
        }
      } catch {
        /* Preferences no disponible → seguimos con el servidor */
      }

      // 2) Servidor (capacidad): ¿ya selló idioma_elegido_at? Si sí, adopta y calla.
      try {
        const { data, error } = await this.supabase.client.rpc('mis_preferencias');
        if (!error && data) {
          const prefs = data as { idioma?: string; idioma_elegido_at?: string | null };
          if (prefs.idioma_elegido_at) {
            if (prefs.idioma) await this.i18n.adoptFromServer(prefs.idioma);
            await this.marcarElegidoLocal();
            this.decidido = true;
            return;
          }
          // RPC OK pero sin sellar → el usuario nunca ha elegido → preguntar.
        }
        // error (sin capacidad / offline) → preguntar en modo degradado (local-first).
      } catch {
        /* sin red / RPC ausente → preguntar en modo degradado */
      }

      // 3) Mostrar el diálogo, preseleccionando el idioma del dispositivo.
      this._preseleccion.set(this.i18n.deviceLang());
      this._mostrar.set(true);
    } finally {
      this.evaluando = false;
    }
  }

  /**
   * Confirma la elección del diálogo: aplica el idioma (local + canónico
   * `usuarios.idioma`) y sella `idioma_elegido_at` (capacidad; si falla, queda
   * pendiente para reintentar al próximo arranque). Cierra el modal.
   */
  async confirmar(lang: Idioma): Promise<void> {
    await this.i18n.setIdioma(lang); // local (Preferences) + mi_idioma_set (canónico)
    await this.marcarElegidoLocal();
    this.decidido = true;
    this._mostrar.set(false);
    // Sella el primer ingreso en el servidor (cross-device). Si falla → pendiente.
    const sellado = await this.sellarServidor(lang);
    if (!sellado) {
      try {
        await Preferences.set({ key: FLAG_SELLO_PENDIENTE, value: lang });
      } catch {
        /* best-effort */
      }
    }
  }

  /** Sella `idioma_elegido_at` vía `set_mi_preferencia`. true si el servidor confirmó. */
  private async sellarServidor(lang: Idioma): Promise<boolean> {
    try {
      const { error } = await this.supabase.client.rpc('set_mi_preferencia', {
        p_clave: 'idioma',
        p_valor: lang,
      });
      return !error;
    } catch {
      return false;
    }
  }

  /** Reintenta el sello pendiente (best-effort). Lo limpia solo si el servidor confirma. */
  private async reintentarSelloPendiente(): Promise<void> {
    let lang: string | null = null;
    try {
      lang = (await Preferences.get({ key: FLAG_SELLO_PENDIENTE })).value;
    } catch {
      return;
    }
    if (lang !== 'es' && lang !== 'en' && lang !== 'ht') return;
    if (await this.sellarServidor(lang)) {
      try {
        await Preferences.remove({ key: FLAG_SELLO_PENDIENTE });
      } catch {
        /* best-effort */
      }
    }
  }

  private async marcarElegidoLocal(): Promise<void> {
    try {
      await Preferences.set({ key: FLAG_ELEGIDO, value: '1' });
    } catch {
      /* best-effort */
    }
  }
}
