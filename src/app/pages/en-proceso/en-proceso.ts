import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { BorradorService } from '../../core/services/borrador.service';
import { AutosaveService } from '../../core/services/autosave.service';
import { SyncService } from '../../core/sync/sync.service';
import { NetworkService } from '../../core/services/network.service';
import { ToastService } from '../../core/services/toast.service';
import { CombustibleAvisoService } from '../../core/services/combustible-aviso.service';
import {
  EnProcesoService,
  EnProcesoItem,
  EnProcesoModulo,
} from '../../core/services/en-proceso.service';
import { outboxCategoria } from '../../core/util/outbox-categoria';
import { formatFechaCortaHora } from '../../core/util/fecha';

/**
 * Y10 — "Documentación en proceso" coherente: dos grupos etiquetados —
 * "A medio llenar" (borradores Dexie, con Retomar/Descartar) y "Pendientes de
 * envío" (items del outbox con su estado; las acciones de reintentar/descartar
 * viven en /pendientes, que reutilizamos). El contenido = exactamente lo que
 * cuentan los badges (EnProcesoService), así el badge nunca miente.
 */
@Component({
  selector: 'app-en-proceso',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyState, Skeleton, ConfirmDialog, TranslatePipe],
  templateUrl: './en-proceso.html',
  styleUrl: './en-proceso.scss',
})
export class EnProcesoPage {
  private enProceso = inject(EnProcesoService);
  private borrador = inject(BorradorService);
  private autosave = inject(AutosaveService);
  private sync = inject(SyncService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private combustibleAviso = inject(CombustibleAvisoService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);

  /** Filtro opcional por módulo (?modulo=flota|bitacora) para casar con el badge del cuadro. */
  private modulo: EnProcesoModulo | null = null;

  online = this.network.online;

  loading = signal(true);
  items = signal<EnProcesoItem[]>([]);
  confirmar = signal<EnProcesoItem | null>(null);
  /** BR6 — envío que se está por descartar desde la tarjeta (mensaje distinto al del borrador). */
  confirmarEnvio = signal<EnProcesoItem | null>(null);
  /** BR6 — envío al que se le está avisando a Logística (evita doble toque). */
  avisandoId = signal<string | null>(null);

  borradores = computed(() => this.items().filter((i) => i.kind === 'borrador'));
  envios = computed(() => this.items().filter((i) => i.kind === 'envio'));

  constructor() {
    const m = this.route.snapshot.queryParamMap.get('modulo');
    this.modulo = m === 'flota' || m === 'bitacora' ? m : null;
    // Refresca al entrar y con cada cambio del outbox (drena/encola/error) para
    // que la vista siga cuadrando con el badge en vivo.
    effect(() => {
      this.sync.changed();
      void this.load();
    });
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      // S5 — migra el borrador legacy 'parte_diario' a clave por instancia.
      await this.borrador.migrateLegacyParte();
      const list = this.modulo
        ? await this.enProceso.list(this.modulo)
        : await this.enProceso.listAll();
      this.items.set(list);
    } finally {
      this.loading.set(false);
    }
  }

  /** Y1 — fecha + hora del último guardado ("23/07 · 6:41 pm"). */
  fmt(ms: number): string {
    return formatFechaCortaHora(ms);
  }

  retomar(b: EnProcesoItem): void {
    if (!b.ruta) {
      this.location.back();
      return;
    }
    const [path] = b.ruta.split('?');
    if (b.resumePorClave) {
      void this.router.navigate([path], { queryParams: { borrador: b.id } });
    } else {
      void this.router.navigateByUrl(b.ruta);
    }
  }

  /** Abre el detalle de ESTE envío en Pendientes (contenido + reintentar/duplicar/descartar). */
  verEnvio(e: EnProcesoItem): void {
    void this.router.navigate(['/pendientes', e.id]);
  }
  /** Fallback (sin item): la lista completa de Pendientes. */
  verPendientes(): void {
    void this.router.navigate(['/pendientes']);
  }

  // ── BR6 — acciones inline en la tarjeta del envío con problema ──────────────
  // La regla madre (BG1): la data real de obra NUNCA se descarta a la ligera. Un
  // envío 'sistema' o con foto perdida NO ofrece Descartar en la tarjeta — su
  // descarte vive en la vista de contenido (doble confirmación). Aquí solo se
  // descartan los rechazos de DATO y los transitorios (mismo criterio que /pendientes).

  private categoria(e: EnProcesoItem) {
    return e.op ? outboxCategoria(e.op) : 'transitorio';
  }
  /** BI7 — 'sistema' o foto perdida = data real: no se descarta desde la tarjeta. */
  private esConservable(e: EnProcesoItem): boolean {
    if (!e.op || e.op.estado !== 'error') return false;
    return this.categoria(e) === 'sistema' || e.op.error_kind === 'foto';
  }
  /** ¿Se puede descartar este envío desde la tarjeta? (no conservable + permanente). */
  puedeDescartarEnvio(e: EnProcesoItem): boolean {
    if (!e.op || e.op.estado !== 'error') return false;
    if (this.esConservable(e)) return false;
    return e.op.permanente === true;
  }

  /** BR6 — reintentar este envío ahora (sin ir a Pendientes). */
  reintentarEnvio(e: EnProcesoItem): void {
    if (!this.online()) {
      this.toast.error('Sin señal ahora mismo. Se reintentará solo cuando vuelva.');
      return;
    }
    void this.sync.retry(e.id);
    this.toast.show('Reintentando el envío…', 'info');
  }

  pedirDescartarEnvio(e: EnProcesoItem): void {
    this.confirmarEnvio.set(e);
  }
  async descartarEnvio(): Promise<void> {
    const e = this.confirmarEnvio();
    this.confirmarEnvio.set(null);
    if (!e) return;
    await this.sync.discard(e.id);
    this.items.update((list) => list.filter((x) => !(x.kind === 'envio' && x.id === e.id)));
  }

  // ── BR6 corolario (regla 15) — un rechazo de NEGOCIO ofrece "Avisar a Logística" ──
  /** ¿Es una echada de combustible rechazada por dato (negocio)? Entonces Raykler
   *  puede registrarla él: le mandamos el resumen del dato. */
  esCombustibleNegocio(e: EnProcesoItem): boolean {
    return !!e.op && e.op.estado === 'error' && e.op.tipo_op === 'combustible' && this.categoria(e) === 'dato';
  }
  async avisarLogistica(e: EnProcesoItem): Promise<void> {
    if (!e.op || this.avisandoId()) return;
    if (!this.online()) {
      this.toast.error('Necesitas conexión para avisarle a Logística.');
      return;
    }
    this.avisandoId.set(e.id);
    try {
      await this.combustibleAviso.avisarRevision(e.op);
      this.toast.success('Logística (Raykler) recibió el aviso. Podrá registrar la echada por ti.');
    } catch (err) {
      // Capability check: si el RPC del padre aún no está desplegado, no rompemos —
      // le decimos al chofer qué hacer (mensaje honesto).
      this.toast.error(
        err instanceof Error && err.message
          ? err.message
          : 'No se pudo avisar automáticamente. Coméntale a Logística que registre esta echada.',
      );
    } finally {
      this.avisandoId.set(null);
    }
  }

  pedirDescartar(b: EnProcesoItem): void {
    this.confirmar.set(b);
  }

  async descartar(): Promise<void> {
    const b = this.confirmar();
    this.confirmar.set(null);
    if (!b) return;
    await this.autosave.discard(b.id); // b.id = clave del borrador
    this.items.update((list) => list.filter((x) => !(x.kind === 'borrador' && x.id === b.id)));
  }

  back(): void {
    this.location.back();
  }
}
