import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MantenimientosService } from '../../../core/services/mantenimientos.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { KmInput } from '../../../shared/ui/km-input/km-input';

const MAX_FOTOS = 2;

/**
 * AG9 — cierre de un mantenimiento desde la app: costo, taller/proveedor, notas y
 * evidencia (factura/foto). Se encola en el outbox → completar_mantenimiento_app.
 */
@Component({
  selector: 'app-mantenimiento-cierre',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PhotoSlot, KmInput],
  templateUrl: './mantenimiento-cierre.html',
  styleUrl: './mantenimiento-cierre.scss',
})
export class MantenimientoCierrePage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private mantenimientos = inject(MantenimientosService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);

  readonly slots = Array.from({ length: MAX_FOTOS }, (_, i) => i);

  vehiculoId = '';
  mantenimientoId = '';
  km = signal<number | null>(null);
  costo = signal<number | null>(null);
  proveedor = signal('');
  notas = signal('');
  fotos = signal<Record<number, CapturedPhoto>>({});
  guardando = signal(false);

  constructor() {
    this.vehiculoId = this.route.snapshot.paramMap.get('vehiculoId') ?? '';
    this.mantenimientoId = this.route.snapshot.paramMap.get('id') ?? '';
  }

  onFoto(idx: number, photo: CapturedPhoto): void {
    this.fotos.update((f) => ({ ...f, [idx]: photo }));
  }
  onFotoCleared(idx: number): void {
    this.fotos.update((f) => {
      const next = { ...f };
      delete next[idx];
      return next;
    });
  }

  back(): void {
    void this.router.navigate(['/transporte/mantenimientos', this.vehiculoId]);
  }

  async confirmar(): Promise<void> {
    if (this.guardando()) return;
    this.guardando.set(true);
    try {
      const fotosMap = this.fotos();
      const fotos = this.slots.map((i) => fotosMap[i]?.blob).filter((b): b is Blob => !!b);
      await this.mantenimientos.enqueueCierre({
        id: this.mantenimientoId,
        vehiculoId: this.vehiculoId,
        km: this.km(),
        costo: this.costo(),
        proveedor: this.proveedor().trim() || null,
        notas: this.notas().trim() || null,
        fotos,
        placa: '',
      });
      this.toast.success(
        this.network.online()
          ? 'Mantenimiento cerrado.'
          : 'Guardado. Se cerrará cuando tengas señal.',
      );
      this.back();
    } catch {
      this.toast.error('No se pudo cerrar el mantenimiento. Intenta de nuevo.');
    } finally {
      this.guardando.set(false);
    }
  }
}
