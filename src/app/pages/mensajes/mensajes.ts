import { ChangeDetectionStrategy, Component, inject, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { MensajesService, Conversacion } from '../../core/services/mensajes.service';
import { InventarioService, UsuarioBusqueda } from '../../core/services/inventario.service';
import { ToastService } from '../../core/services/toast.service';
import { formatFechaHumana } from '../../core/util/fecha';

/** AJ5 — bandeja de conversaciones (mismo modelo que la web). Realtime + badges. */
@Component({
  selector: 'app-mensajes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState],
  templateUrl: './mensajes.html',
  styleUrl: './mensajes.scss',
})
export class MensajesPage implements OnDestroy {
  private mensajes = inject(MensajesService);
  private inventario = inject(InventarioService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);

  fmt = formatFechaHumana;

  loading = signal(true);
  conversaciones = signal<Conversacion[]>([]);

  // Nueva conversación (búsqueda de usuario).
  nuevaAbierta = signal(false);
  busqueda = signal('');
  resultados = signal<UsuarioBusqueda[]>([]);
  buscando = signal(false);

  // QA-20: canal propio de esta vista; se cierra en ngOnDestroy.
  private unsub: (() => void) | null = null;

  constructor() {
    void this.cargar();
    this.unsub = this.mensajes.suscribir(() => void this.cargar());
  }

  ngOnDestroy(): void {
    this.unsub?.();
  }

  private async cargar(): Promise<void> {
    try {
      this.conversaciones.set(await this.mensajes.listarConversaciones());
    } catch {
      this.toast.error('No pudimos cargar tus mensajes.');
    } finally {
      this.loading.set(false);
    }
  }

  abrir(c: Conversacion): void {
    void this.router.navigate(['/mensajes', c.id]);
  }

  nombreDe(c: Conversacion): string {
    return c.nombre || 'Conversación';
  }

  // ── Nueva conversación ──────────────────────────────────────────────────────
  toggleNueva(): void {
    this.nuevaAbierta.update((v) => !v);
    this.busqueda.set('');
    this.resultados.set([]);
  }

  async buscar(): Promise<void> {
    const term = this.busqueda().trim();
    if (term.length < 2) {
      this.resultados.set([]);
      return;
    }
    this.buscando.set(true);
    try {
      this.resultados.set(await this.inventario.buscarUsuarios(term));
    } catch {
      /* best-effort */
    } finally {
      this.buscando.set(false);
    }
  }

  async iniciarCon(u: UsuarioBusqueda): Promise<void> {
    try {
      const id = await this.mensajes.crearConversacionDirecta(u.id);
      this.nuevaAbierta.set(false);
      void this.router.navigate(['/mensajes', id]);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo iniciar la conversación.');
    }
  }

  back(): void {
    this.location.back();
  }
}
