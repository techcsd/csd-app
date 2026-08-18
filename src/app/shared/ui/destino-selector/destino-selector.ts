import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { OptionButton } from '../option-button/option-button';
import { CollapsibleSelect } from '../collapsible-select/collapsible-select';
import { SelectOption } from '../select-list/select-list';
import { LocationPicker, UbicacionSeleccionada } from '../location-picker/location-picker';
import { LugarDestino } from '../../../core/services/conduces.service';

/** AV13 — resultado de elegir un destino (paridad total con el wizard de creación). */
export interface DestinoSeleccion {
  /** Texto legible del destino (nombre de obra/almacén o dirección del pin). */
  texto: string;
  /** id de la obra cuando el destino es una obra; null para almacén o pin de mapa. */
  proyectoId: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * AV13 — selector de destino COMPARTIDO: las MISMAS opciones que el wizard de
 * creación (obra / almacén central / almacén por dropdown, o pin en el mapa).
 * Se usa en "Crear ruta" y en "Cambiar destino" para que no haya una versión
 * recortada. El padre pasa la lista de lugares (obras+almacenes) y recibe la
 * selección por `destinoChange`.
 */
@Component({
  selector: 'app-destino-selector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OptionButton, CollapsibleSelect, LocationPicker],
  templateUrl: './destino-selector.html',
  styleUrl: './destino-selector.scss',
})
export class DestinoSelector {
  /** Obras + almacenes (con lat/lng) para el dropdown. */
  lugares = input<LugarDestino[]>([]);

  destinoChange = output<DestinoSeleccion>();

  modo = signal<'lugar' | 'mapa'>('lugar');
  lugarId = signal('');
  mapaTexto = signal('');

  lugarOpts = computed<SelectOption[]>(() =>
    this.lugares().map((l) => ({
      id: l.id,
      label: l.nombre,
      icon: l.tipo === 'obra' ? '🏗️' : '🏢',
    })),
  );

  selectedLugar = computed<LugarDestino | null>(
    () => this.lugares().find((l) => l.id === this.lugarId()) ?? null,
  );

  setModo(m: 'lugar' | 'mapa'): void {
    this.modo.set(m);
  }

  onLugar(id: string): void {
    this.lugarId.set(id);
    const l = this.lugares().find((x) => x.id === id);
    if (!l) return;
    this.destinoChange.emit({
      texto: l.nombre,
      proyectoId: l.tipo === 'obra' ? l.id : null,
      lat: l.latitud,
      lng: l.longitud,
    });
  }

  onUbicacion(u: UbicacionSeleccionada): void {
    const texto = u.direccion?.trim() || `Ubicación ${u.latitud.toFixed(5)}, ${u.longitud.toFixed(5)}`;
    this.mapaTexto.set(texto);
    this.destinoChange.emit({ texto, proyectoId: null, lat: u.latitud, lng: u.longitud });
  }
}
