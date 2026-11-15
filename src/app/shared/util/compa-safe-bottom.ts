import { DestroyRef, inject } from '@angular/core';
import { CompaFlotanteService } from '../../core/services/compa-flotante.service';

/**
 * DO1b — reserva espacio (px) para que la burbuja de Compa no tape el footer de
 * acción fijo de la pantalla/componente actual (compose de Mensajes, CTA de los
 * wizards). Se libera sola al destruirse el componente que la llamó. Un solo
 * punto para toda pantalla/compomente con este patrón — no parches sueltos.
 */
export function reservarEspacioCompa(px: number): void {
  const flotante = inject(CompaFlotanteService);
  flotante.reservarEspacio(px);
  inject(DestroyRef).onDestroy(() => flotante.liberarEspacio());
}
