import { ChangeDetectionStrategy, Component, ElementRef, inject, OnDestroy, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { MensajesService, Mensaje } from '../../../core/services/mensajes.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatFechaHumana } from '../../../core/util/fecha';

/** AJ5 — hilo de una conversación: mensajes + envío (offline por outbox) + realtime. */
@Component({
  selector: 'app-mensajes-thread',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton],
  templateUrl: './thread.html',
  styleUrl: './thread.scss',
})
export class MensajesThreadPage implements OnDestroy {
  private mensajes = inject(MensajesService);
  private route = inject(ActivatedRoute);
  private ctx = inject(UserContextService);
  private net = inject(NetworkService);
  private toast = inject(ToastService);
  private location = inject(Location);

  private scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');

  fmt = formatFechaHumana;
  private yo(): string | null {
    return this.ctx.profile()?.id ?? null;
  }

  conversacionId = '';
  loading = signal(true);
  lista = signal<Mensaje[]>([]);
  texto = signal('');
  enviando = signal(false);

  constructor() {
    this.conversacionId = this.route.snapshot.paramMap.get('id') ?? '';
    void this.cargar();
    void this.mensajes.marcarLeida(this.conversacionId);
    this.mensajes.suscribir(() => void this.cargar(true));
  }

  ngOnDestroy(): void {
    this.mensajes.desuscribir();
  }

  private async cargar(silencioso = false): Promise<void> {
    if (!silencioso) this.loading.set(true);
    try {
      this.lista.set(await this.mensajes.listarMensajes(this.conversacionId));
      this.scrollAlFinal();
    } catch {
      if (!silencioso) this.toast.error('No pudimos cargar el hilo.');
    } finally {
      this.loading.set(false);
    }
  }

  esMio(m: Mensaje): boolean {
    return m.autor_id === this.yo();
  }

  get online(): boolean {
    return this.net.online();
  }

  async enviar(): Promise<void> {
    const t = this.texto().trim();
    if (!t || this.enviando()) return;
    this.enviando.set(true);
    // Optimista: pinta el mensaje al instante; el realtime/recarga lo reconcilia.
    this.lista.update((l) => [
      ...l,
      {
        id: 'tmp-' + Date.now(),
        autor_id: this.yo() ?? '',
        autor_nombre: 'Tú',
        contenido: t,
        archivo_path: null,
        archivo_nombre: null,
        archivo_mime: null,
        created_at: new Date().toISOString(),
      },
    ]);
    this.texto.set('');
    this.scrollAlFinal();
    try {
      await this.mensajes.enviarMensaje(this.conversacionId, t);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo enviar.');
    } finally {
      this.enviando.set(false);
    }
  }

  private scrollAlFinal(): void {
    requestAnimationFrame(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  back(): void {
    this.location.back();
  }
}
