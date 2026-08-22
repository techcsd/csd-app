import { Injectable, signal } from '@angular/core';

/**
 * AU11 — estado del filtro del catálogo (categoría + búsqueda) fuera del componente,
 * para que SOBREVIVA al navegar al detalle de un artículo y volver (el componente de
 * catálogo es lazy y se destruye al salir). Vive en memoria durante la sesión.
 */
@Injectable({ providedIn: 'root' })
export class CatalogoFiltroStore {
  readonly categoria = signal<number | null>(null); // null = todas
  readonly query = signal('');
}
