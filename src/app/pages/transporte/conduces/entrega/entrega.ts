import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { PhotoSlot } from '../../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../../shared/ui/option-button/option-button';
import { Skeleton } from '../../../../shared/ui/skeleton/skeleton';
import { CapturedPhoto } from '../../../../core/services/camera.service';
import { ConducesService } from '../../../../core/services/conduces.service';
import { NetworkService } from '../../../../core/services/network.service';
import { ToastService } from '../../../../core/services/toast.service';
import { Conduce } from '../../../../core/models/transporte.model';

/**
 * AJ8 — el CHOFER avanza el estado de su conduce: Iniciar tránsito → Estoy
 * entregando → Marcar entregado (foto de entrega OBLIGATORIA, sin firma del
 * receptor). Al marcar entregado, el receptor recibe un aviso y confirma la
 * recepción DESDE SU PROPIO teléfono (checklist/foto/firma) — así se evita la
 * suplantación. Todo por outbox (offline-safe).
 */
@Component({
  selector: 'app-conduce-entrega',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PhotoSlot, OptionButton, Skeleton],
  templateUrl: './entrega.html',
  styleUrl: './entrega.scss',
})
export class ConduceEntregaPage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private service = inject(ConducesService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);

  conduce = signal<Conduce | null>(null);
  fase = signal<string>('emitido');
  loading = signal(true);
  submitting = signal(false);
  done = signal(false);

  // Panel "marcar entregado".
  mostrarEntrega = signal(false);
  foto = signal<CapturedPhoto | null>(null);
  llegoTodo = signal<boolean | null>(null);
  cantidades = signal<Record<string, number>>({});
  notas = signal('');

  // Fases ya alcanzadas (para deshabilitar los botones anteriores).
  private readonly orden = ['emitido', 'en_transito', 'entregando', 'entregado', 'confirmado'];
  private faseIdx = computed(() => Math.max(0, this.orden.indexOf(this.fase())));
  puedeIniciarTransito = computed(() => this.faseIdx() < this.orden.indexOf('en_transito'));
  puedeEntregando = computed(() => this.faseIdx() < this.orden.indexOf('entregando'));
  yaEntregado = computed(() => this.faseIdx() >= this.orden.indexOf('entregado'));

  faseLabel = computed(() => FASE_LABEL[this.fase()] ?? this.fase());

  incompleto = computed(() => {
    const c = this.conduce();
    if (!c) return false;
    return c.items.some((it) => (this.cantidades()[it.detalle_id] ?? it.cantidad) < it.cantidad);
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const id = this.route.snapshot.paramMap.get('salidaId');
      const list = await this.service.misConduces();
      const c = list.find((x) => x.id === id) ?? null;
      this.conduce.set(c);
      if (c) {
        const init: Record<string, number> = {};
        for (const it of c.items) init[it.detalle_id] = it.cantidad;
        this.cantidades.set(init);
        try {
          this.fase.set(await this.service.conduceFase(c.id));
        } catch {
          /* offline: asumimos la fase por el estado crudo */
          this.fase.set(c.estado === 'entregado' || c.estado === 'entregado_incompleto' ? 'entregado' : 'emitido');
        }
      }
    } finally {
      this.loading.set(false);
    }
  }

  get online(): boolean {
    return this.network.online();
  }

  // ── Acciones de estado ──────────────────────────────────────────────────────
  async iniciarTransito(): Promise<void> {
    await this.avanzar('en_transito', 'En tránsito. Buen viaje.');
  }
  async estoyEntregando(): Promise<void> {
    await this.avanzar('entregando', 'Marcado como "entregando".');
  }

  private async avanzar(estado: 'en_transito' | 'entregando', ok: string): Promise<void> {
    const c = this.conduce();
    if (!c || this.submitting()) return;
    this.submitting.set(true);
    try {
      await this.service.conduceActualizarEstado(c.id, estado);
      this.fase.set(estado);
      this.toast.success(ok);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo actualizar. Se reintentará.');
    } finally {
      this.submitting.set(false);
    }
  }

  abrirEntrega(): void {
    this.mostrarEntrega.set(true);
  }

  onFoto(photo: CapturedPhoto): void {
    this.foto.set(photo);
  }
  setLlegoTodo(value: boolean): void {
    this.llegoTodo.set(value);
    const c = this.conduce();
    if (value && c) {
      const full: Record<string, number> = {};
      for (const it of c.items) full[it.detalle_id] = it.cantidad;
      this.cantidades.set(full);
    }
  }
  setCantidad(detalleId: string, value: number): void {
    const max = this.conduce()?.items.find((it) => it.detalle_id === detalleId)?.cantidad ?? Infinity;
    this.cantidades.update((m) => ({ ...m, [detalleId]: Math.min(max, Math.max(0, value || 0)) }));
  }

  async marcarEntregado(): Promise<void> {
    if (this.submitting()) return;
    const c = this.conduce();
    if (!c) return;
    if (!this.foto()) {
      this.toast.error('Toma la foto de la entrega.');
      return;
    }
    if (this.llegoTodo() === null) {
      this.toast.error('Dinos si llegó todo el material.');
      return;
    }
    if (this.llegoTodo() === false && !this.incompleto()) {
      this.toast.error('Dijiste que faltó material: baja la cantidad de al menos un artículo.');
      return;
    }
    const items =
      this.llegoTodo() === false
        ? c.items.map((it) => ({ detalle_id: it.detalle_id, cantidad_recibida: this.cantidades()[it.detalle_id] ?? it.cantidad }))
        : null;
    this.submitting.set(true);
    try {
      await this.service.conduceMarcarEntregado(c.id, this.foto()!.blob, items, this.notas().trim() || null);
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar. Intenta de nuevo.');
    } finally {
      this.submitting.set(false);
    }
  }

  finish(): void {
    void this.router.navigate(['/transporte/conduces-pendientes'], { replaceUrl: true });
  }
}

const FASE_LABEL: Record<string, string> = {
  emitido: 'Emitido',
  en_transito: 'En tránsito',
  entregando: 'Entregando',
  entregado: 'Entregado · esperando confirmación',
  confirmado: 'Confirmado',
  pendiente_firma: 'Pendiente de firma',
};
