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
import { BottomSheet } from '../../shared/ui/bottom-sheet/bottom-sheet';
import { VoiceRecorder } from '../../shared/ui/voice-recorder/voice-recorder';
import { CompaService } from '../../core/services/compa.service';
import { NetworkService } from '../../core/services/network.service';
import { ToastService } from '../../core/services/toast.service';
import { CompaMensaje, Propuesta } from '../../core/models/compa.model';
import { formatHora } from '../../core/util/fecha';

/** BB2 — clave del borrador persistente del composer (sobrevive al navegar). */
const BORRADOR_KEY = 'compa_borrador';

/** Sugerencias iniciales (chips) por defecto — fallback si la RPC por rol falla. */
const SUGERENCIAS = [
  '¿Qué tareas tengo?',
  '¿Tengo conduces por firmar?',
  'Créame una tarea en mi obra',
];
/** Saludo/subtítulo por defecto (fallback del intro por rol, BA3). */
const SALUDO_DEFAULT = 'Hola, soy Compa';
const SUBTITULO_DEFAULT = 'Pregúntame por tus tareas, conduces, firmas o pídeme que registre algo por ti.';

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
  private inputEl = viewChild<ElementRef<HTMLInputElement>>('composer');

  readonly fmtHora = formatHora; // BB2/AY11a — hora al pie de cada burbuja

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

  /** BA3 — chips + saludo/subtítulo por rol (RPC compa_sugerencias); fallback estático. */
  sugerencias = signal<string[]>(SUGERENCIAS);
  saludo = signal(SALUDO_DEFAULT);
  subtitulo = signal(SUBTITULO_DEFAULT);

  /** conversacion_id devuelto por el primer turno; se reenvía en los siguientes. */
  private conversacionId: string | null = null;

  vacio = computed(() => this.mensajes().length === 0);

  get online(): boolean {
    return this.net.online();
  }

  constructor() {
    void this.cargarSugerencias();
    // BB2 — el borrador del composer sobrevive al salir/entrar (paridad AY10).
    // NO se autoenfoca al montar: en móvil abrir el teclado de golpe molesta.
    try {
      const guardado = localStorage.getItem(BORRADOR_KEY);
      if (guardado) this.texto.set(guardado);
    } catch {
      /* localStorage bloqueado (modo privado): sin persistencia, no es crítico */
    }
    effect(() => {
      const t = this.texto();
      try {
        if (t) localStorage.setItem(BORRADOR_KEY, t);
        else localStorage.removeItem(BORRADOR_KEY);
      } catch {
        /* best-effort */
      }
    });
  }

  /** BA3 — carga los chips/saludo por rol (una fuente para web y app). Best-effort. */
  private async cargarSugerencias(): Promise<void> {
    if (!this.online) return; // el fallback estático ya cubre el offline
    const s = await this.compa.sugerencias();
    if (!s) return;
    this.sugerencias.set(s.chips);
    if (s.saludo) this.saludo.set(s.saludo);
    if (s.subtitulo) this.subtitulo.set(s.subtitulo);
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
    await this.enviarTexto(t);
  }

  /** BB2 — devuelve el foco al composer (dentro del gesto del usuario, para no cerrar el teclado). */
  private enfocarInput(): void {
    this.inputEl()?.nativeElement.focus();
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
      { id: this.nuevoId(), rol: 'user', texto: t, ts: new Date().toISOString() },
    ]);
    this.scrollAlFinal();
    try {
      const r = await this.compa.enviar(t, this.conversacionId);
      if (r.conversacion_id) this.conversacionId = r.conversacion_id;
      this.mensajes.update((list) => [
        ...list,
        { id: this.nuevoId(), rol: 'assistant', texto: r.respuesta, propuesta: r.propuesta, ts: new Date().toISOString() },
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
        { id: this.nuevoId(), rol: 'assistant', texto: r.respuesta, ts: new Date().toISOString() },
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
    if (!blob) return; // cancelado (o mic sin permiso: el recorder ya avisó la causa)
    // AZ5 — la transcripción necesita conexión; si se perdió tras grabar, avisa claro.
    if (!this.online) {
      this.toast.error('Sin conexión: no se pudo transcribir. Intenta con señal o escribe tu mensaje.');
      return;
    }
    this.transcribiendo.set(true);
    try {
      const r = await this.compa.transcribir(blob);
      if (r.ok) {
        // Coloca el texto en el composer para que el usuario lo EDITE antes de enviar.
        const actual = this.texto().trim();
        this.texto.set(actual ? `${actual} ${r.texto}` : r.texto);
      } else {
        this.toast.error(this.mensajeTranscripcion(r.causa));
      }
    } finally {
      this.transcribiendo.set(false);
    }
  }

  /** AZ5 — mensaje específico por causa (el fallback siempre invita a escribir). */
  private mensajeTranscripcion(causa: 'vacio' | 'no_configurado' | 'sin_conexion' | 'servicio'): string {
    switch (causa) {
      case 'vacio':
        return 'No se entendió. Intenta de nuevo o escribe tu mensaje.';
      case 'no_configurado':
        return 'El dictado por voz no está disponible ahora. Escribe tu mensaje.';
      case 'sin_conexion':
        return 'Sin conexión: no se pudo transcribir. Intenta con señal o escribe tu mensaje.';
      default:
        return 'No pudimos transcribir ahora. Intenta de nuevo o escribe tu mensaje.';
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
