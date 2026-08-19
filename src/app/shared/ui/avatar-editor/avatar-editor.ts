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
 * AW7 — editor de foto de perfil (usuario y grupo): recorte CIRCULAR con zoom y
 * arrastre + preview antes de guardar. Hermano del sticker-editor (AV4) pero con
 * guía circular y salida JPEG cuadrada (el avatar se muestra en círculo por CSS;
 * guardamos cuadrado para que se vea bien en todos lados). Misma API: `imagen`
 * de entrada, `confirmado`/`cancelado` de salida.
 */
@Component({
  selector: 'app-avatar-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './avatar-editor.html',
  styleUrl: './avatar-editor.scss',
})
export class AvatarEditor implements AfterViewInit, OnChanges, OnDestroy {
  /** Imagen fuente a editar (se abre cuando cambia y no es null). */
  imagen = input<Blob | null>(null);

  confirmado = output<Blob>();
  cancelado = output<void>();

  private canvasEl = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  private img: HTMLImageElement | null = null;
  private imgUrl: string | null = null;
  readonly SIZE = 512;

  zoom = signal(1);
  procesando = signal(false);

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

  private escalaBase(): number {
    const img = this.img;
    if (!img) return 1;
    return Math.max(this.SIZE / img.width, this.SIZE / img.height);
  }

  onZoom(v: number): void {
    this.zoom.set(v);
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
    const k = this.SIZE / rect.width;
    this.offX += (ev.clientX - this.lastX) * k;
    this.offY += (ev.clientY - this.lastY) * k;
    this.lastX = ev.clientX;
    this.lastY = ev.clientY;
    this.dibujar();
  }
  onPointerUp(): void {
    this.dragging = false;
  }

  private dibujar(): void {
    const canvas = this.canvasEl()?.nativeElement;
    const img = this.img;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const S = this.SIZE;
    // Fondo blanco (la foto se guarda cuadrada JPEG, sin transparencia).
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, S, S);
    const scale = this.escalaBase() * this.zoom();
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (S - w) / 2 + this.offX;
    const y = (S - h) / 2 + this.offY;
    ctx.drawImage(img, x, y, w, h);
    // Máscara circular guía (oscurece las esquinas fuera del círculo — solo preview).
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.rect(0, 0, S, S);
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.restore();
  }

  cancelar(): void {
    this.cancelado.emit();
  }

  /** Exporta el recorte CUADRADO (sin la máscara guía) como JPEG. */
  async confirmar(): Promise<void> {
    const img = this.img;
    if (!img || this.procesando()) return;
    this.procesando.set(true);
    try {
      const S = this.SIZE;
      const out = document.createElement('canvas');
      out.width = S;
      out.height = S;
      const ctx = out.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, S, S);
      const scale = this.escalaBase() * this.zoom();
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (S - w) / 2 + this.offX;
      const y = (S - h) / 2 + this.offY;
      ctx.drawImage(img, x, y, w, h);
      const blob = await new Promise<Blob | null>((resolve) =>
        out.toBlob((b) => resolve(b), 'image/jpeg', 0.9),
      );
      if (blob) this.confirmado.emit(blob);
    } finally {
      this.procesando.set(false);
    }
  }
}
