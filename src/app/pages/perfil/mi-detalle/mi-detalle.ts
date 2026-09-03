import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmailDisplayPipe } from '../../../shared/ui/pipes/email-display.pipe';
import { UserContextService } from '../../../core/services/user-context.service';
import { ConductoresService } from '../../../core/services/conductores.service';
import { DocumentosService } from '../../../core/services/documentos.service';
import { NetworkService } from '../../../core/services/network.service';
import { Conductor, ConductorStats, LicenciaEstado, estadoLicencia, diasHasta } from '../../../core/models/conductor.model';
import { Documento } from '../../../core/models/documento.model';
import { formatFecha, formatFechaHumana } from '../../../core/util/fecha';

interface DocView {
  label: string;
  url: string | null;
  esPdf: boolean;
}

/**
 * Z26 — detalle de mi propio usuario (solo lectura). Datos personales, rol,
 * y —si el usuario también es conductor— licencia + vencimiento, última
 * actividad (W12) y documentos (P3, foto ampliable). La gestión (subir docs,
 * ver actividad completa) vive en Mi actividad / Perfil del conductor; aquí es
 * una vista de consulta.
 */
@Component({
  selector: 'app-mi-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmailDisplayPipe],
  templateUrl: './mi-detalle.html',
  styleUrl: './mi-detalle.scss',
})
export class MiDetallePage {
  private ctx = inject(UserContextService);
  private conductores = inject(ConductoresService);
  private documentos = inject(DocumentosService);
  private network = inject(NetworkService);
  private router = inject(Router);
  private location = inject(Location);

  fmtFecha = formatFecha;
  fmtFechaHumana = formatFechaHumana;

  loading = signal(true);
  online = this.network.online;

  nombre = this.ctx.nombre;
  obra = this.ctx.obraActiva;
  email = computed(() => this.ctx.profile()?.email ?? '');
  /** Nombres legibles de los roles (no los códigos). */
  rolesNombres = computed(
    () => this.ctx.profile()?.roles?.map((ur) => ur.rol.nombre).filter(Boolean) ?? [],
  );
  inicial = computed(() => (this.nombre() || '?').charAt(0).toUpperCase());

  // Conductor (opcional): licencia + docs + última actividad.
  conductor = signal<Conductor | null>(null);
  stats = signal<ConductorStats | null>(null);
  cedulas = signal<DocView[]>([]);
  licencias = signal<DocView[]>([]);
  esConductor = computed(() => !!this.conductor());
  puedeVerActividad = () => this.ctx.hasModulo('flota');

  private umbral = signal(30);
  licEstado = computed<LicenciaEstado>(() =>
    estadoLicencia(this.conductor()?.licencia_vencimiento ?? null, this.umbral()),
  );
  licDias = computed(() => diasHasta(this.conductor()?.licencia_vencimiento ?? null));
  licEstadoLabel = computed(() => {
    switch (this.licEstado()) {
      case 'vencida':
        return '⛔ Vencida';
      case 'por_vencer':
        return '⚠ Por vencer';
      case 'vigente':
        return '✓ Vigente';
      default:
        return '—';
    }
  });

  // Foto ampliable (P3): overlay a pantalla completa.
  ampliada = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const cond = await this.conductores.getMiConductor();
      this.conductor.set(cond);
      if (cond) {
        try {
          const cfg = await this.conductores.getFlotaConfig();
          this.umbral.set(cfg.licenciaDias);
        } catch {
          /* umbral por defecto (30) */
        }
        void this.conductores.getMiStats().then((s) => this.stats.set(s));
        await this.loadDocs(cond.id);
      }
    } finally {
      this.loading.set(false);
    }
  }

  private async loadDocs(id: string): Promise<void> {
    const docs = await this.documentos.getDocumentos('conductor', id); // desc
    const toView = async (d: Documento, label: string): Promise<DocView> => ({
      label,
      url: await this.documentos.getSignedUrl(d.path),
      esPdf: /\.pdf$/i.test(d.path),
    });
    const porTipo = (tipo: string, base: string): Promise<DocView[]> => {
      const list = docs.filter((d) => d.tipo === tipo);
      return Promise.all(list.map((d, i) => toView(d, list.length > 1 ? `${base} (${i + 1})` : base)));
    };
    this.cedulas.set(await porTipo('cedula', 'Cédula'));
    this.licencias.set(await porTipo('licencia', 'Licencia de conducir'));
  }

  ampliar(url: string | null): void {
    if (url) this.ampliada.set(url);
  }
  cerrarAmpliada(): void {
    this.ampliada.set(null);
  }

  verMiActividad(): void {
    void this.router.navigate(['/transporte/mi-actividad']);
  }

  back(): void {
    this.location.back();
  }
}
