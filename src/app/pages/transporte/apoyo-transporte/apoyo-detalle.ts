import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ApoyoService, ApoyoDetalle, TipoApoyo, EstadoApoyo } from '../../../core/services/apoyo.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatFecha, formatFechaCortaHora } from '../../../core/util/fecha';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';

const TIPO_LABEL: Record<TipoApoyo, string> = {
  movimiento_interno: 'Movimiento interno',
  retiro_material: 'Retiro de material',
  bote: 'Bote',
};
const ESTADO_LABEL: Record<EstadoApoyo, string> = {
  pendiente: 'Pendiente',
  asignada: 'Asignada',
  en_proceso: 'En proceso',
  por_confirmar: 'Por confirmar',
  completada: 'Completada',
  cancelada: 'Cancelada',
};

/** Una acción de cambio de estado ofrecida en la ficha (CK13). */
interface AccionEstado {
  estado: EstadoApoyo;
  label: string;
  nota: 'none' | 'optional' | 'required';
  notaLabel?: string;
  tone: 'primary' | 'ghost';
}

/**
 * CK13 — ficha de un apoyo de transporte: chips, fotos, destino, línea de tiempo de
 * estados y los botones para que el SOLICITANTE (o un rol elevado) cambie el estado.
 * Todo cambio va por el outbox (offline); el servidor valida la matriz por rol y sus
 * mensajes humanos se muestran tal cual.
 */
@Component({
  selector: 'app-apoyo-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, TranslatePipe],
  templateUrl: './apoyo-detalle.html',
  styleUrl: './apoyo-detalle.scss',
})
export class ApoyoDetallePage {
  private apoyo = inject(ApoyoService);
  private ctx = inject(UserContextService);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private i18n = inject(I18nService);

  fmtFecha = formatFecha;
  fmtFechaHora = formatFechaCortaHora;
  tipoLabel = (t: TipoApoyo) => TIPO_LABEL[t] ?? t;
  // Acepta string (los eventos traen `a` como texto crudo).
  estadoLabel = (e: string) => ESTADO_LABEL[e as EstadoApoyo] ?? e;

  readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  loading = signal(true);
  detalle = signal<ApoyoDetalle | null>(null);

  // Panel de nota para las acciones que la piden/ofrecen.
  accion = signal<AccionEstado | null>(null);
  nota = signal('');
  guardando = signal(false);

  /** ¿El usuario puede cambiar el estado? (solicitante o rol elevado). */
  puedeCambiar = computed(() => {
    const d = this.detalle();
    if (!d) return false;
    const uid = this.ctx.profile()?.id ?? null;
    const esMio = !!uid && (d.solicitante_id === uid || d.created_by === uid);
    return esMio || this.ctx.esFlotaElevado();
  });

  /** CK13 — acciones ofrecidas según el estado actual. */
  acciones = computed<AccionEstado[]>(() => {
    const d = this.detalle();
    if (!d) return [];
    const out: AccionEstado[] = [];
    if (d.estado === 'pendiente' || d.estado === 'asignada') {
      out.push({ estado: 'cancelada', label: 'Cancelar', nota: 'optional', notaLabel: 'Motivo (opcional)', tone: 'ghost' });
    }
    if (d.estado === 'asignada' || d.estado === 'en_proceso') {
      out.push({ estado: 'en_proceso', label: 'Marcar en proceso', nota: 'none', tone: 'ghost' });
      out.push({ estado: 'completada', label: 'Ya se hizo — Completar', nota: 'none', tone: 'primary' });
    }
    if (d.estado === 'por_confirmar') {
      out.push({ estado: 'completada', label: 'Confirmar que se hizo', nota: 'none', tone: 'primary' });
      out.push({ estado: 'en_proceso', label: 'No se ha hecho', nota: 'required', notaLabel: 'Escribe por qué aún no se ha hecho', tone: 'ghost' });
    }
    return out;
  });

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.detalle.set(await this.apoyo.detalle(this.id));
    } catch {
      this.toast.error(this.i18n.t('No pudimos cargar el apoyo.'));
    } finally {
      this.loading.set(false);
    }
  }

  tocarAccion(a: AccionEstado): void {
    if (a.nota === 'none') {
      void this.aplicar(a, null);
    } else {
      this.nota.set('');
      this.accion.set(a);
    }
  }

  cancelarPanel(): void {
    this.accion.set(null);
    this.nota.set('');
  }

  async confirmarPanel(): Promise<void> {
    const a = this.accion();
    if (!a) return;
    const nota = this.nota().trim();
    if (a.nota === 'required' && !nota) {
      this.toast.error(this.i18n.t('Escribe una nota para continuar.'));
      return;
    }
    await this.aplicar(a, nota || null);
  }

  private async aplicar(a: AccionEstado, nota: string | null): Promise<void> {
    if (this.guardando()) return;
    this.guardando.set(true);
    try {
      await this.apoyo.cambiarEstado(this.id, a.estado, nota);
      // Optimista: el cambio va por outbox; reflejamos el nuevo estado ya.
      this.detalle.update((d) => (d ? { ...d, estado: a.estado } : d));
      this.accion.set(null);
      this.nota.set('');
      this.toast.success(this.i18n.t('Listo. Se sincroniza solo al reconectar.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No pudimos cambiar el estado.'));
    } finally {
      this.guardando.set(false);
    }
  }

  back(): void {
    this.navGuard.back('/transporte/apoyo');
  }
}
