import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { TecnologiaService } from '../../../core/services/tecnologia.service';
import { TecEquipo, TecTipo, TEC_ESTADO_LABEL, TecEstado } from '../../../core/models/tecnologia.model';
import { ToastService } from '../../../core/services/toast.service';

/** AL2 — Detalle de un equipo tecnológico + galería con lightbox. */
@Component({
  selector: 'app-tec-equipo-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Skeleton, EmptyState],
  templateUrl: './equipo-detalle.html',
  styleUrl: './equipo-detalle.scss',
})
export class TecEquipoDetallePage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private tec = inject(TecnologiaService);
  private location = inject(Location);
  private toast = inject(ToastService);

  readonly estadoLabel = TEC_ESTADO_LABEL;

  id = this.route.snapshot.paramMap.get('id') ?? '';
  loading = signal(true);
  equipo = signal<TecEquipo | null>(null);
  tipos = signal<TecTipo[]>([]);
  urls = signal<string[]>([]);
  lightbox = signal<number | null>(null);

  tipoLabel = computed(() => this.tipos().find((t) => t.id === this.equipo()?.tipo_id)?.label ?? '—');
  estadoDe = computed(() => {
    const e = this.equipo();
    return e ? (this.estadoLabel[e.estado as TecEstado] ?? e.estado) : '';
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [e, tipos] = await Promise.all([this.tec.getEquipo(this.id), this.tec.getTipos()]);
      this.equipo.set(e);
      this.tipos.set(tipos);
      if (e) {
        const paths = e.fotos && e.fotos.length ? e.fotos : [e.foto_portada, e.foto_path].filter((p): p is string => !!p);
        const portada = e.foto_portada;
        const ordered = portada ? [portada, ...paths.filter((p) => p !== portada)] : paths;
        const urls: string[] = [];
        for (const p of ordered) {
          const u = await this.tec.fotoUrl(p);
          if (u) urls.push(u);
        }
        this.urls.set(urls);
      }
    } catch {
      this.toast.error('No pudimos cargar el equipo.');
    } finally {
      this.loading.set(false);
    }
  }

  abrirLightbox(i: number): void {
    this.lightbox.set(i);
  }
  cerrarLightbox(): void {
    this.lightbox.set(null);
  }
  lightboxUrl = computed(() => {
    const i = this.lightbox();
    return i == null ? null : (this.urls()[i] ?? null);
  });

  editar(): void {
    void this.router.navigate(['/tecnologia-inventario', this.id, 'editar']);
  }
  back(): void {
    this.location.back();
  }
}
