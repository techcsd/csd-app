import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { VersionService, VersionHistorial, Plataforma } from '../../../core/services/version.service';

/**
 * Historial de versiones (línea de tiempo). Solo admin (ruta gated por
 * moduleGuard('admin')). Muestra por plataforma (app móvil / web) cada versión
 * con su fecha y los cambios que trajo.
 */
@Component({
  selector: 'app-admin-versiones',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton],
  templateUrl: './versiones.html',
  styleUrl: './versiones.scss',
})
export class AdminVersionesPage {
  private version = inject(VersionService);
  private location = inject(Location);

  private todas = signal<VersionHistorial[]>([]);
  loading = signal(true);
  error = signal('');
  plataforma = signal<Plataforma>('movil');

  versiones = computed(() => this.todas().filter((v) => v.plataforma === this.plataforma()));
  totalWeb = computed(() => this.todas().filter((v) => v.plataforma === 'web').length);
  totalMovil = computed(() => this.todas().filter((v) => v.plataforma === 'movil').length);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.todas.set(await this.version.historial());
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el historial.');
    } finally {
      this.loading.set(false);
    }
  }

  setPlataforma(p: Plataforma): void {
    this.plataforma.set(p);
  }

  /** dd/MM/yyyy sin pasar por new Date() (evita corrimientos de zona horaria). */
  fmt(f: string | null): string {
    if (!f) return '';
    const [y, m, d] = f.split('-');
    return `${d}/${m}/${y}`;
  }

  back(): void {
    this.location.back();
  }
}
