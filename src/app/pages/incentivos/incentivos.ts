import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { CollapsibleSelect } from '../../shared/ui/collapsible-select/collapsible-select';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { SelectOption } from '../../shared/ui/select-list/select-list';
import { ToastService } from '../../core/services/toast.service';
import {
  IncentivoGestionService,
  IncentivoGestionFila,
  IncentivoGestionSemana,
} from '../../core/services/incentivo-gestion.service';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * AT3 — "Gestión del incentivo" (Raykler/logística + Eduardo/gerencia + admin):
 * aprobar o declinar el incentivo de cada chofer, semana por semana. El informe
 * se calcula server-side, pero **no paga solo**: aprobar es una decisión humana
 * que queda registrada. La pantalla se auto-gatea con `puede_gestionar_incentivos()`
 * (quien no tenga permiso ve "Sin acceso"), así que no necesita moduleGuard.
 */
@Component({
  selector: 'app-incentivos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, CollapsibleSelect, ConfirmDialog],
  templateUrl: './incentivos.html',
  styleUrl: './incentivos.scss',
})
export class IncentivosPage {
  private service = inject(IncentivoGestionService);
  private toast = inject(ToastService);
  private location = inject(Location);

  /** Gate. */
  checkingAccess = signal(true);
  hasAccess = signal(false);

  loadingSemanas = signal(true);
  semanas = signal<IncentivoGestionSemana[]>([]);
  /** clave de la semana elegida: `anio-semana`. */
  selectedKey = signal<string>('');

  loadingList = signal(false);
  filas = signal<IncentivoGestionFila[]>([]);
  /** informe_id que se están guardando (bloquea sus botones). */
  savingIds = signal<Set<string>>(new Set());

  /** Confirmación de "aprobar todos los que cumplieron". */
  confirmAllOpen = signal(false);
  savingAll = signal(false);

  /** Fila en proceso de declinar (abre el modal con el motivo). */
  declinarFila = signal<IncentivoGestionFila | null>(null);
  declinarMotivo = signal('');

  /** Opciones del dropdown de semanas. */
  semanaOptions = computed<SelectOption[]>(() =>
    this.semanas().map((s) => ({
      id: `${s.anio}-${s.semana}`,
      label: `Semana ${s.semana} · ${this.rango(s)} (${s.choferes} chofer${s.choferes === 1 ? '' : 'es'} · ${s.cumplieron} cumplieron)`,
    })),
  );

  /** Semana actualmente seleccionada. */
  selectedSemana = computed<IncentivoGestionSemana | null>(
    () => this.semanas().find((s) => `${s.anio}-${s.semana}` === this.selectedKey()) ?? null,
  );

  /** Choferes que cumplieron pero siguen pendientes (los que aprobaría el bulk). */
  cumplieronPendientes = computed(
    () => this.filas().filter((f) => f.cumplio && !f.decision).length,
  );

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    this.checkingAccess.set(true);
    try {
      const ok = await this.service.puedeGestionar();
      this.hasAccess.set(ok);
      if (ok) await this.cargarSemanas();
    } catch (e) {
      this.hasAccess.set(false);
      this.toast.error(e instanceof Error ? e.message : 'No pudimos verificar el acceso.');
    } finally {
      this.checkingAccess.set(false);
    }
  }

  private async cargarSemanas(): Promise<void> {
    this.loadingSemanas.set(true);
    try {
      const semanas = await this.service.semanas();
      this.semanas.set(semanas);
      const first = semanas[0];
      if (first) {
        this.selectedKey.set(`${first.anio}-${first.semana}`);
        await this.cargarListado();
      }
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No pudimos cargar las semanas.');
    } finally {
      this.loadingSemanas.set(false);
    }
  }

  private async cargarListado(): Promise<void> {
    const s = this.selectedSemana();
    if (!s) {
      this.filas.set([]);
      return;
    }
    this.loadingList.set(true);
    try {
      this.filas.set(await this.service.listado(s.anio, s.semana));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No pudimos cargar el listado.');
    } finally {
      this.loadingList.set(false);
    }
  }

  onSemanaPicked(key: string): void {
    if (key === this.selectedKey()) return;
    this.selectedKey.set(key);
    void this.cargarListado();
  }

  // ── Decisiones ──────────────────────────────────────────────────────────────
  saving(informeId: string): boolean {
    return this.savingIds().has(informeId);
  }
  private setSaving(informeId: string, on: boolean): void {
    this.savingIds.update((set) => {
      const next = new Set(set);
      if (on) next.add(informeId);
      else next.delete(informeId);
      return next;
    });
  }

  /** Aprobar una fila (motivo opcional; aquí sin nota). */
  async aprobar(fila: IncentivoGestionFila): Promise<void> {
    if (this.saving(fila.informe_id)) return;
    this.setSaving(fila.informe_id, true);
    try {
      await this.service.decidir(fila.informe_id, 'aprobado', null);
      this.toast.success(`Incentivo de ${fila.nombre} aprobado.`);
      await this.cargarListado();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No pudimos aprobar el incentivo.');
    } finally {
      this.setSaving(fila.informe_id, false);
    }
  }

  /** Abre el modal para declinar (pide motivo obligatorio). */
  abrirDeclinar(fila: IncentivoGestionFila): void {
    this.declinarMotivo.set('');
    this.declinarFila.set(fila);
  }
  cerrarDeclinar(): void {
    this.declinarFila.set(null);
    this.declinarMotivo.set('');
  }

  async confirmarDeclinar(): Promise<void> {
    const fila = this.declinarFila();
    if (!fila) return;
    const motivo = this.declinarMotivo().trim();
    if (!motivo) {
      this.toast.error('El motivo es obligatorio para declinar.');
      return;
    }
    this.setSaving(fila.informe_id, true);
    try {
      await this.service.decidir(fila.informe_id, 'declinado', motivo);
      this.toast.success(`Incentivo de ${fila.nombre} declinado.`);
      this.cerrarDeclinar();
      await this.cargarListado();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No pudimos declinar el incentivo.');
    } finally {
      this.setSaving(fila.informe_id, false);
    }
  }

  // ── Aprobar todos los que cumplieron ─────────────────────────────────────────
  pedirAprobarTodos(): void {
    this.confirmAllOpen.set(true);
  }
  cancelarAprobarTodos(): void {
    this.confirmAllOpen.set(false);
  }
  async aprobarTodos(): Promise<void> {
    const s = this.selectedSemana();
    if (!s) return;
    this.confirmAllOpen.set(false);
    this.savingAll.set(true);
    try {
      await this.service.aprobarCumplieron(s.anio, s.semana);
      this.toast.success('Se aprobaron todos los que cumplieron el mínimo.');
      await this.cargarListado();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No pudimos aprobar en bloque.');
    } finally {
      this.savingAll.set(false);
    }
  }

  // ── Helpers de presentación ──────────────────────────────────────────────────
  /** Rango compacto de la semana: "4–10 ago" (o "30 jul–3 ago" si cruza mes). */
  rango(s: IncentivoGestionSemana): string {
    const pi = s.inicio.slice(0, 10).split('-');
    const pf = s.fin.slice(0, 10).split('-');
    const di = Number(pi[2]);
    const df = Number(pf[2]);
    const mi = MESES[Number(pi[1]) - 1] ?? '';
    const mf = MESES[Number(pf[1]) - 1] ?? '';
    if (pi[1] === pf[1]) return `${di}–${df} ${mf}`;
    return `${di} ${mi}–${df} ${mf}`;
  }

  decisionLabel(f: IncentivoGestionFila): string {
    if (f.decision === 'aprobado') return 'Aprobado';
    if (f.decision === 'declinado') return 'Declinado';
    return 'Pendiente';
  }

  /** ¿La fila tiene flags anti-inflado que ameritan revisión? */
  tieneFlags(f: IncentivoGestionFila): boolean {
    return !!f.flags && Object.keys(f.flags).length > 0;
  }

  /** timestamptz → "14 jul, 3:45 pm" compacto para el chip de decisión. */
  fmtDecidido(ts: string | null): string {
    if (!ts) return '';
    const dt = new Date(ts);
    if (isNaN(dt.getTime())) return '';
    let h = dt.getHours();
    const min = String(dt.getMinutes()).padStart(2, '0');
    const period = h >= 12 ? 'pm' : 'am';
    h = h % 12;
    if (h === 0) h = 12;
    return `${dt.getDate()} ${MESES[dt.getMonth()]}, ${h}:${min} ${period}`;
  }

  back(): void {
    this.location.back();
  }
}
