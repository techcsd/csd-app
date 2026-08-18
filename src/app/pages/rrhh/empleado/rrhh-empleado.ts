import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, Location } from '@angular/common';
import { CedulaPipe } from '../../../shared/pipes/cedula-pipe';
import { ActivatedRoute } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { AudioNotasService } from '../../../core/services/audio-notas.service';
import { RrhhService, Empleado, Asignacion, AsignacionEstado, AsignacionItemTipo } from '../../../core/services/rrhh.service';
import { ToastService } from '../../../core/services/toast.service';

/** AH16 — ficha del empleado + asignaciones de items (AF33): registrar / devolver. */
@Component({
  selector: 'app-rrhh-empleado',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, Skeleton, SyncBar, PhotoSlot, ConfirmDialog, CedulaPipe],
  templateUrl: './rrhh-empleado.html',
  styleUrl: './rrhh-empleado.scss',
})
export class RrhhEmpleadoPage {
  private rrhh = inject(RrhhService);
  private audio = inject(AudioNotasService);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private toast = inject(ToastService);

  loading = signal(true);
  empleado = signal<Empleado | null>(null);
  asignaciones = signal<Asignacion[]>([]);
  urls = signal<Record<string, string>>({});

  // Registrar asignación
  registrando = signal(false);
  itemNombre = signal('');
  categoria = signal('');
  itemTipo = signal<AsignacionItemTipo>('libre');
  notas = signal('');
  foto = signal<CapturedPhoto | null>(null);
  guardando = signal(false);

  // Cambiar estado (devolver / perdido / dañado)
  cambio = signal<{ asig: Asignacion; estado: AsignacionEstado } | null>(null);

  constructor() {
    void this.cargar();
  }

  private async cargar(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    try {
      const [emp, asig] = await Promise.all([this.rrhh.empleado(id), this.rrhh.asignacionesDe(id)]);
      this.empleado.set(emp);
      this.asignaciones.set(asig);
      void this.resolverFotos(asig);
    } finally {
      this.loading.set(false);
    }
  }

  private async resolverFotos(asig: Asignacion[]): Promise<void> {
    await Promise.all(
      asig
        .filter((a) => a.foto_path)
        .map(async (a) => {
          const u = await this.audio.signedUrl('sgc-rrhh', a.foto_path!);
          if (u) this.urls.update((m) => ({ ...m, [a.foto_path!]: u }));
        }),
    );
  }

  url(path: string | null): string | null {
    return path ? (this.urls()[path] ?? null) : null;
  }

  nombreCompleto(): string {
    const e = this.empleado();
    return e ? [e.nombre, e.apellido].filter(Boolean).join(' ') : '';
  }
  estadoLabel(s: AsignacionEstado): string {
    switch (s) {
      case 'asignado': return 'Asignado';
      case 'devuelto': return 'Devuelto';
      case 'perdido': return 'Perdido';
      case 'dañado': return 'Dañado';
    }
  }

  // ── Registrar asignación ────────────────────────────────────────────────
  abrirRegistrar(): void {
    this.itemNombre.set('');
    this.categoria.set('');
    this.itemTipo.set('libre');
    this.notas.set('');
    this.foto.set(null);
    this.registrando.set(true);
  }
  cerrarRegistrar(): void {
    this.registrando.set(false);
  }
  async registrar(): Promise<void> {
    const emp = this.empleado();
    if (!emp || this.guardando()) return;
    if (!this.itemNombre().trim()) {
      this.toast.error('Escribe qué le asignas.');
      return;
    }
    this.guardando.set(true);
    try {
      await this.rrhh.enqueueAsignar({
        empleadoId: emp.id,
        itemNombre: this.itemNombre().trim(),
        itemTipo: this.itemTipo(),
        categoria: this.categoria().trim() || null,
        notas: this.notas().trim() || null,
        foto: this.foto()?.blob ?? null,
      });
      // Optimista: aparece en la lista como asignado.
      this.asignaciones.update((l) => [
        {
          id: crypto.randomUUID(),
          empleado_id: emp.id,
          item_tipo: this.itemTipo(),
          item_id: null,
          item_nombre: this.itemNombre().trim(),
          categoria: this.categoria().trim() || null,
          foto_path: null,
          estado: 'asignado' as AsignacionEstado,
          asignado_en: new Date().toISOString(),
          devuelto_en: null,
          notas: this.notas().trim() || null,
        },
        ...l,
      ]);
      this.registrando.set(false);
      this.toast.success('Asignación registrada.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo registrar la asignación.');
    } finally {
      this.guardando.set(false);
    }
  }

  // ── Cambiar estado ──────────────────────────────────────────────────────
  pedirCambio(asig: Asignacion, estado: AsignacionEstado): void {
    this.cambio.set({ asig, estado });
  }
  async confirmarCambio(): Promise<void> {
    const c = this.cambio();
    this.cambio.set(null);
    if (!c) return;
    try {
      await this.rrhh.enqueueCambiarEstado(c.asig.id, c.estado, null);
      this.asignaciones.update((l) =>
        l.map((a) => (a.id === c.asig.id ? { ...a, estado: c.estado, devuelto_en: c.estado === 'devuelto' ? new Date().toISOString() : a.devuelto_en } : a)),
      );
      this.toast.success('Estado actualizado.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo actualizar.');
    }
  }
  cancelarCambio(): void {
    this.cambio.set(null);
  }
  cambioTitulo(): string {
    const c = this.cambio();
    if (!c) return '';
    return c.estado === 'devuelto' ? '¿Marcar como devuelto?' : `¿Marcar como ${this.estadoLabel(c.estado).toLowerCase()}?`;
  }

  back(): void {
    this.location.back();
  }
}
