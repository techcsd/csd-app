import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { Img } from '../../../shared/ui/img/img';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { CombustibleService } from '../../../core/services/combustible.service';
import { ToastService } from '../../../core/services/toast.service';
import { NetworkService } from '../../../core/services/network.service';
import { SyncService } from '../../../core/sync/sync.service';
import { EchadaPorAprobar } from '../../../core/models/combustible.model';
import { db } from '../../../core/db/app-db';
import { parseNumeroFlexible } from '../../../core/util/numero';

/**
 * BY1/BY5 (regla 15) — bandeja "Por aprobar" para roles elevados (Raykler / admin):
 * las echadas que nacieron EN ESPERA por una bandera (salto de km, consumo anormal,
 * sin asignación, retroactiva, galones > tanque). Cada tarjeta muestra el motivo del
 * aviso en humano, las fotos, el km anterior → actual y galones/monto, con las tres
 * salidas de la regla 15: **Aprobar**, **Aprobar con corrección** y **Rechazar** (con
 * motivo). Todo por outbox (funciona offline, idempotente por la echada).
 */
@Component({
  selector: 'app-por-aprobar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, FormsModule, Skeleton, EmptyState, Img, TranslatePipe],
  templateUrl: './por-aprobar.html',
  styleUrl: './por-aprobar.scss',
})
export class PorAprobarPage {
  private location = inject(Location);
  private combustible = inject(CombustibleService);
  private toast = inject(ToastService);
  private network = inject(NetworkService);
  private sync = inject(SyncService);
  private i18n = inject(I18nService);

  loading = signal(true);
  /** BL2/8ª regla — distinguir "sin datos" de "falló la consulta". */
  error = signal(false);
  private items = signal<EchadaPorAprobar[]>([]);
  /** Echadas ya decididas localmente (aprobadas/rechazadas) — ocultas aunque el
   *  servidor aún las liste (offline: siguen en_espera hasta drenar la cola). */
  private decididas = signal<Set<string>>(new Set());

  /** Lista visible: la del servidor menos las ya decididas en este dispositivo. */
  visibles = computed(() => {
    const hidden = this.decididas();
    return this.items().filter((e) => !hidden.has(e.id));
  });
  vacio = computed(() => !this.loading() && !this.error() && !this.visibles().length);

  // ── Modal: rechazar (motivo obligatorio) ────────────────────────────────────
  rechazando = signal<EchadaPorAprobar | null>(null);
  motivo = signal('');
  // ── Modal: aprobar con corrección ───────────────────────────────────────────
  corrigiendo = signal<EchadaPorAprobar | null>(null);
  kmCorr = signal('');
  galonesCorr = signal('');
  montoCorr = signal('');
  guardando = signal(false);

  constructor() {
    // Recarga al entrar y tras cada cambio del outbox (drain de una decisión).
    effect(() => {
      this.sync.changed();
      void this.load();
    });
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      const rows = await this.combustible.echadasPorAprobar();
      this.items.set(rows);
      // Semilla de "decididas" desde el outbox: si hay decisiones aún sin drenar,
      // que no reaparezcan al recargar (offline / antes del sync).
      await this.sembrarDecididasDesdeOutbox();
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /** Marca como decididas las echadas con una decisión pendiente en la cola. */
  private async sembrarDecididasDesdeOutbox(): Promise<void> {
    try {
      const ops = await db.outbox.where('tipo_op').equals('revision_echada').toArray();
      if (!ops.length) return;
      this.decididas.update((prev) => {
        const next = new Set(prev);
        for (const op of ops) {
          const echadaId = (op.payload as { echada_id?: string })?.echada_id;
          if (echadaId) next.add(echadaId);
        }
        return next;
      });
    } catch {
      /* best-effort: sin la semilla, a lo sumo reaparece hasta drenar */
    }
  }

  private ocultar(id: string): void {
    this.decididas.update((prev) => new Set(prev).add(id));
  }

  reintentar(): void {
    void this.load();
  }

  /** Etiqueta corta del vehículo (o "Sin vehículo" para una echada de persona). */
  vehLabel(e: EchadaPorAprobar): string {
    return e.vehiculo_label || e.placa || this.i18n.t('Sin vehículo');
  }

  // ── Aprobar (sin corrección) ────────────────────────────────────────────────
  async aprobar(e: EchadaPorAprobar): Promise<void> {
    this.ocultar(e.id);
    try {
      await this.combustible.decidirEchada(e.id, 'aprobar');
      this.toast.success(this.online ? this.i18n.t('Echada aprobada.') : this.i18n.t('Aprobada — se enviará al reconectar.'));
    } catch {
      this.toast.error(this.i18n.t('No se pudo aprobar. Intenta de nuevo.'));
      this.reintentar();
    }
  }

  // ── Aprobar con corrección ──────────────────────────────────────────────────
  abrirCorreccion(e: EchadaPorAprobar): void {
    this.corrigiendo.set(e);
    this.kmCorr.set(e.kilometraje != null ? String(e.kilometraje) : '');
    this.galonesCorr.set(e.galones != null ? String(e.galones) : '');
    this.montoCorr.set(e.monto != null ? String(e.monto) : '');
  }
  cerrarCorreccion(): void {
    this.corrigiendo.set(null);
  }
  async guardarCorreccion(): Promise<void> {
    const e = this.corrigiendo();
    if (!e || this.guardando()) return;
    // Solo se envían los campos que cambiaron (editar_echada valida el resto).
    const correccion: Record<string, unknown> = {};
    const km = parseNumeroFlexible(this.kmCorr(), 'decimal');
    const gal = parseNumeroFlexible(this.galonesCorr(), 'decimal');
    const monto = parseNumeroFlexible(this.montoCorr(), 'monto');
    if (km != null && km !== e.kilometraje) correccion['kilometraje'] = Math.round(km);
    if (gal != null && gal !== e.galones) correccion['galones'] = gal;
    if (monto != null && monto !== e.monto) correccion['monto'] = monto;

    this.guardando.set(true);
    this.ocultar(e.id);
    try {
      await this.combustible.decidirEchada(e.id, 'aprobar', {
        nota: this.i18n.t('Aprobada con corrección'),
        correccion: Object.keys(correccion).length ? correccion : null,
      });
      this.toast.success(this.online ? this.i18n.t('Echada aprobada con corrección.') : this.i18n.t('Guardada — se enviará al reconectar.'));
      this.corrigiendo.set(null);
    } catch {
      this.toast.error(this.i18n.t('No se pudo aprobar. Intenta de nuevo.'));
      this.reintentar();
    } finally {
      this.guardando.set(false);
    }
  }

  // ── Rechazar (motivo obligatorio) ───────────────────────────────────────────
  abrirRechazo(e: EchadaPorAprobar): void {
    this.rechazando.set(e);
    this.motivo.set('');
  }
  cerrarRechazo(): void {
    this.rechazando.set(null);
  }
  async confirmarRechazo(): Promise<void> {
    const e = this.rechazando();
    if (!e || this.guardando()) return;
    const motivo = this.motivo().trim();
    if (!motivo) {
      this.toast.error(this.i18n.t('Escribe el motivo del rechazo.'));
      return;
    }
    this.guardando.set(true);
    this.ocultar(e.id);
    try {
      await this.combustible.decidirEchada(e.id, 'rechazar', { motivo });
      this.toast.success(this.online ? this.i18n.t('Echada rechazada.') : this.i18n.t('Rechazada — se enviará al reconectar.'));
      this.rechazando.set(null);
    } catch {
      this.toast.error(this.i18n.t('No se pudo rechazar. Intenta de nuevo.'));
      this.reintentar();
    } finally {
      this.guardando.set(false);
    }
  }

  get online(): boolean {
    return this.network.online();
  }

  back(): void {
    this.location.back();
  }
}
