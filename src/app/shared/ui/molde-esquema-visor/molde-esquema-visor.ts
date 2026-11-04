import { ChangeDetectionStrategy, Component, effect, inject, input, output } from '@angular/core';
import { MoldeEsquema, MoldeTramo } from '../molde-esquema/molde-esquema';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

/**
 * DI10 — visor a pantalla completa del esquema (SVG en vivo) de un molde. NO es
 * una galería de fotos ni usa `PhotoViewerService` (eso es para imágenes con URL
 * firmada); aquí solo se reenvían los mismos inputs que `app-molde-esquema` a un
 * contenedor más grande para que el SVG escale (ya usa `viewBox` + `width:100%`).
 *
 * Mismo mecanismo de "Atrás" físico que `PhotoViewer` (CM5): mientras está
 * abierto registra un handler de overlay en `NavGuardService` para que el botón
 * físico de Android cierre el visor en vez de navegar.
 *
 * Fuera de alcance de esta ronda (deliberado): pinch-zoom/pan sobre el SVG — el
 * pedido original solo era "verlo grande", que esto ya resuelve.
 */
@Component({
  selector: 'app-molde-esquema-visor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoldeEsquema, TranslatePipe],
  templateUrl: './molde-esquema-visor.html',
  styleUrl: './molde-esquema-visor.scss',
})
export class MoldeEsquemaVisor {
  private navGuard = inject(NavGuardService);

  // Mismos inputs que app-molde-esquema: se reenvían tal cual.
  forma = input<string>('rectangular');
  tramos = input<MoldeTramo[]>([]);
  medidaPlano = input<MoldeTramo[] | null>(null);
  toleranciaCm = input<number>(2);

  open = input(false);
  closed = output<void>();

  private readonly backHandler = (): boolean => {
    this.close();
    return true;
  };

  constructor() {
    effect(() => {
      if (this.open()) {
        this.navGuard.registerOverlay(this.backHandler); // Android "Atrás" cierra el visor
      } else {
        this.navGuard.clearOverlay(this.backHandler);
      }
    });
  }

  close(): void {
    this.closed.emit();
  }
}
