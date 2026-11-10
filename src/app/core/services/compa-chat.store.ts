import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { CompaService } from './compa.service';
import { IaConsentGate } from './ia-consent-gate.service';
import { NetworkService } from './network.service';
import { ToastService } from './toast.service';
import { I18nService } from '../i18n/i18n.service';
import { CompaMensaje, Propuesta } from '../models/compa.model';

/** BB2 — clave del borrador persistente del composer (sobrevive al navegar). */
const BORRADOR_KEY = 'compa_borrador';

/** Sugerencias iniciales (chips) por defecto — fallback si la RPC por rol falla.
 *  DL3/DL4 (PROMPT 139) — "¿Qué me falta de los grupos?" usa `mis_pendientes_de_grupos`
 *  (138 F7), solo lo propio (responsable_id = usuario actual); la fuente real por rol
 *  vive en `compa_sugerencias` (138 F7.4), esta lista solo cubre el caso degradado. */
const SUGERENCIAS = [
  '¿Qué tareas tengo?',
  '¿Tengo conduces por firmar?',
  'Créame una tarea en mi obra',
  '¿Qué me falta de los grupos?',
];
/** Saludo/subtítulo por defecto (fallback del intro por rol, BA3). */
const SALUDO_DEFAULT = 'Hola, soy Compa';
const SUBTITULO_DEFAULT = 'Pregúntame por tus tareas, conduces, firmas o pídeme que registre algo por ti.';

/**
 * DG6 — estado de la conversación de Compa, extraído de `CompaPage` a un
 * singleton (`providedIn: 'root'`) para que la pantalla completa (`/compa`) y la
 * ventana flotante (`CompaFlotante`, accesible desde cualquier pantalla) compartan
 * EXACTAMENTE la misma conversación — nunca dos hilos que diverjan. Toda la lógica
 * de envío/voz/propuestas vivía antes en el componente; aquí es idéntica, solo
 * movida (ver `compa.ts`, que ahora re-expone estas señales).
 */
@Injectable({ providedIn: 'root' })
export class CompaChatStore {
  private compa = inject(CompaService);
  private net = inject(NetworkService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private iaGate = inject(IaConsentGate);

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
  conversacionId = signal<string | null>(null);

  vacio = computed(() => this.mensajes().length === 0);

  private sugerenciasCargadas = false;

  constructor() {
    // BB2 — el borrador del composer sobrevive al salir/entrar (paridad AY10).
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

  get online(): boolean {
    return this.net.online();
  }

  /** BA3 — carga los chips/saludo por rol (una fuente para web y app). Best-effort,
   *  una sola vez por sesión (ambas vistas —página y flotante— comparten el mismo
   *  resultado, no hace falta repetir la llamada al abrir cada una). */
  async cargarSugerencias(): Promise<void> {
    if (this.sugerenciasCargadas || !this.online) return;
    const s = await this.compa.sugerencias();
    if (!s) return;
    this.sugerenciasCargadas = true;
    this.sugerencias.set(s.chips);
    if (s.saludo) this.saludo.set(s.saludo);
    if (s.subtitulo) this.subtitulo.set(s.subtitulo);
  }

  /** Toca un chip de sugerencia → lo envía directo. */
  async usarSugerencia(s: string): Promise<void> {
    await this.enviarTexto(s);
  }

  /**
   * Núcleo de envío: pinta la burbuja del usuario, llama a la edge y pinta la
   * respuesta (o el mensaje de error amable, ya normalizado por el servicio).
   * Público: cada vista (página completa / flotante) limpia su propio composer y
   * reenfoca su propio input ANTES de llamar aquí (el foco es cosa de la vista).
   */
  async enviarTexto(t: string): Promise<void> {
    if (this.enviando()) return;
    // CO16 — la bandera va antes del await de consentimiento.
    this.enviando.set(true);
    try {
      if (!this.online) {
        this.toast.error(this.i18n.t('Compa necesita conexión.'));
        return;
      }
      if (!(await this.iaGate.pedir())) return; // CI10 — consentimiento de IA
      await this.enviarTextoInterno(t);
    } finally {
      this.enviando.set(false);
    }
  }

  private async enviarTextoInterno(t: string): Promise<void> {
    this.pensando.set(true);
    this.mensajes.update((list) => [
      ...list,
      { id: this.nuevoId(), rol: 'user', texto: t, ts: new Date().toISOString() },
    ]);
    try {
      const r = await this.compa.enviar(t, this.conversacionId());
      if (r.conversacion_id) this.conversacionId.set(r.conversacion_id);
      this.mensajes.update((list) => [
        ...list,
        { id: this.nuevoId(), rol: 'assistant', texto: r.respuesta, propuesta: r.propuesta, archivos: r.archivos, ts: new Date().toISOString() },
      ]);
      if (r.propuesta) this.propuesta.set(r.propuesta);
    } finally {
      this.pensando.set(false);
    }
  }

  /** Confirma la propuesta: la ejecuta server-side y pinta el resultado. */
  async confirmarPropuesta(): Promise<void> {
    const p = this.propuesta();
    if (!p || this.ejecutando()) return;
    this.ejecutando.set(true);
    try {
      if (!(await this.iaGate.pedir())) return; // CI10 — consentimiento de IA
      const r = await this.compa.ejecutar(p, this.conversacionId());
      this.mensajes.update((list) => [
        ...list,
        { id: this.nuevoId(), rol: 'assistant', texto: r.respuesta, ts: new Date().toISOString() },
      ]);
      this.propuesta.set(null);
    } finally {
      this.ejecutando.set(false);
    }
  }

  cancelarPropuesta(): void {
    if (this.ejecutando()) return;
    this.propuesta.set(null);
  }

  /** CV1 — "Faltan: a, b y c." a partir de `faltan[]` (ya viene en español del servidor). */
  faltanTexto(items: string[] | undefined | null): string {
    if (!items?.length) return '';
    const bajado = items.map((s) => s.charAt(0).toLowerCase() + s.slice(1));
    if (bajado.length === 1) return bajado[0];
    return `${bajado.slice(0, -1).join(', ')} ${this.i18n.t('y')} ${bajado[bajado.length - 1]}`;
  }

  // ── Voz (nota → transcripción → composer) ───────────────────────────────────
  abrirVoz(): void {
    if (!this.online) {
      this.toast.error(this.i18n.t('Compa necesita conexión.'));
      return;
    }
    this.grabandoVoz.set(true);
  }

  /** El recorder emitió el blob (o null al cancelar) → transcribe al composer. */
  async onVozGrabada(blob: Blob | null): Promise<void> {
    this.grabandoVoz.set(false);
    if (!blob) return;
    if (!this.online) {
      this.toast.error(this.i18n.t('Sin conexión: no se pudo transcribir. Intenta con señal o escribe tu mensaje.'));
      return;
    }
    if (!(await this.iaGate.pedir())) return; // CI10 — consentimiento de IA
    this.transcribiendo.set(true);
    try {
      const r = await this.compa.transcribir(blob);
      if (r.ok) {
        const actual = this.texto().trim();
        this.texto.set(actual ? `${actual} ${r.texto}` : r.texto);
      } else {
        this.toast.error(this.mensajeTranscripcion(r.causa));
      }
    } finally {
      this.transcribiendo.set(false);
    }
  }

  private mensajeTranscripcion(causa: 'vacio' | 'no_configurado' | 'sin_conexion' | 'servicio'): string {
    switch (causa) {
      case 'vacio':
        return this.i18n.t('No se entendió. Intenta de nuevo o escribe tu mensaje.');
      case 'no_configurado':
        return this.i18n.t('El dictado por voz no está disponible ahora. Escribe tu mensaje.');
      case 'sin_conexion':
        return this.i18n.t('Sin conexión: no se pudo transcribir. Intenta con señal o escribe tu mensaje.');
      default:
        return this.i18n.t('No pudimos transcribir ahora. Intenta de nuevo o escribe tu mensaje.');
    }
  }

  private nuevoId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
