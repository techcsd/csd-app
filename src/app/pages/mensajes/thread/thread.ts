import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, OnDestroy, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { MensajesService, Mensaje, StickerPack } from '../../../core/services/mensajes.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { CameraService } from '../../../core/services/camera.service';
import { formatHora, etiquetaDiaChat, esOtroDia } from '../../../core/util/fecha';

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

  fmtHora = formatHora;
  private yo(): string | null {
    return this.ctx.profile()?.id ?? null;
  }

  conversacionId = '';
  loading = signal(true);
  lista = signal<Mensaje[]>([]);
  texto = signal('');
  enviando = signal(false);

  // AT14 — no-leídos capturados ANTES de marcar leído (frontera del divisor).
  noLeidosInicial = signal(0);
  private scrollNoLeidoPend = false;

  /** AT14 — id del primer mensaje no leído (los últimos `noLeidosInicial` de otros
   *  autores, no de sistema). null si no hay no-leídos → el hilo abre al final. */
  primerNoLeidoId = computed<string | null>(() => {
    const n = this.noLeidosInicial();
    if (n <= 0) return null;
    const yo = this.yo();
    const otros = this.lista().filter((m) => m.autor_id !== yo && m.tipo !== 'sistema' && !m.id.startsWith('tmp-'));
    if (otros.length === 0) return null;
    return otros[Math.max(0, otros.length - n)].id;
  });

  // AQ9 — adjuntos: menú tipo WhatsApp, URLs firmadas por path, lightbox.
  menuAdjuntar = signal(false);
  adjuntando = signal(false);
  private urlsAdjuntos = signal<Record<string, string>>({});
  private tempUrls: string[] = [];
  lightboxUrl = signal<string | null>(null);

  // AT16 — stickers: picker en el composer (recientes + packs), subir/enviar.
  stickerPickerOpen = signal(false);
  stickerPacks = signal<StickerPack[]>([]);
  stickerRecientes = signal<string[]>([]);
  stickerTab = signal<string>('recientes'); // 'recientes' | id de pack
  stickerLoading = signal(false);
  stickerUploading = signal(false);
  private stickersCargados = false;

  /** Packs ordenados: sistema primero (p.ej. "Básico"), luego por `orden`. */
  stickerPacksOrdenados = computed(() =>
    [...this.stickerPacks()].sort((a, b) => {
      if (a.es_sistema !== b.es_sistema) return a.es_sistema ? -1 : 1;
      return a.orden - b.orden;
    }),
  );

  /** Pack activo (null cuando la pestaña es "recientes"). */
  stickerPackActivo = computed<StickerPack | null>(() => {
    const tab = this.stickerTab();
    if (tab === 'recientes') return null;
    return this.stickerPacks().find((p) => p.id === tab) ?? null;
  });

  // AN6 — meta de la conversación para el header (grupo → tappable + avatar).
  titulo = signal('Conversación');
  esGrupo = signal(false);
  avatarUrl = signal<string | null>(null);
  subtitulo = signal('');

  // QA-20: canal propio del hilo (filtrado por conversación); se cierra en ngOnDestroy.
  private unsub: (() => void) | null = null;

  constructor() {
    this.conversacionId = this.route.snapshot.paramMap.get('id') ?? '';
    void this.init();
    // QA-20: filtra server-side por esta conversación (antes escuchaba TODO).
    this.unsub = this.mensajes.suscribir(() => void this.cargar(true), this.conversacionId);
  }

  /**
   * AT14 — orden: (1) capturar los no-leídos + meta ANTES de marcar leído (para
   * pintar el divisor "Mensajes no leídos"); (2) cargar el hilo y posicionarlo en
   * el primer no-leído; (3) recién ahí marcar la conversación como leída.
   */
  private async init(): Promise<void> {
    await this.cargarMeta();
    this.scrollNoLeidoPend = this.noLeidosInicial() > 0;
    await this.cargar();
    void this.mensajes.marcarLeida(this.conversacionId);
  }

  /** AN6/AT14 — resuelve título/avatar/grupo y captura los no-leídos previos. */
  private async cargarMeta(): Promise<void> {
    try {
      const conv = (await this.mensajes.listarConversaciones()).find((c) => c.id === this.conversacionId);
      if (conv) {
        this.titulo.set(conv.nombre || 'Conversación');
        this.esGrupo.set(conv.tipo === 'grupo');
        this.noLeidosInicial.set(conv.no_leidos ?? 0);
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
      this.posicionar(silencioso);
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
    // No re-posicionamos aquí: forzar el scroll al final rompería el anclaje al
    // primer no-leído (AT14). Las imágenes tienen tamaño acotado (poco reflow).
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
    this.scrollNoLeidoPend = false;
    requestAnimationFrame(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  /**
   * AT14 — posiciona el hilo: en la carga inicial con no-leídos, al divisor
   * "Mensajes no leídos"; en cualquier otro caso (o si no hay divisor), al final.
   */
  private posicionar(silencioso: boolean): void {
    requestAnimationFrame(() => {
      const el = this.scroller()?.nativeElement;
      if (!el) return;
      if (!silencioso && this.scrollNoLeidoPend && this.primerNoLeidoId()) {
        const sep = el.querySelector('.thread__unread-sep') as HTMLElement | null;
        if (sep) {
          this.scrollNoLeidoPend = false;
          el.scrollTop = Math.max(0, sep.offsetTop - 12);
          return;
        }
      }
      el.scrollTop = el.scrollHeight;
    });
  }

  // ── AT14 — separadores de fecha (Hoy/Ayer/fecha) ────────────────────────────
  /** true si el mensaje `i` inicia un nuevo día calendario respecto al anterior. */
  esNuevoDia(i: number): boolean {
    const list = this.lista();
    if (i <= 0) return true;
    return esOtroDia(list[i - 1].created_at, list[i].created_at);
  }
  etiquetaDia = etiquetaDiaChat;

  // ── AT16 — stickers ─────────────────────────────────────────────────────────
  esSticker(m: Mensaje): boolean {
    return m.tipo === 'sticker';
  }
  stickerUrl(ref: string | null): string {
    return ref ? this.mensajes.stickerUrl(ref) : '';
  }

  toggleStickerPicker(): void {
    const abrir = !this.stickerPickerOpen();
    this.stickerPickerOpen.set(abrir);
    if (abrir) this.menuAdjuntar.set(false);
    if (abrir && !this.stickersCargados) void this.loadStickers();
  }

  private async loadStickers(): Promise<void> {
    this.stickerLoading.set(true);
    try {
      const [packs, recientes] = await Promise.all([
        this.mensajes.getMisStickers(),
        this.mensajes.getStickersRecientes(),
      ]);
      this.stickerPacks.set(packs);
      this.stickerRecientes.set(recientes);
      this.stickersCargados = true;
    } catch {
      this.toast.error('No pudimos cargar los stickers.');
    } finally {
      this.stickerLoading.set(false);
    }
  }

  /** Envía un sticker (optimista + outbox); sube la ref al frente de recientes. */
  async enviarStickerMsg(ref: string): Promise<void> {
    this.stickerPickerOpen.set(false);
    this.lista.update((l) => [
      ...l,
      {
        id: 'tmp-stk-' + Date.now(),
        autor_id: this.yo() ?? '',
        autor_nombre: 'Tú',
        contenido: null,
        tipo: 'sticker',
        archivo_path: ref,
        archivo_nombre: null,
        archivo_mime: 'image/sticker',
        created_at: new Date().toISOString(),
      },
    ]);
    this.stickerRecientes.update((list) => [ref, ...list.filter((r) => r !== ref)]);
    this.scrollAlFinal();
    try {
      await this.mensajes.enviarSticker(this.conversacionId, ref);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo enviar el sticker.');
    }
  }

  /** Sube una imagen como sticker propio y recarga los packs. */
  async onStickerFile(): Promise<void> {
    if (this.stickerUploading()) return;
    const fotos = await this.camera.pickFromGallery(1);
    const foto = fotos[0];
    if (!foto) return;
    this.stickerUploading.set(true);
    try {
      const activo = this.stickerPackActivo();
      const packId = activo && !activo.es_sistema ? activo.id : undefined;
      await this.mensajes.subirSticker(this.yo() ?? '', { blob: foto.blob, nombre: `sticker-${Date.now()}.jpg`, mime: 'image/jpeg' }, packId);
      this.stickerPacks.set(await this.mensajes.getMisStickers());
      this.toast.success('Sticker agregado.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo subir el sticker.');
    } finally {
      this.stickerUploading.set(false);
    }
  }

  /** Elimina un sticker propio y recarga los packs. */
  async eliminarStickerLocal(stickerId: string): Promise<void> {
    try {
      await this.mensajes.eliminarSticker(stickerId);
      this.stickerPacks.set(await this.mensajes.getMisStickers());
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo eliminar el sticker.');
    }
  }

  back(): void {
    this.location.back();
  }
}
