import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** S19 — estado de mantenimiento derivado del km EN VIVO. */
export interface KmMantenimiento {
  estado: 'ok' | 'pre_cita' | 'vencido';
  /** km que faltan para el próximo mantenimiento (negativo = vencido). */
  faltan: number;
  /** km del próximo mantenimiento. */
  proximo: number;
}

/**
 * S19 — input de kilometraje compartido (pre-uso, reporte semanal, recibir/
 * devolver). Muestra el último km registrado, marca EN VIVO si el que se escribe
 * es menor (rojo), y calcula EN VIVO el estado de mantenimiento ("Faltan Y km" /
 * "cerca" / "VENCIDO") mientras el usuario escribe. Presentational: expone
 * `invalido` y `mant` vía las mismas fórmulas para que el padre valide/­resuma.
 */
@Component({
  selector: 'app-km-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe],
  templateUrl: './km-input.html',
  styleUrl: './km-input.scss',
})
export class KmInput {
  label = input('Kilometraje actual (km)');
  /** Two-way: el km que escribe el usuario. */
  value = model<number | null>(null);
  /** Último km registrado del vehículo (odómetro). */
  ultimo = input<number | null>(null);
  /** km del último mantenimiento hecho + intervalo, para el cálculo en vivo. */
  ultimoMantenimientoKm = input<number | null>(null);
  intervaloMantenimientoKm = input<number | null>(5000);
  /** Umbral "cerca del mantenimiento" (sgc.flota_config.umbral_precita_km). */
  precitaKm = input(500);
  /**
   * Y9 — flag defensivo explícito del servidor (`v_vehiculo_stats.mantenimiento_por_revisar`).
   * Aunque no se pase, se deriva localmente con la MISMA regla del server
   * (`km_ultimo_mantenimiento > odómetro`) desde los valores que ya recibe.
   */
  mantenimientoPorRevisar = input(false);

  /** El km escrito es menor al último registrado → incoherente. */
  invalido = computed(() => {
    const v = this.value();
    const u = this.ultimo();
    return v != null && u != null && v < u;
  });

  /**
   * Y9 — el dato base de mantenimiento es incoherente (el último mantenimiento
   * "registrado" supera el odómetro). Regla idéntica a la del server
   * (`km_ultimo_mantenimiento > vehiculos.kilometraje`). En ese caso NO se
   * muestra un cálculo engañoso de "faltan X km" — se avisa que hay que revisarlo.
   */
  mantPorRevisar = computed(() => {
    if (this.mantenimientoPorRevisar()) return true;
    const base = this.ultimoMantenimientoKm();
    const u = this.ultimo();
    return base != null && u != null && base > u;
  });

  /** Estado de mantenimiento calculado con el km EN VIVO (null si no hay datos o el dato es incoherente). */
  mant = computed<KmMantenimiento | null>(() => {
    if (this.mantPorRevisar()) return null; // Y9 — dato incoherente: no calcular
    const v = this.value();
    const base = this.ultimoMantenimientoKm();
    if (v == null || v <= 0 || base == null) return null;
    const proximo = base + (this.intervaloMantenimientoKm() ?? 5000);
    const faltan = proximo - v;
    const estado = faltan <= 0 ? 'vencido' : faltan <= this.precitaKm() ? 'pre_cita' : 'ok';
    return { estado, faltan, proximo };
  });

  onInput(v: string | number | null): void {
    this.value.set(v === '' || v == null ? null : Number(v));
  }
}
