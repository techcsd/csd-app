import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, viewChild } from '@angular/core';
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

  readonly fmtHora = formatHora;

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
    if (this.flotante.abierta()) {
      this.flotante.cerrar();
    } else {
      this.flotante.abrir();
      void this.store.cargarSugerencias();
    }
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
