import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { BitacoraService } from '../../../core/services/bitacora.service';
import { BitacoraFull } from '../../../core/models/bitacora.model';
import { formatFecha } from '../../../core/util/fecha';

interface Media {
  url: string;
  audio: boolean;
}

/** Read-only detail of one of my bitácoras, with photos/audio. */
@Component({
  selector: 'app-bitacora-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton],
  templateUrl: './detalle.html',
  styleUrl: './detalle.scss',
})
export class BitacoraDetallePage {
  private route = inject(ActivatedRoute);
  private bitacora = inject(BitacoraService);
  private location = inject(Location);

  b = signal<BitacoraFull | null>(null);
  media = signal<Media[]>([]);
  loading = signal(true);
  fmtFecha = formatFecha; // U9

  totalPersonal = computed(() => {
    const b = this.b();
    return b ? b.personal_carpinteria + b.personal_acero + b.trabajadores_casa : 0;
  });

  titulo = computed(() => {
    const t = this.b()?.tipo;
    return t === 'incidente' ? 'Incidente' : t === 'visita' ? 'Visita' : 'Bitácora del día';
  });

  /** U13 — obreros afectados por migración (jsonb → lista de strings). */
  obrerosMigracion = computed<string[]>(() => {
    const m = this.b()?.migracion_obreros;
    if (Array.isArray(m)) return m.map((x) => String(x));
    return [];
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    const list = await this.bitacora.misBitacoras();
    const b = list.find((x) => x.id === id) ?? null;
    this.b.set(b);
    if (b?.archivos?.length) {
      const media = await Promise.all(
        b.archivos.map(async (a) => {
          try {
            const url = await this.bitacora.getArchivoSignedUrl(a.url);
            return { url, audio: (a.tipo_mime ?? '').startsWith('audio') };
          } catch {
            return null;
          }
        }),
      );
      this.media.set(media.filter((m): m is Media => m !== null));
    }
    this.loading.set(false);
  }

  back(): void {
    this.location.back();
  }
}
