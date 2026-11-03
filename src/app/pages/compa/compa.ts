import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { BottomSheet } from '../../shared/ui/bottom-sheet/bottom-sheet';
import { VoiceRecorder } from '../../shared/ui/voice-recorder/voice-recorder';
import { MarkdownView } from '../../shared/ui/markdown-view/markdown-view';
import { PdfViewer } from '../../shared/ui/pdf-viewer/pdf-viewer';
import { CompaService, CompaUsuarioBusqueda } from '../../core/services/compa.service';
import { CompaChatStore } from '../../core/services/compa-chat.store';
import { ToastService } from '../../core/services/toast.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
import { MOTION_DIRECTIVES } from '../../shared/motion';
import { formatHora } from '../../core/util/fecha';

/**
 * FASE 4 "Compa" — chat con el asistente de IA. Reutiliza la edge `assistant`
 * (ya desplegada). ONLINE-only (asistente en vivo, sin outbox).
 *
 * DG6 — el estado de la conversación (historial, propuesta, sugerencias…) vive en
 * `CompaChatStore` (singleton), NO en este componente: así esta pantalla completa
 * y la ventana flotante (`CompaFlotante`, accesible desde cualquier pantalla)
 * comparten la MISMA conversación. Este componente solo re-expone las señales del
 * store (mismos nombres públicos que antes, el template no cambió) y resuelve lo
 * que SÍ es propio de la pantalla completa: compartir conversación (CP2), visor de
 * PDF inline (CO6/CP3) y el scroll de su propia lista.
 */
@Component({
  selector: 'app-compa',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, BottomSheet, VoiceRecorder, MarkdownView, PdfViewer, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './compa.html',
  styleUrl: './compa.scss',
})
export class CompaPage {
  private store = inject(CompaChatStore);
  private compa = inject(CompaService);
  private toast = inject(ToastService);
  private location = inject(Location);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private i18n = inject(I18nService);

  private scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');
  private inputEl = viewChild<ElementRef<HTMLInputElement>>('composer');

  readonly fmtHora = formatHora; // BB2/AY11a — hora al pie de cada burbuja

  // DG6 — re-expone las señales del store (mismos nombres que el template ya usaba).
  mensajes = this.store.mensajes;
  texto = this.store.texto;
  enviando = this.store.enviando;
  pensando = this.store.pensando;
  grabandoVoz = this.store.grabandoVoz;
  transcribiendo = this.store.transcribiendo;
  propuesta = this.store.propuesta;
  ejecutando = this.store.ejecutando;
  sugerencias = this.store.sugerencias;
  saludo = this.store.saludo;
  subtitulo = this.store.subtitulo;
  vacio = this.store.vacio;

  /** CO6 — PDF abierto desde un mensaje de Compa (p. ej. generar_reporte_pdf), o null. */
  pdfVisor = signal<{ url: string; nombre: string } | null>(null);
  private static readonly PDF_RE = /https?:\/\/\S+\.pdf(\?\S*)?/i;

  /** CO6 — ¿este texto trae un enlace a un PDF? (p. ej. un reporte que Compa generó). */
  pdfDe(texto: string): string | null {
    const m = texto.match(CompaPage.PDF_RE);
    return m ? m[0] : null;
  }
  abrirPdf(url: string): void {
    this.pdfVisor.set({ url, nombre: 'Reporte' });
  }
  cerrarPdf(): void {
    this.pdfVisor.set(null);
  }

  /** CP3 — ¿el archivo es un PDF? (por extensión de la URL, best-effort). */
  esPdf(url: string): boolean {
    return /\.pdf(\?\S*)?$/i.test(url);
  }

  /** CP3 — abre un archivo del arreglo `archivos[]` del mensaje: PDF → visor, resto → nueva pestaña/descarga. */
  abrirArchivo(a: { nombre: string; url: string }): void {
    if (this.esPdf(a.url)) {
      this.pdfVisor.set({ url: a.url, nombre: a.nombre || 'Reporte' });
      return;
    }
    globalThis.open?.(a.url, '_blank');
  }

  // ── CP2 — Compartir conversación ────────────────────────────────────────────
  compartirAbierto = signal(false);
  compartirTerm = signal('');
  compartirBuscando = signal(false);
  compartirResultados = signal<CompaUsuarioBusqueda[]>([]);
  compartirElegidos = signal<CompaUsuarioBusqueda[]>([]);
  compartirMensaje = signal('');
  compartirEnviando = signal(false);
  private compartirDebounce: ReturnType<typeof setTimeout> | null = null;

  /** ¿Hay algo que compartir? (necesita conversacion_id, lo que implica ≥1 turno). */
  puedeCompartir = computed(() => !!this.store.conversacionId() && !this.vacio());

  verCompartidas(): void {
    void this.router.navigate(['/compa/compartidas']);
  }

  abrirCompartir(): void {
    if (!this.puedeCompartir()) return;
    this.compartirTerm.set('');
    this.compartirResultados.set([]);
    this.compartirElegidos.set([]);
    this.compartirMensaje.set('');
    this.compartirAbierto.set(true);
  }

  cerrarCompartir(): void {
    if (this.compartirEnviando()) return;
    this.compartirAbierto.set(false);
  }

  onCompartirTerm(v: string): void {
    this.compartirTerm.set(v);
    if (this.compartirDebounce) clearTimeout(this.compartirDebounce);
    const t = v.trim();
    if (t.length < 2) {
      this.compartirResultados.set([]);
      return;
    }
    this.compartirDebounce = setTimeout(() => void this.buscarParaCompartir(t), 300);
  }

  private async buscarParaCompartir(t: string): Promise<void> {
    this.compartirBuscando.set(true);
    try {
      const yaElegidos = new Set(this.compartirElegidos().map((u) => u.id));
      const res = await this.compa.buscarUsuarios(t);
      this.compartirResultados.set(res.filter((u) => !yaElegidos.has(u.id)));
    } finally {
      this.compartirBuscando.set(false);
    }
  }

  elegirParaCompartir(u: CompaUsuarioBusqueda): void {
    this.compartirElegidos.update((list) => (list.some((x) => x.id === u.id) ? list : [...list, u]));
    this.compartirResultados.set([]);
    this.compartirTerm.set('');
  }

  quitarElegido(u: CompaUsuarioBusqueda): void {
    this.compartirElegidos.update((list) => list.filter((x) => x.id !== u.id));
  }

  async confirmarCompartir(): Promise<void> {
    const destinatarios = this.compartirElegidos();
    const conversacionId = this.store.conversacionId();
    if (!destinatarios.length || this.compartirEnviando() || !conversacionId) return;
    this.compartirEnviando.set(true);
    try {
      await this.compa.compartir(conversacionId, destinatarios.map((u) => u.id), this.compartirMensaje());
      this.toast.success(this.i18n.t('Conversación compartida.'));
      this.compartirAbierto.set(false);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo compartir la conversación.'));
    } finally {
      this.compartirEnviando.set(false);
    }
  }

  get online(): boolean {
    return this.store.online;
  }

  constructor() {
    void this.store.cargarSugerencias();
    // BQ10 — deep-link "Compa ya puede ayudarte con esto" (?q=<pregunta>): precarga
    // la pregunta en el composer para que el usuario solo tenga que enviarla. Un q
    // explícito manda sobre el borrador guardado (es una intención directa).
    const q = (this.route.snapshot.queryParamMap.get('q') ?? '').trim();
    if (q) this.texto.set(q);
    // DG6 — autoscroll: reacciona a cualquier cambio de hilo (mensajes nuevos o el
    // indicador "escribiendo…"), sin acoplar el scroll al flujo de envío del store
    // (la ventana flotante dispara los mismos cambios y necesita lo mismo).
    effect(() => {
      this.mensajes();
      this.pensando();
      this.scrollAlFinal();
    });
  }

  /** Envía el texto del composer. */
  async enviar(): Promise<void> {
    // BB2 — si Compa todavía responde, NO limpiamos ni perdemos el texto: el envío
    // queda para cuando termine (el botón está deshabilitado; Enter simplemente no hace nada).
    if (this.enviando()) return;
    const t = this.texto().trim();
    if (!t) return;
    this.texto.set('');
    this.enfocarInput(); // BB2 — seguir tecleando sin re-tocar (mantiene el teclado abierto)
    await this.store.enviarTexto(t);
  }

  /** BB2 — devuelve el foco al composer (dentro del gesto del usuario, para no cerrar el teclado). */
  private enfocarInput(): void {
    this.inputEl()?.nativeElement.focus();
  }

  /** Toca un chip de sugerencia → lo envía directo. */
  async usarSugerencia(s: string): Promise<void> {
    await this.store.usarSugerencia(s);
  }

  // ── Propuesta de acción (hoja de confirmación) ──────────────────────────────
  async confirmarPropuesta(): Promise<void> {
    await this.store.confirmarPropuesta();
  }

  cancelarPropuesta(): void {
    this.store.cancelarPropuesta();
  }

  /**
   * CV1 — propuestas "preparar + abrir" (`accion==='abrir'`, p.ej. `preparar_echada`):
   * Compa nunca guarda ni sube fotos. Navega al formulario real con los datos como
   * queryParams y cierra la hoja; no hay llamada a `compa.ejecutar`.
   */
  abrirFormularioPropuesta(): void {
    const p = this.propuesta();
    if (!p || p.accion !== 'abrir' || !p.destino) return;
    const destino = p.destino;
    this.store.cancelarPropuesta();
    void this.router.navigate(['/transporte/combustible', destino.vehiculo_id], {
      queryParams: destino.query,
    });
  }

  /** CV1 — "Faltan: a, b y c." a partir de `faltan[]` (ya viene en español desde el servidor). */
  faltanTexto(items: string[] | undefined | null): string {
    return this.store.faltanTexto(items);
  }

  // ── Voz (nota → transcripción → composer) ───────────────────────────────────
  abrirVoz(): void {
    this.store.abrirVoz();
  }

  /** El recorder emitió el blob (o null al cancelar) → transcribe al composer. */
  async onVozGrabada(blob: Blob | null): Promise<void> {
    await this.store.onVozGrabada(blob);
  }

  back(): void {
    this.location.back();
  }

  private scrollAlFinal(): void {
    requestAnimationFrame(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
