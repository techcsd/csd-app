import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { VehiculoCard } from '../../../shared/ui/vehiculo-card/vehiculo-card';
import { DocSlot } from '../../../shared/ui/doc-slot/doc-slot';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { ConductoresService } from '../../../core/services/conductores.service';
import { DocumentosService } from '../../../core/services/documentos.service';
import { ReporteSemanalService } from '../../../core/services/reporte-semanal.service';
import { SyncService } from '../../../core/sync/sync.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { CapturedDoc } from '../../../core/services/camera.service';
import { VehiculoDisponible } from '../../../core/models/transporte.model';

type TipoAutorizado = 'Liviano' | 'Pesado' | 'Ambos';

/**
 * Auto-asignación de vehículo (R1/R2). El usuario elige un vehículo disponible;
 * si aún no tiene perfil de conductor se auto-registra sin fricción (R2), y el
 * flujo encadena directo al reporte de recibimiento existente. La asignación
 * corre online (lista en vivo + RPC idempotente); el recibimiento es offline.
 */
@Component({
  selector: 'app-asignar-vehiculo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, StepBar, OptionButton, EmptyState, Skeleton, VehiculoCard, DocSlot],
  templateUrl: './asignar.html',
  styleUrl: './asignar.scss',
})
export class AsignarVehiculoPage {
  private vehiculos = inject(VehiculosService);
  private conductores = inject(ConductoresService);
  private documentos = inject(DocumentosService);
  private reportes = inject(ReporteSemanalService);
  private sync = inject(SyncService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);

  readonly tiposAutorizado: TipoAutorizado[] = ['Liviano', 'Pesado', 'Ambos'];

  loading = signal(true);
  disponibles = signal<VehiculoDisponible[]>([]);
  seleccionado = signal<VehiculoDisponible | null>(null);
  // U12 — vehículos ya asignados a mí + su estado de reporte semanal.
  misAsignados = signal<Set<string>>(new Set());
  reportados = signal<Set<string>>(new Set());
  /** U6 — vehiculo_id → URL firmada de su foto (thumbnail del pool). */
  fotoUrls = signal<Record<string, string>>({});

  /** Whether the user still needs a driver profile (resolved on load). */
  necesitaConductor = signal(false);

  step = signal(1);
  submitting = signal(false);

  // Auto-registro de conductor (paso 2).
  cedula = signal('');
  licenciaTipo = signal('');
  licenciaNumero = signal('');
  licenciaVencimiento = signal('');
  tipoAutorizado = signal<TipoAutorizado>('Ambos');

  // X1 — documentos del conductor (solicitados, NO bloqueantes).
  docCedula = signal<CapturedDoc | null>(null);
  docLicencia = signal<CapturedDoc | null>(null);

  readonly total = computed(() => (this.necesitaConductor() ? 2 : 1));

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [disp, cond, asignaciones, semana, pendReportes] = await Promise.all([
        this.vehiculos.getVehiculosDisponibles(),
        this.conductores.getMiConductor(),
        this.vehiculos.getMisAsignaciones().catch(() => []),
        this.reportes.getSemana().catch(() => []),
        this.sync.reportesSemanalesPendientes().catch(() => new Map<string, string>()),
      ]);
      this.disponibles.set(disp);
      this.necesitaConductor.set(!cond);
      // U12 — set de vehículos ya asignados a mí.
      this.misAsignados.set(new Set(asignaciones.map((a) => a.vehiculo_id)));
      // U12 — reportados esta semana (servidor + ops en cola).
      const rep = new Set<string>();
      for (const s of semana) if (s.tiene_reporte) rep.add(s.vehiculo_id);
      for (const id of pendReportes.keys()) rep.add(id);
      this.reportados.set(rep);
      void this.resolveFotos(disp);
    } finally {
      this.loading.set(false);
    }
  }

  /** U12 — ¿este vehículo ya está asignado a mí? */
  yaAsignado(id: string): boolean {
    return this.misAsignados().has(id);
  }
  /** U12 — ¿ya tiene el reporte semanal de esta semana (o en cola)? */
  yaReportado(id: string): boolean {
    return this.reportados().has(id);
  }
  irSemanal(): void {
    void this.router.navigate(['/transporte/reporte-semanal']);
  }
  irPreuso(id: string): void {
    void this.router.navigate(['/transporte/preuso', id]);
  }

  /** U6 — resuelve las fotos del pool a URLs firmadas (mejor esfuerzo, online). */
  private async resolveFotos(disp: VehiculoDisponible[]): Promise<void> {
    await Promise.all(
      disp
        .filter((v) => v.foto_path)
        .map(async (v) => {
          const url = await this.vehiculos.getFotoUrl(v.foto_path);
          if (url) this.fotoUrls.update((m) => ({ ...m, [v.vehiculo_id]: url }));
        }),
    );
  }

  seleccionar(v: VehiculoDisponible): void {
    if (this.yaAsignado(v.vehiculo_id)) return; // U12 — no re-asignar el propio
    this.seleccionado.set(v);
  }

  continuar(): void {
    if (!this.seleccionado()) {
      this.toast.error('Elige un vehículo primero.');
      return;
    }
    if (!this.online) {
      this.toast.error('Necesitas conexión para asignarte un vehículo.');
      return;
    }
    if (this.necesitaConductor()) {
      this.step.set(2);
    } else {
      void this.asignar();
    }
  }

  prev(): void {
    this.step.set(1);
  }

  back(): void {
    this.location.back();
  }

  private validarConductor(): boolean {
    if (!this.cedula().trim()) {
      this.toast.error('Escribe tu cédula.');
      return false;
    }
    if (!this.licenciaTipo().trim()) {
      this.toast.error('Escribe el tipo/categoría de licencia.');
      return false;
    }
    return true;
  }

  async registrarYAsignar(): Promise<void> {
    if (this.submitting()) return;
    if (!this.validarConductor()) return;
    if (!this.online) {
      this.toast.error('Necesitas conexión para registrarte.');
      return;
    }
    this.submitting.set(true);
    try {
      const res = await this.conductores.autoRegistrar({
        cedula: this.cedula(),
        licenciaTipo: this.licenciaTipo(),
        licenciaNumero: this.licenciaNumero(),
        licenciaVencimiento: this.licenciaVencimiento(),
        tipoVehiculoAutorizado: this.tipoAutorizado(),
      });
      // X1 — encola los documentos capturados (offline-safe) al conductor recién
      // creado. No bloquea: si faltan, el perfil mostrará "documentos pendientes".
      await this.encolarDocumentos(res.conductor_id);
      if (res.licencia_vencida) {
        this.toast.error('Tu licencia está vencida: podrás recibir el vehículo, pero el pre-uso quedará bloqueado hasta renovarla.');
      }
      await this.asignar();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo registrar. Intenta de nuevo.');
      this.submitting.set(false);
    }
  }

  /** X1 — encola cédula/licencia si el conductor las capturó (best-effort). */
  private async encolarDocumentos(conductorId: string): Promise<void> {
    const ced = this.docCedula();
    const lic = this.docLicencia();
    if (ced) {
      await this.documentos.enqueueDocumento({ entidad: 'conductor', entidadId: conductorId, tipo: 'cedula', doc: ced });
    }
    if (lic) {
      await this.documentos.enqueueDocumento({ entidad: 'conductor', entidadId: conductorId, tipo: 'licencia', doc: lic });
    }
  }

  private async asignar(): Promise<void> {
    const veh = this.seleccionado();
    if (!veh) return;
    this.submitting.set(true);
    try {
      const res = await this.vehiculos.asignarme(veh.vehiculo_id);
      this.toast.success(`Te asignaste ${res.placa}. Ahora completa el recibimiento.`);
      void this.router.navigate(['/transporte/recibir', res.vehiculo_id], { replaceUrl: true });
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo asignar el vehículo.');
      this.submitting.set(false);
    }
  }

  get online(): boolean {
    return this.network.online();
  }
}
