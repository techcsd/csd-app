import { computed, inject, Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { environment } from '../../../environments/environment';
import { SupabaseService } from './supabase.service';
import { abrirUrlExterna } from '../utils/abrir-url.util';

export type DocLegal = 'privacidad' | 'terminos' | 'soporte' | 'eliminar-cuenta';
export interface PoliticaPendiente {
  documento: string;
  version: string;
}

/**
 * CI2/CI3/CI4 — Enlaces legales + aceptación versionada de políticas, espejo del
 * contrato del padre (PROMPT-86): `politicas_pendientes()` / `aceptar_politica(
 * p_documento, p_version, p_plataforma)`. Las páginas públicas viven en la web del
 * SGC (environment.webUrl) bajo /politicas/*.
 *
 * Offline: si no se puede consultar, NO se bloquea el campo — se revisa al reconectar.
 */
@Injectable({ providedIn: 'root' })
export class PoliticasService {
  private supabase = inject(SupabaseService);

  private _pendientes = signal<PoliticaPendiente[]>([]);
  readonly pendientes = this._pendientes.asReadonly();
  /** true cuando hay documentos por aceptar → se muestra la pantalla de aceptación. */
  readonly hayPendientes = computed(() => this._pendientes().length > 0);

  urlPolitica(doc: DocLegal): string {
    return `${environment.webUrl}/politicas/${doc}`;
  }

  async abrir(doc: DocLegal): Promise<void> {
    await abrirUrlExterna(this.urlPolitica(doc));
  }

  private plataforma(): string {
    return Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web';
  }

  /** Lee los documentos pendientes de aceptar. No lanza; offline deja el set vacío. */
  async revisarPendientes(): Promise<void> {
    try {
      const { data, error } = await this.supabase.client.rpc('politicas_pendientes');
      if (error) return; // offline / sin sesión: no bloquear, reintentar al reconectar
      const rows = (data as Array<Record<string, unknown>>) ?? [];
      this._pendientes.set(
        rows.map((r) => ({
          documento: String(r['documento'] ?? ''),
          version: String(r['version'] ?? r['version_vigente'] ?? ''),
        })),
      );
    } catch {
      /* best-effort */
    }
  }

  /** Acepta todos los documentos pendientes (idempotente server-side). */
  async aceptarTodas(): Promise<boolean> {
    try {
      for (const p of this._pendientes()) {
        const { error } = await this.supabase.client.rpc('aceptar_politica', {
          p_documento: p.documento,
          p_version: p.version,
          p_plataforma: this.plataforma(),
        });
        if (error) return false;
      }
      this._pendientes.set([]);
      return true;
    } catch {
      return false;
    }
  }

  /** CI4 — solicita la eliminación de la propia cuenta (una pendiente por usuario). */
  async solicitarEliminacion(motivo: string): Promise<boolean> {
    try {
      const { error } = await this.supabase.client.rpc('solicitar_eliminacion_cuenta', {
        p_motivo: motivo,
        p_plataforma: this.plataforma(),
      });
      return !error;
    } catch {
      return false;
    }
  }
}
