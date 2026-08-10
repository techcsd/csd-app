import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { TraspasoService } from '../../../core/services/traspaso.service';
import { AudioNotasService } from '../../../core/services/audio-notas.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatFechaCortaHora } from '../../../core/util/fecha';

interface ActaCondItem {
  etiqueta: string;
  respuesta: string | null;
  descripcion?: string | null;
  fotos?: string[];
  audios?: string[];
}
interface ActaDetalle {
  id: string;
  placa: string | null;
  marca: string | null;
  modelo: string | null;
  km: number | null;
  de: { nombre: string | null };
  a: { nombre: string | null };
  llave1_ubicacion_tipo: string | null;
  condiciones: ActaCondItem[];
  fotos: string[];
  notas: string | null;
  created_at: string;
  audios: { id: string; bucket: string; path: string; transcripcion?: string | null }[];
}

/** AH14 — detalle completo de un acta de recepción/traspaso: quién dejó/recibió,
 *  km, checklist con fallas (texto/voz/foto AH13), firmas y fotos. */
@Component({
  selector: 'app-acta-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Skeleton],
  templateUrl: './acta-detalle.html',
  styleUrl: './acta-detalle.scss',
})
export class ActaDetallePage {
  private traspaso = inject(TraspasoService);
  private audio = inject(AudioNotasService);
  private route = inject(ActivatedRoute);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);

  readonly fechaHora = formatFechaCortaHora;

  loading = signal(true);
  acta = signal<ActaDetalle | null>(null);
  /** path → URL firmada (fotos y audios). */
  urls = signal<Record<string, string>>({});

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loading.set(false);
      return;
    }
    try {
      const d = (await this.traspaso.actaDetalle(id)) as unknown as ActaDetalle | null;
      this.acta.set(d);
      if (d) void this.resolverUrls(d);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo cargar el acta.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Resuelve las URLs firmadas de fotos (bucket vehiculos) y audios (su bucket). */
  private async resolverUrls(d: ActaDetalle): Promise<void> {
    const jobs: Promise<void>[] = [];
    const add = (path: string, bucket: string) => {
      if (!path) return;
      jobs.push(
        this.audio.signedUrl(bucket, path).then((u) => {
          if (u) this.urls.update((m) => ({ ...m, [path]: u }));
        }),
      );
    };
    for (const p of d.fotos ?? []) add(p, 'vehiculos');
    for (const it of d.condiciones ?? []) {
      for (const p of it.fotos ?? []) add(p, 'vehiculos');
      for (const p of it.audios ?? []) add(p, 'flota-documentos');
    }
    for (const a of d.audios ?? []) add(a.path, a.bucket);
    await Promise.all(jobs);
  }

  url(path: string): string | null {
    return this.urls()[path] ?? null;
  }

  fallas(): ActaCondItem[] {
    return (this.acta()?.condiciones ?? []).filter((c) => c.respuesta === 'falla');
  }
  okItems(): ActaCondItem[] {
    return (this.acta()?.condiciones ?? []).filter((c) => c.respuesta !== 'falla');
  }
  respLabel(r: string | null): string {
    switch (r) {
      case 'ok': return '✅ Bien';
      case 'falla': return '⚠️ Falla';
      case 'na': return '➖ N/A';
      default: return '—';
    }
  }
  llaveLabel(t: string | null): string {
    switch (t) {
      case 'chofer_asignado': return '🧑‍✈️ Llave con el chofer';
      case 'oficina_central': return '🏢 Llave en oficina';
      case 'otro': return '📍 Llave en otro lugar';
      default: return '';
    }
  }
  marcaModelo(): string {
    const a = this.acta();
    return a ? [a.marca, a.modelo].filter(Boolean).join(' ') : '';
  }

  back(): void {
    this.navGuard.back('/transporte/mis-actas'); // QA-15 — back seguro
  }
}
