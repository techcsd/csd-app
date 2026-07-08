import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe, Location } from '@angular/common';
import { SyncBadge, SyncState } from '../../../shared/ui/sync-badge/sync-badge';
import { BitacoraService } from '../../../core/services/bitacora.service';

interface ParteRow {
  id: string;
  tipo: string;
  capturado_en: string;
  estado: SyncState;
}

/** Offline list of parts/incidents I've captured, with their sync state. */
@Component({
  selector: 'app-mis-partes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, SyncBadge],
  templateUrl: './mis-partes.html',
  styleUrl: './mis-partes.scss',
})
export class MisPartesPage {
  private bitacora = inject(BitacoraService);
  private location = inject(Location);

  partes = signal<ParteRow[]>([]);
  loading = signal(true);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const rows = await this.bitacora.misPartesLocales();
    this.partes.set(
      rows.map((r) => {
        const resumen = (r.resumen ?? {}) as { tipo?: string; capturado_en?: string };
        return {
          id: r.id,
          tipo: resumen.tipo === 'incidente' ? 'Incidente' : 'Parte diario',
          capturado_en: resumen.capturado_en ?? new Date(r.created_local).toISOString(),
          estado: r.estado,
        };
      }),
    );
    this.loading.set(false);
  }

  back(): void {
    this.location.back();
  }
}
