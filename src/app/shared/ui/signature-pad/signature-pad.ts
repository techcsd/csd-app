import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';
import SignaturePadLib from 'signature_pad';

/**
 * On-screen signature capture (driver hand-off, delivery receiver).
 * Exposes toBlob() so the parent can grab a PNG when confirming.
 */
@Component({
  selector: 'app-signature-pad',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './signature-pad.html',
  styleUrl: './signature-pad.scss',
})
export class SignaturePad implements OnDestroy {
  private canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private pad: SignaturePadLib | null = null;

  empty = signal(true);
  changed = output<boolean>();

  // QA-41 — re-ajusta el canvas al rotar/redimensionar SIN borrar la firma.
  private onResize = (): void => this.refit();

  constructor() {
    afterNextRender(() => {
      const canvas = this.canvasRef().nativeElement;
      this.resizeCanvas(canvas);
      this.pad = new SignaturePadLib(canvas, {
        penColor: '#18181b',
        backgroundColor: '#ffffff',
      });
      this.pad.addEventListener('endStroke', () => {
        this.empty.set(this.pad!.isEmpty());
        this.changed.emit(!this.pad!.isEmpty());
      });
      // QA-41 — al rotar la pantalla, el canvas cambia de tamaño; sin esto el
      // trazo en progreso se perdía. Guardamos los trazos y los restauramos.
      window.addEventListener('resize', this.onResize);
      window.addEventListener('orientationchange', this.onResize);
    });
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
  }

  /** Scale the backing store to device pixels so the stroke isn't blurry. */
  private resizeCanvas(canvas: HTMLCanvasElement): void {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext('2d')?.scale(ratio, ratio);
  }

  /**
   * QA-41 — reajusta el canvas al nuevo tamaño conservando la firma: guarda los
   * trazos (toData), reescala el backing store y los vuelve a pintar (fromData).
   * Cambiar width/height limpia el lienzo, por eso se guarda/restaura.
   */
  private refit(): void {
    if (!this.pad) return;
    const canvas = this.canvasRef().nativeElement;
    const data = this.pad.toData();
    this.resizeCanvas(canvas);
    this.pad.clear(); // sincroniza el estado interno tras el resize
    if (data.length) this.pad.fromData(data);
    const vacio = this.pad.isEmpty();
    this.empty.set(vacio);
    this.changed.emit(!vacio);
  }

  clear(): void {
    this.pad?.clear();
    this.empty.set(true);
    this.changed.emit(false);
  }

  async toBlob(): Promise<Blob | null> {
    if (!this.pad || this.pad.isEmpty()) return null;
    const canvas = this.canvasRef().nativeElement;
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  }
}
