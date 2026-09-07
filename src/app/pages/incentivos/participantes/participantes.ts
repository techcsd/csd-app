import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { ToggleSwitch } from '../../../shared/ui/toggle-switch/toggle-switch';
import { SelectOption } from '../../../shared/ui/select-list/select-list';
import { ToastService } from '../../../core/services/toast.service';
import {
  IncentivoGestionService,
  IncentivoParticipante,
  IncentivoCandidato,
} from '../../../core/services/incentivo-gestion.service';

/**
 * BK3 — "Participantes del Desempeño" (Raykler/logística + gerencia + admin). El
 * padrón vive keyed en USUARIOS (no en conductores), así entra alguien sin el rol
 * chofer (Misael: jefe_flota) y `es_chofer` se marca como DATO ("cuenta para el
 * pago"), no como rol. Solo `es_chofer && participa` puntúa (lo gatea el motor
 * server-side). Se auto-gatea con `puede_gestionar_incentivos()` (sin moduleGuard),
 * igual que la pantalla de gestión (AT3).
 */
@Component({
  selector: 'app-incentivo-participantes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, CollapsibleSelect, ToggleSwitch],
  templateUrl: './participantes.html',
  styleUrl: './participantes.scss',
})
export class IncentivoParticipantesPage {
  private service = inject(IncentivoGestionService);
  private toast = inject(ToastService);
  private location = inject(Location);

  /** Gate. */
  checkingAccess = signal(true);
  hasAccess = signal(false);

  loading = signal(true);
  participantes = signal<IncentivoParticipante[]>([]);
  candidatos = signal<IncentivoCandidato[]>([]);
  /** usuario_id en proceso de guardado (bloquea sus toggles). */
  savingIds = signal<Set<string>>(new Set());
  /** usuario_id que se está agregando desde el picker. */
  agregandoId = signal<string>('');

  /** Opciones del picker "Agregar persona". */
  candidatoOptions = computed<SelectOption[]>(() =>
    this.candidatos().map((c) => ({ id: c.usuario_id, label: c.nombre })),
  );

  /** Cuántas personas cuentan HOY para el pago (es_chofer && participa). */
  cuentanPago = computed(
    () => this.participantes().filter((p) => p.es_chofer && p.participa).length,
  );

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    this.checkingAccess.set(true);
    try {
      const ok = await this.service.puedeGestionar();
      this.hasAccess.set(ok);
      if (ok) await this.cargar();
    } catch (e) {
      this.hasAccess.set(false);
      this.toast.error(e instanceof Error ? e.message : 'No pudimos verificar el acceso.');
    } finally {
      this.checkingAccess.set(false);
    }
  }

  private async cargar(): Promise<void> {
    this.loading.set(true);
    try {
      const [padron, cands] = await Promise.all([
        this.service.participantes(),
        this.service.candidatos(),
      ]);
      this.participantes.set(padron);
      this.candidatos.set(cands);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No pudimos cargar el padrón.');
    } finally {
      this.loading.set(false);
    }
  }

  saving(id: string): boolean {
    return this.savingIds().has(id);
  }
  private setSaving(id: string, on: boolean): void {
    this.savingIds.update((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** Toggle "Participa" (dentro/fuera del incentivo), preservando es_chofer. */
  async toggleParticipa(p: IncentivoParticipante, participa: boolean): Promise<void> {
    await this.guardar(p, participa, p.es_chofer);
  }
  /** Toggle "Cuenta para el pago" (es_chofer), preservando participa. */
  async toggleChofer(p: IncentivoParticipante, esChofer: boolean): Promise<void> {
    await this.guardar(p, p.participa, esChofer);
  }

  private async guardar(
    p: IncentivoParticipante,
    participa: boolean,
    esChofer: boolean,
  ): Promise<void> {
    if (this.saving(p.usuario_id)) return;
    this.setSaving(p.usuario_id, true);
    // optimista
    this.participantes.update((list) =>
      list.map((x) => (x.usuario_id === p.usuario_id ? { ...x, participa, es_chofer: esChofer } : x)),
    );
    try {
      await this.service.setParticipante(p.usuario_id, participa, esChofer, null);
    } catch (e) {
      // rollback al estado previo
      this.participantes.update((list) =>
        list.map((x) =>
          x.usuario_id === p.usuario_id
            ? { ...x, participa: p.participa, es_chofer: p.es_chofer }
            : x,
        ),
      );
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar el cambio.');
    } finally {
      this.setSaving(p.usuario_id, false);
    }
  }

  /** Agrega una persona nueva al padrón (entra participando; chofer se marca luego). */
  async agregar(usuarioId: string): Promise<void> {
    if (!usuarioId || this.agregandoId()) return;
    this.agregandoId.set(usuarioId);
    try {
      await this.service.setParticipante(usuarioId, true, false, null);
      const nombre = this.candidatos().find((c) => c.usuario_id === usuarioId)?.nombre ?? 'La persona';
      this.toast.success(`${nombre} entró al padrón. Marca "cuenta para el pago" si es chofer.`);
      await this.cargar();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo agregar la persona.');
    } finally {
      this.agregandoId.set('');
    }
  }

  back(): void {
    this.location.back();
  }
}
