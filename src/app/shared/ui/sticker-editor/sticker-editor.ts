import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

/**
 * AV4 — editor de sticker previo al upload (estilo WhatsApp): recorte cuadrado
 * (zoom + arrastrar) + bordes redondeados sobre fondo TRANSPARENTE. Salida webp
 * con alfa (512×512). No hace remoción de fondo por IA (v2); el "recorte + esquinas
 * redondeadas" ya da el look de sticker con transparencia.
 */
@Component({
  selector: 'app-sticker-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './sticker-editor.html',
  styleUrl: './sticker-editor.scss',
})
export class StickerEditor implements AfterViewInit, OnChanges, OnDestroy {
  /** Imagen fuente a editar (se abre el editor cuando cambia y no es null). */
  imagen = input<Blob | null>(null);

  confirmado = output<Blob>();
  cancelado = output<void>();

  private canvasEl = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  private img: HTMLImageElement | null = null;
  private imgUrl: string | null = null;
  readonly SIZE = 512;

  zoom = signal(1);
  radio = signal(28); // % del lado (0 = cuadrado, 50 = círculo)
  procesando = signal(false);

  // Estado de arrastre (pan) en píxeles del canvas.
  private offX = 0;
  private offY = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  ngAfterViewInit(): void {
    this.cargarImagen();
  }

  ngOnChanges(ch: SimpleChanges): void {
    if (ch['imagen'] && this.canvasEl()) this.cargarImagen();
  }

  ngOnDestroy(): void {
    if (this.imgUrl) URL.revokeObjectURL(this.imgUrl);
  }

  private cargarImagen(): void {
    const blob = this.imagen();
    if (!blob) return;
    if (this.imgUrl) URL.revokeObjectURL(this.imgUrl);
    this.imgUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      this.img = img;
      this.offX = 0;
      this.offY = 0;
      this.zoom.set(1);
      this.dibujar();
    };
    img.src = this.imgUrl;
  }

  /** Escala base para "cover" del cuadrado. */
  private escalaBase(): number {
    const img = this.img;
    if (!img) return 1;
    return Math.max(this.SIZE / img.width, this.SIZE / img.height);
  }

  onZoom(v: number): void {
    this.zoom.set(v);
    this.dibujar();
  }
  onRadio(v: number): void {
    this.radio.set(v);
    this.dibujar();
  }

  onPointerDown(ev: PointerEvent): void {
    this.dragging = true;
    this.lastX = ev.clientX;
    this.lastY = ev.clientY;
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
  }
  onPointerMove(ev: PointerEvent): void {
    if (!this.dragging) return;
    const rect = this.canvasEl()!.nativeElement.getBoundingClientRect();
    const k = this.SIZE / rect.width; // pantalla → coords del canvas
    this.offX += (ev.clientX - this.lastX) * k;
    this.offY += (ev.clientY - this.lastY) * k;
    this.lastX = ev.clientX;
    this.lastY = ev.clientY;
    this.dibujar();
  }
  onPointerUp(): void {
    this.dragging = false;
  }

  /** Dibuja la vista previa (con el recorte redondeado y el tablero de transparencia). */
  private dibujar(): void {
    const canvas = this.canvasEl()?.nativeElement;
    const img = this.img;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const S = this.SIZE;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    this.trazarRedondeado(ctx, S, (this.radio() / 100) * S);
    ctx.clip();
    const scale = this.escalaBase() * this.zoom();
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (S - w) / 2 + this.offX;
    const y = (S - h) / 2 + this.offY;
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  }

  private trazarRedondeado(ctx: CanvasRenderingContext2D, S: number, r: number): void {
    const rad = Math.min(r, S / 2);
    ctx.beginPath();
    ctx.moveTo(rad, 0);
    ctx.lineTo(S - rad, 0);
    ctx.arcTo(S, 0, S, rad, rad);
    ctx.lineTo(S, S - rad);
    ctx.arcTo(S, S, S - rad, S, rad);
    ctx.lineTo(rad, S);
    ctx.arcTo(0, S, 0, S - rad, rad);
    ctx.lineTo(0, rad);
    ctx.arcTo(0, 0, rad, 0, rad);
    ctx.closePath();
  }

  cancelar(): void {
    this.cancelado.emit();
  }

  async confirmar(): Promise<void> {
    const canvas = this.canvasEl()?.nativeElement;
    if (!canvas || this.procesando()) return;
    this.procesando.set(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/webp', 0.92),
      );
      if (blob) this.confirmado.emit(blob);
    } finally {
      this.procesando.set(false);
    }
  }
}
