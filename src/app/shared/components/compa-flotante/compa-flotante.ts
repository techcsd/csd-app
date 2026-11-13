import { ChangeDetectionStrategy, Component, ElementRef, HostBinding, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { MarkdownView } from '../../ui/markdown-view/markdown-view';
import { VoiceRecorder } from '../../ui/voice-recorder/voice-recorder';
import { BottomSheet } from '../../ui/bottom-sheet/bottom-sheet';
import { CompaChatStore } from '../../../core/services/compa-chat.store';
import { CompaFlotanteService } from '../../../core/services/compa-flotante.service';
import { formatHora } from '../../../core/util/fecha';
import { MOTION_DIRECTIVES } from '../../motion';

/**
 * DG6 — Compa flotante: burbuja (abajo a la derecha) → hoja desde abajo (~78%,
 * DG-19) con la MISMA conversación que `/compa` (comparten `CompaChatStore`).
 * Nunca tapa la acción principal naranja de la pantalla de abajo (la burbuja es
 * chica y queda en una esquina; la hoja solo ocupa 78% de la pantalla, deja ver
 * que hay algo detrás). Se cierra deslizando hacia abajo o con el botón ✕/atrás.
 *
 * A propósito MÁS SIMPLE que `/compa`: sin compartir conversación (CP2) ni visor
 * de PDF inline (abre el enlace en una pestaña nueva) — son flujos de la pantalla
 * completa; aquí el objetivo es responder rápido sin cambiar de pantalla.
 */
@Component({
  selector: 'app-compa-flotante',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MarkdownView, VoiceRecorder, BottomSheet, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './compa-flotante.html',
  styleUrl: './compa-flotante.scss',
})
export class CompaFlotante {
  store = inject(CompaChatStore);
  flotante = inject(CompaFlotanteService);
  private router = inject(Router);

  private scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');
  private inputEl = viewChild<ElementRef<HTMLInputElement>>('composerFlot');
  private burbujaEl = viewChild<ElementRef<HTMLButtonElement>>('burbujaBtn');

  readonly fmtHora = formatHora;

  /** N7/DH7 — "Ocultar" en el saludo inicial; se resetea cada vez que se abre la hoja. */
  introDescartada = signal(false);

  /**
   * DO1 — estilo inline de la burbuja cuando el usuario ya la arrastró a una
   * posición propia (left/top en px, por dispositivo). Sin posición guardada,
   * no se pisa nada: queda el CSS por defecto (abajo-derecha).
   */
  burbujaStyle = computed<Record<string, string>>(() => {
    const p = this.flotante.posicion();
    if (!p) return {} as Record<string, string>;
    return { left: `${p.left}px`, top: `${p.top}px`, right: 'auto', bottom: 'auto' };
  });

  /** DO1b — empuja la burbuja hacia arriba cuando una pantalla reserva espacio
   *  (ver CompaFlotanteService.reservarEspacio); heredado por `.cf__burbuja` vía
   *  `var(--compa-safe-bottom)`. Sin efecto si el usuario ya arrastró la burbuja
   *  (bottom queda en 'auto' por `burbujaStyle()`). */
  @HostBinding('style.--compa-safe-bottom.px')
  get compaSafeBottom(): number {
    return this.flotante.reservadoPx();
  }

  private arrastre: { startX: number; startY: number; startLeft: number; startTop: number; moved: boolean } | null = null;
  /** Evita que el `(click)` que sigue al `pointerup` de un arrastre abra/cierre la hoja. */
  private justDragged = false;

  constructor() {
    // DG6 — autoscroll propio (misma idea que CompaPage): reacciona a la MISMA
    // conversación compartida, cada vista hace scroll en SU propia lista.
    effect(() => {
      if (!this.flotante.abierta()) return;
      this.store.mensajes();
      this.store.pensando();
      this.scrollAlFinal();
    });
  }

  toggleBurbuja(): void {
    if (this.justDragged) {
      this.justDragged = false; // el pointerup de un arrastre no abre/cierra la hoja
      return;
    }
    if (this.flotante.abierta()) {
      this.flotante.cerrar();
    } else {
      this.introDescartada.set(false);
      this.flotante.abrir();
      void this.store.cargarSugerencias();
    }
  }

  /** DO1 — arrastre táctil real de la burbuja (pointer events: mouse + touch + pen). */
  onBurbujaPointerDown(ev: PointerEvent): void {
    const el = this.burbujaEl()?.nativeElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    this.arrastre = { startX: ev.clientX, startY: ev.clientY, startLeft: rect.left, startTop: rect.top, moved: false };
    el.setPointerCapture(ev.pointerId);
  }

  onBurbujaPointerMove(ev: PointerEvent): void {
    const a = this.arrastre;
    const el = this.burbujaEl()?.nativeElement;
    if (!a || !el) return;
    const dx = ev.clientX - a.startX;
    const dy = ev.clientY - a.startY;
    if (!a.moved && Math.hypot(dx, dy) < 6) return; // umbral: todavía puede ser un tap
    a.moved = true;

    const size = el.offsetWidth || 56;
    const margen = 8;
    const safeTop = this.safeInsetPx('--safe-top');
    const safeBottom = this.safeInsetPx('--safe-bottom');
    const minLeft = margen;
    const minTop = margen + safeTop;
    const maxLeft = Math.max(minLeft, window.innerWidth - size - margen);
    const maxTop = Math.max(minTop, window.innerHeight - size - margen - safeBottom);

    this.flotante.posicion.set({
      left: Math.min(Math.max(a.startLeft + dx, minLeft), maxLeft),
      top: Math.min(Math.max(a.startTop + dy, minTop), maxTop),
    });
  }

  onBurbujaPointerUp(ev: PointerEvent): void {
    const a = this.arrastre;
    this.arrastre = null;
    const el = this.burbujaEl()?.nativeElement;
    if (el) {
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch {
        /* best-effort */
      }
    }
    if (a?.moved) {
      this.justDragged = true;
      this.flotante.guardarPosicion(this.flotante.posicion());
    }
  }

  /** Valor numérico (px) de una variable CSS de `env(safe-area-inset-*)`; 0 si no resuelve. */
  private safeInsetPx(varName: string): number {
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  cerrar(): void {
    this.flotante.cerrar();
  }

  async enviar(): Promise<void> {
    if (this.store.enviando()) return;
    const t = this.store.texto().trim();
    if (!t) return;
    this.store.texto.set('');
    this.inputEl()?.nativeElement.focus();
    await this.store.enviarTexto(t);
  }

  async usarSugerencia(s: string): Promise<void> {
    await this.store.usarSugerencia(s);
  }

  async confirmarPropuesta(): Promise<void> {
    await this.store.confirmarPropuesta();
  }

  cancelarPropuesta(): void {
    this.store.cancelarPropuesta();
  }

  /** CV1 — mismo patrón que CompaPage: cierra la hoja y navega al formulario real. */
  abrirFormularioPropuesta(): void {
    const p = this.store.propuesta();
    if (!p || p.accion !== 'abrir' || !p.destino) return;
    const destino = p.destino;
    this.store.cancelarPropuesta();
    this.flotante.cerrar();
    void this.router.navigate(['/transporte/combustible', destino.vehiculo_id], {
      queryParams: destino.query,
    });
  }

  faltanTexto(items: string[] | undefined | null): string {
    return this.store.faltanTexto(items);
  }

  abrirVoz(): void {
    this.store.abrirVoz();
  }

  async onVozGrabada(blob: Blob | null): Promise<void> {
    await this.store.onVozGrabada(blob);
  }

  /** Simplificado: sin visor inline (es la hoja flotante, poco espacio) — abre el enlace. */
  abrirArchivo(a: { nombre: string; url: string }): void {
    globalThis.open?.(a.url, '_blank');
  }

  irAlChatCompleto(): void {
    this.flotante.cerrar();
    void this.router.navigate(['/compa']);
  }

  private scrollAlFinal(): void {
    requestAnimationFrame(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
