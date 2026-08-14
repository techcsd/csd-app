import { ChangeDetectionStrategy, Component, ElementRef, inject, OnDestroy, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { MensajesService, Mensaje } from '../../../core/services/mensajes.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { CameraService } from '../../../core/services/camera.service';
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
  private router = inject(Router);
  private ctx = inject(UserContextService);
  private net = inject(NetworkService);
  private toast = inject(ToastService);
  private location = inject(Location);
  private camera = inject(CameraService);

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

  // AQ9 — adjuntos: menú tipo WhatsApp, URLs firmadas por path, lightbox.
  menuAdjuntar = signal(false);
  adjuntando = signal(false);
  private urlsAdjuntos = signal<Record<string, string>>({});
  private tempUrls: string[] = [];
  lightboxUrl = signal<string | null>(null);

  // AN6 — meta de la conversación para el header (grupo → tappable + avatar).
  titulo = signal('Conversación');
  esGrupo = signal(false);
  avatarUrl = signal<string | null>(null);
  subtitulo = signal('');

  // QA-20: canal propio del hilo (filtrado por conversación); se cierra en ngOnDestroy.
  private unsub: (() => void) | null = null;

  constructor() {
    this.conversacionId = this.route.snapshot.paramMap.get('id') ?? '';
    void this.cargar();
    void this.cargarMeta();
    void this.mensajes.marcarLeida(this.conversacionId);
    // QA-20: filtra server-side por esta conversación (antes escuchaba TODO).
    this.unsub = this.mensajes.suscribir(() => void this.cargar(true), this.conversacionId);
  }

  /** AN6 — resuelve el título/avatar del header y si es grupo (para abrir su info). */
  private async cargarMeta(): Promise<void> {
    try {
      const conv = (await this.mensajes.listarConversaciones()).find((c) => c.id === this.conversacionId);
      if (conv) {
        this.titulo.set(conv.nombre || 'Conversación');
        this.esGrupo.set(conv.tipo === 'grupo');
      }
      if (this.esGrupo()) {
        const info = await this.mensajes.grupoInfo(this.conversacionId);
        this.titulo.set(info.nombre || 'Grupo');
        this.subtitulo.set(`${info.participantes.length} participante${info.participantes.length === 1 ? '' : 's'}`);
        this.avatarUrl.set(await this.mensajes.avatarUrl(info.avatar_path));
      }
    } catch {
      /* header cae a genérico; el hilo funciona igual */
    }
  }

  /** AN6 — abre la info del grupo (solo grupos). */
  abrirInfo(): void {
    if (!this.esGrupo()) return;
    void this.router.navigate(['/mensajes', this.conversacionId, 'info']);
  }

  esSistema(m: Mensaje): boolean {
    return m.tipo === 'sistema';
  }

  ngOnDestroy(): void {
    this.unsub?.();
    this.tempUrls.forEach((u) => URL.revokeObjectURL(u));
    this.tempUrls = [];
  }

  private async cargar(silencioso = false): Promise<void> {
    if (!silencioso) this.loading.set(true);
    try {
      const msgs = await this.mensajes.listarMensajes(this.conversacionId);
      // Al recargar del server, los bubbles optimistas (blob: URL) se descartan.
      this.tempUrls.forEach((u) => URL.revokeObjectURL(u));
      this.tempUrls = [];
      this.lista.set(msgs);
      void this.resolverAdjuntos(msgs);
      this.scrollAlFinal();
    } catch {
      if (!silencioso) this.toast.error('No pudimos cargar el hilo.');
    } finally {
      this.loading.set(false);
    }
  }

  /** AQ9 — resuelve las URLs firmadas de las imágenes del hilo (best-effort). */
  private async resolverAdjuntos(msgs: Mensaje[]): Promise<void> {
    const faltan = msgs.filter(
      (m) => m.archivo_path && this.esImagenMime(m.archivo_mime) && !this.urlsAdjuntos()[m.archivo_path],
    );
    for (const m of faltan) {
      const url = await this.mensajes.adjuntoUrl(m.archivo_path);
      if (url) this.urlsAdjuntos.update((u) => ({ ...u, [m.archivo_path as string]: url }));
    }
    this.scrollAlFinal();
  }

  private esImagenMime(mime: string | null | undefined): boolean {
    return !!mime && mime.startsWith('image/');
  }

  esImagen(m: Mensaje): boolean {
    return !!m.archivo_path && this.esImagenMime(m.archivo_mime);
  }
  esArchivo(m: Mensaje): boolean {
    return !!m.archivo_path && !this.esImagenMime(m.archivo_mime);
  }
  urlAdjunto(m: Mensaje): string | null {
    return (m.archivo_path && this.urlsAdjuntos()[m.archivo_path]) || null;
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

  // ── AQ9 — Adjuntos (imágenes y archivos, tipo WhatsApp) ─────────────────────
  toggleMenuAdjuntar(): void {
    this.menuAdjuntar.update((v) => !v);
  }

  async adjuntarCamara(): Promise<void> {
    this.menuAdjuntar.set(false);
    const foto = await this.camera.takePhoto();
    if (foto) await this.enviarAdjunto({ blob: foto.blob, nombre: `foto-${Date.now()}.jpg`, mime: 'image/jpeg' }, foto.previewUrl);
  }

  async adjuntarGaleria(): Promise<void> {
    this.menuAdjuntar.set(false);
    const fotos = await this.camera.pickFromGallery(1);
    const foto = fotos[0];
    if (foto) await this.enviarAdjunto({ blob: foto.blob, nombre: `foto-${Date.now()}.jpg`, mime: 'image/jpeg' }, foto.previewUrl);
  }

  async adjuntarArchivo(): Promise<void> {
    this.menuAdjuntar.set(false);
    const f = await this.camera.pickAttachment();
    if (f) await this.enviarAdjunto({ blob: f.blob, nombre: f.nombre, mime: f.mime }, f.previewUrl ?? undefined);
  }

  /** Encola el adjunto y pinta un bubble optimista con la vista previa local. */
  private async enviarAdjunto(
    file: { blob: Blob; nombre: string; mime: string },
    previewUrl?: string,
  ): Promise<void> {
    if (this.adjuntando()) return;
    this.adjuntando.set(true);
    const tmpKey = 'tmp-adj-' + Date.now();
    const esImg = file.mime.startsWith('image/');
    if (esImg && previewUrl) {
      this.tempUrls.push(previewUrl);
      this.urlsAdjuntos.update((u) => ({ ...u, [tmpKey]: previewUrl }));
    }
    this.lista.update((l) => [
      ...l,
      {
        id: tmpKey,
        autor_id: this.yo() ?? '',
        autor_nombre: 'Tú',
        contenido: null,
        archivo_path: tmpKey,
        archivo_nombre: file.nombre,
        archivo_mime: file.mime,
        created_at: new Date().toISOString(),
      },
    ]);
    this.scrollAlFinal();
    try {
      await this.mensajes.enviarAdjunto(this.conversacionId, file);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo enviar el adjunto.');
    } finally {
      this.adjuntando.set(false);
    }
  }

  /** Abre la imagen en el lightbox. */
  verImagen(m: Mensaje): void {
    const url = this.urlAdjunto(m);
    if (url) this.lightboxUrl.set(url);
  }
  cerrarLightbox(): void {
    this.lightboxUrl.set(null);
  }

  /** Abre/descarga un archivo con el visor del sistema (navegador externo). */
  async abrirArchivo(m: Mensaje): Promise<void> {
    if (!m.archivo_path) return;
    if (m.archivo_path.startsWith('tmp-')) {
      this.toast.error('El archivo aún se está enviando…');
      return;
    }
    const url = await this.mensajes.adjuntoUrl(m.archivo_path);
    if (!url) {
      this.toast.error('No pudimos abrir el archivo.');
      return;
    }
    window.open(url, '_blank');
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
