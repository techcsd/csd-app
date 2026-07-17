import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { ConductoresService } from '../../../core/services/conductores.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { Conductor, estadoLicencia, LicenciaEstado } from '../../../core/models/conductor.model';

const LIC_LABEL: Record<LicenciaEstado, string> = {
  vigente: 'Licencia vigente',
  por_vencer: 'Licencia por vencer',
  vencida: 'Licencia vencida',
  desconocido: 'Sin licencia',
};

/** Browse all drivers → tap one to open its profile (R5). */
@Component({
  selector: 'app-conductores-lista',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, EmptyState, Skeleton],
  templateUrl: './conductores.html',
  styleUrl: './conductores.scss',
})
export class ConductoresListaPage {
  private conductores = inject(ConductoresService);
  private ctx = inject(UserContextService);
  private router = inject(Router);
  private location = inject(Location);

  esAdmin = () => this.ctx.hasModulo('admin');

  loading = signal(true);
  private todos = signal<Conductor[]>([]);
  query = signal('');
  // C6 — umbral "por vencer" configurable (flota_config, alineado con la web).
  umbral = signal(90);
  // C7 — resumen de documentos por conductor + filtro "solo incompletos".
  private docsResumen = signal<Record<string, { tiene_cedula: boolean; tiene_licencia: boolean }>>({});
  soloIncompletos = signal(false);

  lista = computed(() => {
    const q = this.query().toLowerCase().trim();
    let base = this.todos();
    if (q) {
      base = base.filter(
        (c) => c.nombre.toLowerCase().includes(q) || (c.cedula ?? '').toLowerCase().includes(q),
      );
    }
    if (this.soloIncompletos()) base = base.filter((c) => this.docsIncompletos(c));
    return base;
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [lista, cfg, docs] = await Promise.all([
        this.conductores.getConductores(),
        this.conductores.getFlotaConfig().catch(() => null),
        this.conductores.getDocumentosResumen().catch(() => ({})),
      ]);
      this.todos.set(lista);
      if (cfg) this.umbral.set(cfg.licenciaDias);
      this.docsResumen.set(docs);
    } finally {
      this.loading.set(false);
    }
  }

  licEstado(c: Conductor): LicenciaEstado {
    return estadoLicencia(c.licencia_vencimiento, this.umbral());
  }
  licLabel(c: Conductor): string {
    return LIC_LABEL[this.licEstado(c)];
  }

  /** C7 — ¿le falta cédula o licencia? (por defecto ambos obligatorios). */
  docsIncompletos(c: Conductor): boolean {
    const r = this.docsResumen()[c.id];
    if (!r) return true; // sin registro en la vista → nada subido
    return !r.tiene_cedula || !r.tiene_licencia;
  }

  ver(c: Conductor): void {
    void this.router.navigate(['/transporte/conductor', c.id]);
  }

  nuevo(): void {
    void this.router.navigate(['/transporte/conductores/nuevo']);
  }

  back(): void {
    this.location.back();
  }
}
