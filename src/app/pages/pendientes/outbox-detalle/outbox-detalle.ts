import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { SyncService } from '../../../core/sync/sync.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { OutboxOp } from '../../../core/db/app-db';
import {
  OutboxContenidoService,
  OutboxContenido,
} from '../../../core/services/outbox-contenido.service';
import {
  outboxCategoria,
  categoriaPill,
  MENSAJE_SISTEMA,
  AVISO_PERDIDA_SISTEMA,
  OutboxCategoria,
} from '../../../core/util/outbox-categoria';
import { formatFechaRelativa } from '../../../core/util/fecha';

/**
 * BG3 — vista de SOLO-LECTURA del contenido completo de un pendiente atascado:
 * todos los campos, actividades/renglones y las fotos (siguen en el teléfono).
 * Desde aquí el usuario puede DUPLICAR a una bitácora nueva (sin re-teclear),
 * COMPARTIR el contenido (último recurso: WhatsApp), REINTENTAR, y —solo aquí,
 * nunca en la tarjeta— DESCARTAR (con doble confirmación y aviso de pérdida).
 */
@Component({
  selector: 'app-outbox-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, ConfirmDialog],
  templateUrl: './outbox-detalle.html',
  styleUrl: './outbox-detalle.scss',
})
export class OutboxDetallePage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private sync = inject(SyncService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private contenidoSvc = inject(OutboxContenidoService);

  private id = this.route.snapshot.paramMap.get('id') ?? '';

  op = signal<OutboxOp | null>(null);
  contenido = signal<OutboxContenido | null>(null);
  loading = signal(true);
  online = this.network.online;
  fmt = formatFechaRelativa;

  fotoAbierta = signal<string | null>(null);
  exportando = signal(false);
  duplicando = signal(false);

  // Descarte: doble confirmación para 'sistema' (paso 1 → paso 2), simple para 'dato'.
  descartarPaso = signal<0 | 1 | 2>(0);

  readonly AVISO_PERDIDA = AVISO_PERDIDA_SISTEMA;

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const op = await this.sync.getOp(this.id);
      this.op.set(op);
      if (op) this.contenido.set(await this.contenidoSvc.contenido(op));
    } finally {
      this.loading.set(false);
    }
  }

  categoria(): OutboxCategoria | null {
    const o = this.op();
    return o ? outboxCategoria(o) : null;
  }
  esSistema(): boolean {
    return this.categoria() === 'sistema';
  }
  pill() {
    const c = this.categoria();
    return c ? categoriaPill(c) : null;
  }
  mensaje(): string {
    if (this.esSistema()) return MENSAJE_SISTEMA;
    return this.op()?.error_msg ?? '';
  }
  enError(): boolean {
    return this.op()?.estado === 'error';
  }
  puedeDuplicar(): boolean {
    const o = this.op();
    return !!o && this.contenidoSvc.puedeDuplicar(o);
  }

  // ── Acciones ─────────────────────────────────────────────────────────────

  reintentar(): void {
    void this.sync.retry(this.id);
    this.toast.show('Reintentando el envío…', 'info');
    this.back();
  }

  async duplicar(): Promise<void> {
    const o = this.op();
    if (!o || this.duplicando()) return;
    this.duplicando.set(true);
    try {
      const ruta = await this.contenidoSvc.duplicarBitacora(o);
      this.toast.success('Copiamos tu bitácora a un borrador nuevo. Revísala y envíala.');
      const [path, query] = ruta.split('?');
      const borrador = new URLSearchParams(query).get('borrador') ?? undefined;
      void this.router.navigate([path], borrador ? { queryParams: { borrador } } : undefined);
    } catch {
      this.toast.error('No se pudo duplicar. Intenta exportar el contenido.');
    } finally {
      this.duplicando.set(false);
    }
  }

  async exportar(): Promise<void> {
    const o = this.op();
    if (!o || this.exportando()) return;
    this.exportando.set(true);
    try {
      const r = await this.contenidoSvc.exportar(o);
      if (r.fallback) this.toast.show('Se descargó el archivo (no había app para compartir).', 'info');
    } catch {
      this.toast.error('No se pudo exportar el contenido.');
    } finally {
      this.exportando.set(false);
    }
  }

  // ── Descarte con doble confirmación (data real de obra) ────────────────────

  pedirDescartar(): void {
    this.descartarPaso.set(1);
  }
  siguienteDescarte(): void {
    // 'sistema' exige un segundo "estás seguro"; 'dato'/otros van directo.
    if (this.esSistema() && this.descartarPaso() === 1) {
      this.descartarPaso.set(2);
      return;
    }
    this.confirmarDescarte();
  }
  cancelarDescarte(): void {
    this.descartarPaso.set(0);
  }
  private confirmarDescarte(): void {
    void this.sync.discard(this.id);
    this.descartarPaso.set(0);
    this.toast.show('Registro descartado.', 'info');
    this.back();
  }

  // ── Fotos ──────────────────────────────────────────────────────────────────

  abrirFoto(url: string): void {
    this.fotoAbierta.set(url);
  }
  cerrarFoto(): void {
    this.fotoAbierta.set(null);
  }

  back(): void {
    this.location.back();
  }
}
