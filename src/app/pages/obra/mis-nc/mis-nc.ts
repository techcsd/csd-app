import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { ToastService } from '../../../core/services/toast.service';
import { ObraService } from '../../../core/services/obra.service';
import { NcAsignada, NC_TIPO_META, SEVERIDAD_META } from '../../../core/models/obra.model';

/** AG16 FASE 2 — Bandeja "Mis pendientes": NC donde soy responsable + acciones correctivas asignadas. */
@Component({
  selector: 'app-obra-mis-nc',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PhotoSlot, Skeleton, EmptyState],
  templateUrl: './mis-nc.html',
  styleUrl: './mis-nc.scss',
})
export class MisNcPage {
  private obra = inject(ObraService);
  private toast = inject(ToastService);
  private location = inject(Location);

  loading = signal(true);
  items = signal<NcAsignada[]>([]);
  expandido = signal<string | null>(null);
  evidencia = signal<CapturedPhoto | null>(null);
  nota = signal('');
  guardando = signal(false);

  // Asignar acción correctiva (sobre una NC)
  accionAbierta = signal(false);
  accDesc = signal('');
  accFecha = signal('');
  accRespBusqueda = signal('');
  accRespRes = signal<{ id: string; nombre: string }[]>([]);
  accResp = signal<{ id: string; nombre: string } | null>(null);

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    try {
      this.items.set(await this.obra.misNcAsignadas());
    } finally {
      this.loading.set(false);
    }
  }

  tipoLabel(t: string | null): string {
    return t ? (NC_TIPO_META[t as keyof typeof NC_TIPO_META]?.label ?? t) : '';
  }
  sevTint(s: string | null): string {
    return s ? (SEVERIDAD_META[s as keyof typeof SEVERIDAD_META]?.tint ?? '#6b7280') : '#6b7280';
  }

  toggle(it: NcAsignada): void {
    const key = it.clase + ':' + it.id;
    this.expandido.set(this.expandido() === key ? null : key);
    this.evidencia.set(null);
    this.nota.set('');
    this.cerrarAccion();
  }

  // ── Asignar acción correctiva ────────────────────────────────────────────────
  cerrarAccion(): void {
    this.accionAbierta.set(false);
    this.accDesc.set('');
    this.accFecha.set('');
    this.accResp.set(null);
    this.accRespBusqueda.set('');
    this.accRespRes.set([]);
  }
  async buscarAccResp(): Promise<void> {
    const term = this.accRespBusqueda().trim();
    if (term.length < 2) {
      this.accRespRes.set([]);
      return;
    }
    this.accRespRes.set(await this.obra.buscarUsuarios(term));
  }
  pickAccResp(u: { id: string; nombre: string }): void {
    this.accResp.set(u);
    this.accRespRes.set([]);
    this.accRespBusqueda.set('');
  }

  async asignarAccion(it: NcAsignada): Promise<void> {
    if (this.guardando() || !this.accDesc().trim()) return;
    this.guardando.set(true);
    try {
      await this.obra.asignarAccionCorrectiva({
        proyectoId: it.proyecto_id,
        origenTipo: 'nc',
        origenId: it.id,
        descripcion: this.accDesc().trim(),
        responsableId: this.accResp()?.id ?? null,
        fechaCompromiso: this.accFecha() || null,
      });
      this.toast.success('Acción correctiva asignada.');
      this.cerrarAccion();
      await this.cargar();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo asignar la acción.');
    } finally {
      this.guardando.set(false);
    }
  }
  esExpandido(it: NcAsignada): boolean {
    return this.expandido() === it.clase + ':' + it.id;
  }

  onFoto(p: CapturedPhoto): void {
    this.evidencia.set(p);
  }
  onFotoCleared(): void {
    this.evidencia.set(null);
  }

  /** Acción correctiva → marcar hecha (con evidencia opcional). */
  async marcarHecha(it: NcAsignada): Promise<void> {
    if (this.guardando()) return;
    this.guardando.set(true);
    try {
      const foto = this.evidencia()?.blob;
      await this.obra.enqueueAccionHecha(it.id, foto ? [foto] : []);
      this.toast.success('Acción marcada como hecha.');
      await this.trasAccion(it);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.guardando.set(false);
    }
  }

  /** NC → verificar y cerrar (con nota opcional). */
  async verificarNc(it: NcAsignada): Promise<void> {
    if (this.guardando()) return;
    this.guardando.set(true);
    try {
      await this.obra.enqueueVerificarNc(it.id, this.nota().trim() || null);
      this.toast.success('No conformidad verificada.');
      await this.trasAccion(it);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo verificar.');
    } finally {
      this.guardando.set(false);
    }
  }

  private async trasAccion(it: NcAsignada): Promise<void> {
    // Optimista: quita el ítem de la lista y colapsa.
    this.items.update((list) => list.filter((x) => !(x.clase === it.clase && x.id === it.id)));
    this.expandido.set(null);
    this.evidencia.set(null);
    this.nota.set('');
  }

  back(): void {
    this.location.back();
  }
}
