import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { CAMBIO_LABEL, CambioItem, VersionService } from '../../core/services/version.service';
import { UpdaterService } from '../../core/services/updater.service';

/**
 * V3/V4 — "Nueva versión disponible" screen. Reached from the update banner,
 * the version-check button (V2), and (V4) the in-app new-version notification.
 * Native: downloads the APK with a progress bar and launches the installer.
 * PWA: offers the direct download link.
 *
 * AJ1 — el changelog se pinta como bullets agrupados por módulo (campo
 * estructurado `cambios[]` con `{t,d,m}`); las versiones viejas (solo texto en
 * `notas`) caen a bullets por oración. El área del changelog scrollea con altura
 * limitada y los botones de abajo quedan SIEMPRE visibles.
 */
@Component({
  selector: 'app-actualizar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './actualizar.html',
  styleUrl: './actualizar.scss',
})
export class ActualizarPage {
  private versionSvc = inject(VersionService);
  private updater = inject(UpdaterService);
  private location = inject(Location);

  esNativo = this.updater.esNativo;
  estado = this.updater.estado;
  progreso = this.updater.progreso;

  local = this.versionSvc.local;
  nueva = computed(() => this.versionSvc.etiquetaVersion);
  hayNueva = () => this.versionSvc.hayNueva();
  notas = () => this.versionSvc.notas;
  apkUrl = () => this.versionSvc.apkUrl;

  iniciado = signal(false);

  /** Changelog estructurado de la versión publicada (best-effort, red). */
  private cambios = signal<CambioItem[]>([]);

  /** AJ1 — bullets agrupados por módulo, preservando el orden de aparición.
   *  Los cambios sin módulo caen a un grupo "General". */
  grupos = computed<{ modulo: string; items: CambioItem[] }[]>(() => {
    const orden: string[] = [];
    const mapa = new Map<string, CambioItem[]>();
    for (const c of this.cambios()) {
      const key = c.m && c.m.trim() ? c.m.trim() : 'General';
      if (!mapa.has(key)) {
        mapa.set(key, []);
        orden.push(key);
      }
      mapa.get(key)!.push(c);
    }
    return orden.map((m) => ({ modulo: m, items: mapa.get(m)! }));
  });

  /** Fallback plano: sin `cambios` estructurados, parte `notas` en renglones. */
  notasBullets = computed<string[]>(() => {
    if (this.cambios().length) return [];
    const n = this.notas();
    if (!n) return [];
    return n
      .split(/\r?\n|(?<=[.;])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1);
  });

  hayChangelog = computed(() => this.cambios().length > 0 || this.notasBullets().length > 0);

  chipLabel = (t: string): string => CAMBIO_LABEL[t] ?? t;

  constructor() {
    void this.cargarCambios();
  }

  private async cargarCambios(): Promise<void> {
    this.cambios.set(await this.versionSvc.cambiosPublicados());
  }

  async actualizar(): Promise<void> {
    this.iniciado.set(true);
    await this.updater.actualizar();
  }

  abrirAjustes(): void {
    void this.updater.abrirAjustesPermiso();
  }

  volver(): void {
    this.location.back();
  }
}
