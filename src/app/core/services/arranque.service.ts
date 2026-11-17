import { Injectable, inject } from '@angular/core';

import { SupabaseService } from './supabase.service';

type Resultado = { data: unknown; error: unknown };

/**
 * DS-45 / DS-51 F4.2 — lecturas de arranque en UNA llamada y con tiempo límite.
 *
 * Al abrir la app, varios servicios pedían `mis_preferencias()` cada uno por su cuenta (idioma,
 * bienvenida, Compa, avisos…). Aquí se comparte una sola llamada: `mi_arranque()` de SGC (DS-45b,
 * devuelve `preferencias` + conteos) y, si el RPC aún no existe en ese entorno, `mis_preferencias()`.
 * - Solo lecturas idempotentes: un reintento tras fallo es seguro (1 reintento, espera corta).
 * - Timeout explícito (8 s): un RPC lento no deja la pantalla de PIN/Home colgada.
 * - Ventana de 5 s: llamadas simultáneas o inmediatas comparten resultado; pasado ese tiempo se
 *   vuelve a leer (las preferencias pueden cambiar con `set_mi_preferencia`).
 * - Tiempos y fallos se acumulan en memoria (`tiempos`), sin datos personales.
 */
@Injectable({ providedIn: 'root' })
export class ArranqueService {
  private supabase = inject(SupabaseService);

  private static readonly TIMEOUT_MS = 8000;
  private static readonly VENTANA_MS = 5000;

  private enVuelo: Promise<Resultado> | null = null;
  private ultimo: { en: number; res: Resultado } | null = null;
  private sinMiArranque = false;

  /** Diagnóstico sin datos personales: duración y resultado de cada lectura de arranque. */
  readonly tiempos: { en: number; ms: number; via: string; ok: boolean }[] = [];

  /** Mismo contrato que `rpc('mis_preferencias')`: `{ data, error }`. */
  preferencias(): Promise<Resultado> {
    if (this.ultimo && Date.now() - this.ultimo.en < ArranqueService.VENTANA_MS) return Promise.resolve(this.ultimo.res);
    if (!this.enVuelo) {
      this.enVuelo = this.leer().finally(() => {
        this.enVuelo = null;
      });
    }
    return this.enVuelo;
  }

  private async leer(): Promise<Resultado> {
    let res = await this.intento();
    if (res.error && this.esTransitorio(res.error)) {
      await new Promise((r) => setTimeout(r, 600));
      res = await this.intento();
    }
    if (!res.error) this.ultimo = { en: Date.now(), res };
    return res;
  }

  private async intento(): Promise<Resultado> {
    const t0 = performance.now();
    let via = 'mi_arranque';
    let res: Resultado;
    try {
      if (!this.sinMiArranque) {
        const r = await this.conTimeout(this.supabase.client.rpc('mi_arranque'));
        if (!r.error && r.data) {
          res = { data: (r.data as { preferencias?: unknown }).preferencias ?? null, error: null };
          this.anotar(t0, via, true);
          return res;
        }
        // RPC inexistente en este entorno → se recuerda y se usa mis_preferencias().
        if (r.error && /not.?found|does not exist|could not find|PGRST202/i.test(`${(r.error as { message?: string }).message ?? ''} ${(r.error as { code?: string }).code ?? ''}`)) {
          this.sinMiArranque = true;
        } else if (r.error) {
          this.anotar(t0, via, false);
          return { data: null, error: r.error };
        }
      }
      via = 'mis_preferencias';
      const r2 = await this.conTimeout(this.supabase.client.rpc('mis_preferencias'));
      this.anotar(t0, via, !r2.error);
      return { data: r2.data, error: r2.error };
    } catch (e) {
      this.anotar(t0, via, false);
      return { data: null, error: e };
    }
  }

  private conTimeout<T>(p: PromiseLike<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), ArranqueService.TIMEOUT_MS);
      Promise.resolve(p).then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        },
      );
    });
  }

  private esTransitorio(e: unknown): boolean {
    const m = `${(e as { message?: string })?.message ?? e}`;
    return /timeout|fetch|network|failed to send|502|503|504/i.test(m);
  }

  private anotar(t0: number, via: string, ok: boolean): void {
    this.tiempos.push({ en: Date.now(), ms: Math.round(performance.now() - t0), via, ok });
    if (this.tiempos.length > 30) this.tiempos.shift();
  }
}
