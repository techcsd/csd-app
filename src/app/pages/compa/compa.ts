import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { BottomSheet } from '../../shared/ui/bottom-sheet/bottom-sheet';
import { VoiceRecorder } from '../../shared/ui/voice-recorder/voice-recorder';
import { CompaService } from '../../core/services/compa.service';
import { NetworkService } from '../../core/services/network.service';
import { ToastService } from '../../core/services/toast.service';
import { CompaMensaje, Propuesta } from '../../core/models/compa.model';

/** Sugerencias iniciales (chips) cuando el hilo está vacío. */
const SUGERENCIAS = [
  '¿Qué tareas tengo?',
  '¿Tengo conduces por firmar?',
  'Créame una tarea en mi obra',
];

/**
 * FASE 4 "Compa" — chat con el asistente de IA. Reutiliza la edge `assistant`
 * (ya desplegada). ONLINE-only (asistente en vivo, sin outbox). El historial se
 * mantiene en memoria por sesión (`mensajes`); `conversacionId` se toma de la
 * primera respuesta y se reenvía en los siguientes turnos.
 *
 * TODO: persistir el hilo (assistant_mensajes) para recuperarlo entre sesiones.
 */
@Component({
  selector: 'app-compa',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, BottomSheet, VoiceRecorder],
  templateUrl: './compa.html',
  styleUrl: './compa.scss',
})
export class CompaPage {
  private compa = inject(CompaService);
  private net = inject(NetworkService);
  private toast = inject(ToastService);
  private location = inject(Location);

  private scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');

  /** Historial en memoria del hilo (por sesión). */
  mensajes = signal<CompaMensaje[]>([]);
  texto = signal('');
  enviando = signal(false);
  /** Indicador "escribiendo…" mientras se espera la respuesta del asistente. */
  pensando = signal(false);
  /** true mientras se muestra la barra de grabación (voz). */
  grabandoVoz = signal(false);
  /** true mientras se transcribe la nota de voz. */
  transcribiendo = signal(false);

  /** Propuesta de acción a confirmar (hoja de confirmación); null = cerrada. */
  propuesta = signal<Propuesta | null>(null);
  /** true mientras se ejecuta la propuesta confirmada. */
  ejecutando = signal(false);

  readonly sugerencias = SUGERENCIAS;

  /** conversacion_id devuelto por el primer turno; se reenvía en los siguientes. */
  private conversacionId: string | null = null;

  vacio = computed(() => this.mensajes().length === 0);

  get online(): boolean {
    return this.net.online();
  }

  /** Envía el texto del composer. */
  async enviar(): Promise<void> {
    const t = this.texto().trim();
    if (!t) return;
    this.texto.set('');
    await this.enviarTexto(t);
  }

  /** Toca un chip de sugerencia → lo envía directo. */
  async usarSugerencia(s: string): Promise<void> {
    await this.enviarTexto(s);
  }

  /**
   * Núcleo de envío: pinta la burbuja del usuario, llama a la edge y pinta la
   * respuesta (o el mensaje de error amable, ya normalizado por el servicio).
   */
  private async enviarTexto(t: string): Promise<void> {
    if (this.enviando()) return;
    if (!this.online) {
      this.toast.error('Compa necesita conexión.');
      return;
    }
    this.enviando.set(true);
    this.pensando.set(true);
    this.mensajes.update((list) => [
      ...list,
      { id: this.nuevoId(), rol: 'user', texto: t },
    ]);
    this.scrollAlFinal();
    try {
      const r = await this.compa.enviar(t, this.conversacionId);
      if (r.conversacion_id) this.conversacionId = r.conversacion_id;
      this.mensajes.update((list) => [
        ...list,
        { id: this.nuevoId(), rol: 'assistant', texto: r.respuesta, propuesta: r.propuesta },
      ]);
      // Si el turno trae una propuesta de escritura, abre la hoja de confirmación.
      if (r.propuesta) this.propuesta.set(r.propuesta);
    } finally {
      this.enviando.set(false);
      this.pensando.set(false);
      this.scrollAlFinal();
    }
  }

  // ── Propuesta de acción (hoja de confirmación) ──────────────────────────────
  /** Confirma la propuesta: la ejecuta server-side y pinta el resultado. */
  async confirmarPropuesta(): Promise<void> {
    const p = this.propuesta();
    if (!p || this.ejecutando()) return;
    this.ejecutando.set(true);
    try {
      const r = await this.compa.ejecutar(p, this.conversacionId);
      this.mensajes.update((list) => [
        ...list,
        { id: this.nuevoId(), rol: 'assistant', texto: r.respuesta },
      ]);
      this.propuesta.set(null);
      this.scrollAlFinal();
    } finally {
      this.ejecutando.set(false);
    }
  }

  cancelarPropuesta(): void {
    if (this.ejecutando()) return;
    this.propuesta.set(null);
  }

  // ── Voz (nota → transcripción → composer) ───────────────────────────────────
  abrirVoz(): void {
    if (!this.online) {
      this.toast.error('Compa necesita conexión.');
      return;
    }
    this.grabandoVoz.set(true);
  }

  /** El recorder emitió el blob (o null al cancelar) → transcribe al composer. */
  async onVozGrabada(blob: Blob | null): Promise<void> {
    this.grabandoVoz.set(false);
    if (!blob) return; // cancelado
    this.transcribiendo.set(true);
    try {
      const texto = await this.compa.transcribir(blob);
      if (texto) {
        // Coloca el texto en el composer para que el usuario lo EDITE antes de enviar.
        const actual = this.texto().trim();
        this.texto.set(actual ? `${actual} ${texto}` : texto);
      } else {
        this.toast.error('No pudimos transcribir. Escribe tu mensaje.');
      }
    } finally {
      this.transcribiendo.set(false);
    }
  }

  back(): void {
    this.location.back();
  }

  private nuevoId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private scrollAlFinal(): void {
    requestAnimationFrame(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
