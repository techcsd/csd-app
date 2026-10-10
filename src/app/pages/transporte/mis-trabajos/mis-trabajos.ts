import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { BottomSheet } from '../../../shared/ui/bottom-sheet/bottom-sheet';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { LiveRefreshDirective } from '../../../shared/ui/live-refresh/live-refresh.directive';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { TrabajosService, TrabajoRow, TrabajoEvento } from '../../../core/services/trabajos.service';
import { ToastService } from '../../../core/services/toast.service';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { formatFecha } from '../../../core/util/fecha';

/** CK14 — etiqueta del tipo de trabajo (escaneable). */
const TIPO_LABEL: Record<string, string> = {
  movimiento_interno: 'Movimiento interno',
  retiro_material: 'Retiro de material',
  bote: 'Bote',
  conduce: 'Conduce',
  actividad: 'Actividad',
};
const TIPO_ICON: Record<string, string> = {
  movimiento_interno: '📦',
  retiro_material: '♻️',
  bote: '🗑️',
  conduce: '🧾',
  actividad: '📋',
};

/** CK14 — etiqueta/ícono de cada evento del flujo. */
const EVENTO_LABEL: Record<TrabajoEvento, string> = {
  en_camino: 'Voy en camino',
  llegue: 'Llegué',
  trabajando: 'Cargando / trabajando',
  termine: 'Terminé',
  problema: 'Tengo un problema',
};
const EVENTO_ICON: Record<TrabajoEvento, string> = {
  en_camino: '🚗',
  llegue: '📍',
  trabajando: '🛠️',
  termine: '✅',
  problema: '⚠️',
};

const ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  asignada: 'Asignado',
  en_proceso: 'En proceso',
  por_confirmar: 'Esperando confirmación',
  completada: 'Completado',
  cancelada: 'Cancelado',
};

/**
 * CK14 — "Mis trabajos" del chofer. Una tarjeta por ticket asignado con sus datos
 * (tipo, obra, día, descripción, fotos, nota de Misael, solicitante + Llamar) y los
 * botones de avance en orden: "Voy en camino" → "Llegué" → "Cargando / trabajando" →
 * "Terminé" + "Tengo un problema". Cada toque va por el outbox (hora real + GPS).
 */
@Component({
  selector: 'app-mis-trabajos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, BottomSheet, PhotoSlot, LiveRefreshDirective, TranslatePipe],
  templateUrl: './mis-trabajos.html',
  styleUrl: './mis-trabajos.scss',
})
export class MisTrabajosPage {
  private trabajosSvc = inject(TrabajosService);
  private toast = inject(ToastService);
  private location = inject(Location);

  fmtDia = formatFecha;

  /** Glifos de la pantalla. Igual que el design system (big-button/TILES toman el
   *  icono desde TS): las plantillas no llevan emojis literales (guarda AW12). */
  readonly glyph = {
    header: '🚚',
    refresh: '🔄',
    empty: '✅',
    obra: '🏗️',
    dia: '📅',
    nota: '💬',
    quien: '👤',
    llamar: '📞',
    pendiente: '⏳',
    problema: '⚠️',
    foto: '📸',
    termine: '✅',
  };

  loading = signal(true);
  refrescando = signal(false);
  trabajos = signal<TrabajoRow[]>([]);
  enviando = signal(false);

  // Hojas inferiores: "Terminé" (foto + nota opcional) y "Problema" (texto obligatorio).
  terminando = signal<TrabajoRow | null>(null);
  problema = signal<TrabajoRow | null>(null);
  terminePhoto = signal<CapturedPhoto | null>(null);
  termineNota = signal('');
  problemaTexto = signal('');

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.trabajos.set(await this.trabajosSvc.misTrabajos());
    } finally {
      this.loading.set(false);
    }
  }

  async refrescar(): Promise<void> {
    this.refrescando.set(true);
    try {
      await this.trabajosSvc.invalidar();
      this.trabajos.set(await this.trabajosSvc.misTrabajos());
    } finally {
      this.refrescando.set(false);
    }
  }

  // ── Etiquetas ──────────────────────────────────────────────────────────────
  tipoLabel(t: TrabajoRow): string {
    return TIPO_LABEL[t.tipo] ?? 'Trabajo';
  }
  tipoIcon(t: TrabajoRow): string {
    return TIPO_ICON[t.tipo] ?? '🚚';
  }
  estadoLabel(t: TrabajoRow): string {
    return ESTADO_LABEL[t.estado] ?? t.estado;
  }
  eventoLabel(e: TrabajoEvento): string {
    return EVENTO_LABEL[e];
  }
  eventoIcon(e: TrabajoEvento): string {
    return EVENTO_ICON[e];
  }

  /** ¿El ticket ya está cerrado para el chofer (no hay más acciones de avance)? */
  terminado(t: TrabajoRow): boolean {
    return (
      t.ultimoEvento === 'termine' ||
      t.estado === 'por_confirmar' ||
      t.estado === 'completada' ||
      t.estado === 'cancelada'
    );
  }

  /** El siguiente evento de avance a ofrecer (null si ya terminó/cancelado). */
  siguiente(t: TrabajoRow): TrabajoEvento | null {
    if (this.terminado(t)) return null;
    return this.trabajosSvc.siguienteEvento(t.ultimoEvento);
  }

  /** ¿Mostrar el botón "Tengo un problema"? (siempre que no esté cerrado). */
  puedeProblema(t: TrabajoRow): boolean {
    return t.estado !== 'completada' && t.estado !== 'cancelada';
  }

  // ── Acciones ───────────────────────────────────────────────────────────────
  /** Botón de avance: "Terminé" abre su hoja; el resto reporta directo. */
  avanzar(t: TrabajoRow): void {
    const ev = this.siguiente(t);
    if (!ev) return;
    if (ev === 'termine') {
      this.abrirTermine(t);
    } else {
      void this.enviar(t, ev);
    }
  }

  abrirTermine(t: TrabajoRow): void {
    this.termineNota.set('');
    this.limpiarTerminePhoto();
    this.terminando.set(t);
  }
  abrirProblema(t: TrabajoRow): void {
    this.problemaTexto.set('');
    this.problema.set(t);
  }

  onTermineCaptured(photo: CapturedPhoto): void {
    this.limpiarTerminePhoto();
    this.terminePhoto.set(photo);
  }
  onTermineCleared(): void {
    this.limpiarTerminePhoto();
  }
  private limpiarTerminePhoto(): void {
    const prev = this.terminePhoto();
    if (prev) URL.revokeObjectURL(prev.previewUrl);
    this.terminePhoto.set(null);
  }

  async confirmarTermine(): Promise<void> {
    const t = this.terminando();
    if (!t) return;
    await this.enviar(t, 'termine', this.termineNota().trim() || null, this.terminePhoto()?.blob ?? null);
  }

  async confirmarProblema(): Promise<void> {
    const t = this.problema();
    if (!t) return;
    const texto = this.problemaTexto().trim();
    if (!texto) {
      this.toast.error('Escribe qué pasó.');
      return;
    }
    await this.enviar(t, 'problema', texto);
  }

  private async enviar(
    t: TrabajoRow,
    evento: TrabajoEvento,
    nota: string | null = null,
    foto: Blob | null = null,
  ): Promise<void> {
    if (this.enviando()) return;
    this.enviando.set(true);
    try {
      await this.trabajosSvc.reportarEvento({
        origen: t.origen,
        origenId: t.origenId,
        evento,
        nota,
        foto,
      });
      this.toast.success(evento === 'problema' ? 'Reportamos tu problema.' : 'Listo, lo registramos.');
      this.cerrarSheets();
      await this.load();
    } catch (e) {
      this.toast.error((e as Error)?.message || 'No se pudo enviar. Quedó en cola.');
    } finally {
      this.enviando.set(false);
    }
  }

  cerrarSheets(): void {
    this.limpiarTerminePhoto();
    this.terminando.set(null);
    this.problema.set(null);
  }

  /** Llamada telefónica al solicitante (tel:). */
  llamar(tel: string | null): void {
    if (!tel) return;
    window.location.href = `tel:${tel}`;
  }

  back(): void {
    this.location.back();
  }
}
