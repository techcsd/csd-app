import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { BorradorService } from '../../core/services/borrador.service';
import { AutosaveService } from '../../core/services/autosave.service';
import { Borrador } from '../../core/db/app-db';
import { formatFechaMedia } from '../../core/util/fecha';

const TIPO_LABEL: Record<string, string> = {
  checklist: 'Checklist de vehículo',
  conductor: 'Conductor',
  vehiculo: 'Vehículo',
  parte: 'Bitácora del día',
  incidente: 'Reporte de incidente',
};

/** Borradores que se retoman por su clave (multi-borrador, ?borrador=). */
const RESUME_POR_CLAVE = new Set(['parte', 'incidente']);

/** Fase 4 — "Documentación en proceso": borradores sin enviar para retomar. */
@Component({
  selector: 'app-en-proceso',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyState, Skeleton, ConfirmDialog],
  templateUrl: './en-proceso.html',
  styleUrl: './en-proceso.scss',
})
export class EnProcesoPage {
  private borrador = inject(BorradorService);
  private autosave = inject(AutosaveService);
  private router = inject(Router);
  private location = inject(Location);

  loading = signal(true);
  borradores = signal<Borrador[]>([]);
  confirmar = signal<Borrador | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      // S5 — sube el borrador legacy 'parte_diario' a una clave por instancia
      // antes de listar, para que aparezca como un borrador más.
      await this.borrador.migrateLegacyParte();
      this.borradores.set(await this.borrador.list());
    } finally {
      this.loading.set(false);
    }
  }

  fmt(ms: number): string {
    return formatFechaMedia(new Date(ms).toISOString());
  }

  etiqueta(b: Borrador): string {
    return b.etiqueta || TIPO_LABEL[b.tipo ?? ''] || 'Documento sin enviar';
  }

  retomar(b: Borrador): void {
    if (!b.ruta) {
      this.location.back();
      return;
    }
    // S5 — parte/incidente se retoman por su clave (multi-borrador).
    const [path] = b.ruta.split('?');
    if (b.tipo && RESUME_POR_CLAVE.has(b.tipo)) {
      void this.router.navigate([path], { queryParams: { borrador: b.clave } });
    } else {
      void this.router.navigateByUrl(b.ruta);
    }
  }

  pedirDescartar(b: Borrador): void {
    this.confirmar.set(b);
  }

  async descartar(): Promise<void> {
    const b = this.confirmar();
    this.confirmar.set(null);
    if (!b) return;
    await this.autosave.discard(b.clave);
    this.borradores.update((list) => list.filter((x) => x.clave !== b.clave));
  }

  back(): void {
    this.location.back();
  }
}
