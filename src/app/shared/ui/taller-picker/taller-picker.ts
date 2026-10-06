import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BottomSheet } from '../bottom-sheet/bottom-sheet';
import { SelectList, SelectOption } from '../select-list/select-list';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { ProveedorFlota } from '../../../core/services/mantenimientos.service';

/** CH2 — selección de taller/proveedor (id del maestro) o texto libre ("Otro"). */
export interface TallerSel {
  id: string | null;
  nombre: string | null;
}

/**
 * CH2 — selector de Taller / Proveedor para los flujos de mantenimiento (reemplaza
 * el input de texto libre). Botón de campo → hoja inferior con buscador y lista
 * agrupada (Talleres primero, luego Otros proveedores) + «Otro…» (texto libre
 * obligatorio). La lista llega cacheada (offline); «Otro» siempre está disponible.
 */
@Component({
  selector: 'app-taller-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, BottomSheet, SelectList, TranslatePipe],
  templateUrl: './taller-picker.html',
  styleUrl: './taller-picker.scss',
})
export class TallerPicker {
  private i18n = inject(I18nService);

  label = input<string>('Taller / proveedor');
  talleres = input<ProveedorFlota[]>([]);
  selectedId = input<string | null>(null);
  /** Nombre a mostrar cuando es texto libre ("Otro") o la lista aún no cargó. */
  selectedNombre = input<string | null>(null);

  changed = output<TallerSel>();

  open = signal(false);
  modoOtro = signal(false);
  otroTexto = signal('');

  readonly OTRO = '__otro__';

  /** Opciones para la lista: Talleres primero, luego Otros proveedores. */
  opciones = computed<SelectOption[]>(() =>
    this.talleres().map((p) => ({
      id: p.id,
      label: p.nombre,
      group: p.es_taller ? this.i18n.t('Talleres') : this.i18n.t('Otros proveedores'),
    })),
  );

  /** Etiqueta del campo: el nombre elegido (del maestro o libre) o el placeholder. */
  display = computed<string>(() => {
    const id = this.selectedId();
    if (id) return this.talleres().find((p) => p.id === id)?.nombre ?? this.selectedNombre() ?? '—';
    return this.selectedNombre() ?? '';
  });

  abrir(): void {
    this.modoOtro.set(false);
    this.otroTexto.set(this.selectedId() ? '' : (this.selectedNombre() ?? ''));
    this.open.set(true);
  }

  cerrar(): void {
    this.open.set(false);
    this.modoOtro.set(false);
  }

  onPick(id: string): void {
    const p = this.talleres().find((x) => x.id === id);
    this.changed.emit({ id, nombre: p?.nombre ?? null });
    this.cerrar();
  }

  abrirOtro(): void {
    this.modoOtro.set(true);
  }

  confirmarOtro(): void {
    const t = this.otroTexto().trim();
    if (!t) return;
    this.changed.emit({ id: null, nombre: t });
    this.cerrar();
  }

  limpiar(): void {
    this.changed.emit({ id: null, nombre: null });
    this.cerrar();
  }
}
