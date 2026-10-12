import { Injectable, signal } from '@angular/core';

/** CM3 — un capítulo del video: etiqueta + segundo al que salta. */
export interface VideoChapter {
  segundo: number;
  label: string;
}

/** CM3 — fuente de un video listo para el reproductor a pantalla completa. */
export interface VideoPlayerSource {
  /** URL ya firmada del video (bucket privado `tutoriales`). */
  url: string;
  /** Póster firmado/URL (opcional). */
  poster?: string | null;
  /** Subtítulos .vtt firmados (opcional → sin CC). */
  subtitulos?: string | null;
  /** Título que se pinta sobre la portada. */
  titulo?: string | null;
  /** Antetítulo corto ("CSD APP · FLOTA"). */
  kicker?: string | null;
  /** Capítulos para la hoja inferior (opcional). */
  capitulos?: VideoChapter[] | null;
  /** Token para distinguir aperturas sucesivas. */
  at: number;
}

/**
 * CM3 (PROMPT-95 F5) — servicio del reproductor de video a pantalla completa (una
 * sola instancia, host global `app-video-player` en app.html). Cualquier pantalla lo
 * abre con `open(fuente)` sin montar el componente.
 *
 * **Solo online**: el llamador DEBE verificar conexión antes (el video se streamea
 * del bucket privado; nunca se descarga en segundo plano). Si no hay URL no abre.
 */
@Injectable({ providedIn: 'root' })
export class VideoPlayerService {
  private _estado = signal<VideoPlayerSource | null>(null);
  readonly estado = this._estado.asReadonly();

  open(fuente: Omit<VideoPlayerSource, 'at'> | null | undefined): void {
    if (!fuente?.url) return;
    this._estado.set({ ...fuente, at: Date.now() });
  }

  close(): void {
    this._estado.set(null);
  }
}
