import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
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
export class SignaturePad {
  private canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private pad: SignaturePadLib | null = null;

  empty = signal(true);
  changed = output<boolean>();

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
    });
  }

  /** Scale the backing store to device pixels so the stroke isn't blurry. */
  private resizeCanvas(canvas: HTMLCanvasElement): void {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext('2d')?.scale(ratio, ratio);
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
