import { Injectable, signal } from '@angular/core';

/** CJ1 — preferencia de movimiento por dispositivo (no se sincroniza con la web). */
export type MotionPref = 'completas' | 'reducidas';

/** localStorage (por dispositivo, default 'completas'). */
const PREF_KEY = 'csd-motion-pref';

/** CJ2/CJ3 — tipos de celebración GRANDE (overlay `app-celebracion`). Son ids del
 *  catálogo de movimiento (`core/motion/catalogo-movimiento.ts`). */
export const CELEBRACION_TIPOS = ['conduce', 'ruta'] as const;
export type CelebracionTipo = (typeof CELEBRACION_TIPOS)[number];

/**
 * CL2 — tipos de MOMENTO mediano (0,8 s, sin velo). Son ids del catálogo de movimiento
 * y el **contrato compartido con la web** (regla 5): mismos nombres en app↔SGC. El
 * componente global `app-momento` pinta cada uno con su micro-animación (caja, sello,
 * gota…). `uso` = la llave que pasa de mano (tomar/soltar vehículo); `todo-enviado` =
 * el check al vaciar la cola offline.
 */
export const MOMENTO_TIPOS = [
  'entrada', // caja entra al almacén
  'salida', // caja sale hacia la obra
  'aprobado', // sello APROBADA
  'firma', // trazo de firma
  'combustible', // gota que se llena
  'checklist', // puntos tachados en cascada
  'mantenimiento', // la llave gira
  'mensaje', // avión de papel
  'documento', // hoja impresa (sin sello)
  'uso', // llave que pasa de mano (uso de vehículo)
  'todo-enviado', // check al drenar el outbox
] as const;
export type MomentoTipo = (typeof MOMENTO_TIPOS)[number];

/** CL2 — datos opcionales de un momento mediano. */
export interface MomentoDatos {
  /** Texto breve del aviso (ej. "Entrada registrada"). Si falta, se usa el default por tipo. */
  texto?: string | null;
}

/** CL2 — momento mediano activo (el componente global `app-momento` lo observa). */
export interface Momento extends MomentoDatos {
  tipo: MomentoTipo;
  /** Token para distinguir momentos sucesivos del mismo tipo. */
  at?: number;
}

/** CJ2/CJ3 — datos de una celebración grande. `corta` = variante 0,8s sin velo
 *  (p.ej. encolado offline "Guardado, se enviará"). */
export interface Celebracion {
  tipo: CelebracionTipo;
  corta?: boolean;
  /** Conduce creado. */
  numero?: string | null;
  destino?: string | null;
  /** Ruta creada. */
  paradas?: number | null;
  /** Botón de acción del overlay ("Ver conduce" / "Ir a mi ruta"). */
  accionUrl?: string | null;
  accionLabel?: string | null;
  /** Mensaje de la variante corta (offline). */
  mensajeCorto?: string | null;
  /** Token para que el overlay distinga celebraciones sucesivas. */
  at?: number;
}

/**
 * MotionService (CJ1) — gestiona el ajuste de usuario "Animaciones: completas /
 * reducidas" (Perfil › Ajustes). Aplica la clase `motion-reduced` en <html>, que el
 * CSS usa para anular crossfades/transiciones igual que `prefers-reduced-motion`.
 *
 * `reducido()` es la fuente única para que las animaciones GRANDES (CJ2/CJ3) se
 * salten solas: es verdadero si el usuario eligió "reducidas" O el SO pide
 * movimiento reducido. Es por dispositivo (localStorage); el default es 'completas'.
 */
@Injectable({ providedIn: 'root' })
export class MotionService {
  private _pref = signal<MotionPref>(this.readCached());
  /** Preferencia elegida (para pintar el selector). */
  readonly pref = this._pref.asReadonly();

  /** CJ2/CJ3 — celebración activa (el componente global app-celebracion la observa). */
  private _celebracion = signal<Celebracion | null>(null);
  readonly celebracion = this._celebracion.asReadonly();

  /** CL2 — momento mediano activo (el componente global app-momento lo observa). */
  private _momento = signal<Momento | null>(null);
  readonly momentoActivo = this._momento.asReadonly();

  constructor() {
    this.applyToDom(this._pref());
  }

  /**
   * CL2 — dispara un MOMENTO mediano (0,8 s, sin velo, no bloquea: la acción ya
   * ocurrió). Mismo contrato que la web (`momento(tipo, datos)`). El componente global
   * `app-momento` lo pinta con la micro-animación de su tipo; con reduce-motion se
   * degrada a solo el check/aviso. Degrada offline igual (es un aviso local, no toca red).
   *
   * No usar para accidente/multa/rechazo/eliminación/error/retiro dañado: esos van con
   * aviso sobrio (toast), sin celebración (CL2 §b).
   */
  momento(tipo: MomentoTipo, datos?: MomentoDatos): void {
    this._momento.set({ tipo, ...datos, at: Date.now() });
  }

  /** Cierra el momento (auto-dismiss o al tocar). */
  cerrarMomento(): void {
    this._momento.set(null);
  }

  /**
   * CJ2/CJ3 — dispara una celebración grande (una por acción, no bloquea). El
   * componente global la pinta; con reduce-motion se degrada a solo el check. Pasa
   * `corta:true` al ENCOLAR offline (variante 0,8s "Guardado, se enviará").
   */
  celebrar(c: Celebracion): void {
    this._celebracion.set({ ...c, at: Date.now() });
  }

  /** Cierra la celebración (auto-dismiss o al tocar). */
  cerrarCelebracion(): void {
    this._celebracion.set(null);
  }

  private readCached(): MotionPref {
    try {
      return localStorage.getItem(PREF_KEY) === 'reducidas' ? 'reducidas' : 'completas';
    } catch {
      return 'completas';
    }
  }

  private applyToDom(p: MotionPref): void {
    try {
      document.documentElement.classList.toggle('motion-reduced', p === 'reducidas');
    } catch {
      /* sin DOM (SSR) → no-op */
    }
  }

  /** Fija la preferencia y la aplica/cachea (best-effort, por dispositivo). */
  setPref(p: MotionPref): void {
    this._pref.set(p);
    this.applyToDom(p);
    try {
      localStorage.setItem(PREF_KEY, p);
    } catch {
      /* almacenamiento no disponible */
    }
  }

  /**
   * ¿Hay que evitar el movimiento? Verdadero si el usuario eligió "reducidas" o si el
   * SO pide `prefers-reduced-motion: reduce`. Las celebraciones (CJ2/CJ3) lo consultan
   * para degradar a solo el check.
   */
  reducido(): boolean {
    if (this._pref() === 'reducidas') return true;
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }
}
