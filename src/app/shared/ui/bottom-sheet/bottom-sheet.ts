import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Hoja inferior reutilizable (patrón de hojas S1/U16). Overlay + panel que sube
 * desde abajo, con encabezado y contenido proyectado. El padre controla `open`;
 * emite `closed` al tocar el fondo o la ✕. Se usa para pickers embebidos
 * (vehículo en multas W5, destino de salida W8, etc.).
 */
@Component({
  selector: 'app-bottom-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bottom-sheet.html',
  styleUrl: './bottom-sheet.scss',
})
export class BottomSheet {
  open = input<boolean>(false);
  titulo = input<string>('');
  closed = output<void>();

  cerrar(): void {
    this.closed.emit();
  }
}
