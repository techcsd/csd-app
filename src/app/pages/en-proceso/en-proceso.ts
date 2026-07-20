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
};

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
    if (b.ruta) void this.router.navigateByUrl(b.ruta);
    else this.location.back();
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
