import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { SyncBadge } from '../../shared/ui/sync-badge/sync-badge';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { SyncService } from '../../core/sync/sync.service';
import { NetworkService } from '../../core/services/network.service';
import { OutboxOp } from '../../core/db/app-db';
import { formatFechaRelativa } from '../../core/util/fecha';

type OutboxItem = OutboxOp & { fotos: number };

// P5 — etiqueta en español para cada tipo de operación del outbox.
const TIPO_LABEL: Record<string, string> = {
  bitacora: 'Parte / incidente de bitácora',
  checklist_preuso: 'Pre-uso de vehículo',
  vehiculo_entrega: 'Entrega / recepción de vehículo',
  mantenimiento: 'Mantenimiento de vehículo',
  combustible: 'Combustible',
  crear_ruta: 'Ruta creada',
  conduce_entrega: 'Entrega de conduce',
  conduce_recepcion: 'Recepción de conduce',
  cl_liberacion: 'Liberación de checklist',
  inv_entrada: 'Entrada de inventario',
  inv_devolucion_obra: 'Devolución de obra',
  inv_salida: 'Salida de inventario',
  inv_conteo: 'Conteo de inventario',
  solicitud: 'Requisición de materiales',
  reporte: 'Reporte',
  reporte_semanal: 'Reporte semanal',
  documento_upload: 'Documento (cédula / licencia)',
};

const TIPO_ICON: Record<string, string> = {
  bitacora: '📓',
  checklist_preuso: '📋',
  vehiculo_entrega: '🚚',
  mantenimiento: '🔧',
  combustible: '⛽',
  crear_ruta: '🗺️',
  conduce_entrega: '📦',
  conduce_recepcion: '📥',
  cl_liberacion: '✅',
  inv_entrada: '📥',
  inv_devolucion_obra: '🏗️',
  inv_salida: '📤',
  inv_conteo: '🔢',
  solicitud: '🛒',
  reporte: '📝',
  reporte_semanal: '📊',
  documento_upload: '🪪',
};

/**
 * P5 — "Pendientes de envío". Diagnóstico visible del outbox: cada captura sin
 * enviar con su tipo, fecha, estado, intentos y el error TRADUCIDO a español.
 * Acciones por item: reintentar; y para errores permanentes, ver detalle y
 * descartar (conservando registro local para no perder datos en silencio).
 */
@Component({
  selector: 'app-pendientes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, SyncBadge, ConfirmDialog],
  templateUrl: './pendientes.html',
  styleUrl: './pendientes.scss',
})
export class PendientesPage {
  private sync = inject(SyncService);
  private network = inject(NetworkService);
  private location = inject(Location);

  items = signal<OutboxItem[]>([]);
  loading = signal(true);
  expandido = signal<string | null>(null);
  confirmarDescartarId = signal<string | null>(null);

  online = this.network.online;
  fmt = formatFechaRelativa;

  constructor() {
    // Se refresca sola ante cualquier cambio del outbox (envío, error, descarte).
    effect(() => {
      this.sync.changed();
      void this.load();
    });
  }

  private async load(): Promise<void> {
    try {
      this.items.set(await this.sync.listOutbox());
    } finally {
      this.loading.set(false);
    }
  }

  hayReintentables(): boolean {
    // W1 — solo los errores transitorios (no permanentes) se pueden reintentar.
    return this.items().some((i) => i.estado === 'error' && !i.permanente);
  }

  /** S30 — un pending/syncing lleva demasiado tiempo atascado (>24h). */
  private readonly VIEJO_MS = 24 * 60 * 60 * 1000;
  esViejo(item: OutboxItem): boolean {
    return item.estado !== 'error' && Date.now() - item.created_local > this.VIEJO_MS;
  }
  /** S30 — se puede descartar: error permanente, o pending atascado >24h. */
  puedeDescartar(item: OutboxItem): boolean {
    return item.permanente === true || this.esViejo(item);
  }

  tipoLabel(t: string): string {
    return TIPO_LABEL[t] ?? t;
  }
  tipoIcon(t: string): string {
    return TIPO_ICON[t] ?? '📄';
  }

  /** P5 — error técnico → mensaje entendible en español según su familia. */
  mensajeError(item: OutboxItem): string {
    if (item.estado !== 'error' && !item.error_msg) return '';
    switch (item.error_kind) {
      case 'permiso':
        return 'No tienes permiso para enviar esto. Contacta a un administrador.';
      case 'referencia':
        return 'Hace referencia a algo que ya no existe o está duplicado.';
      case 'no-encontrado':
        return 'El destino ya no existe en el sistema.';
      case 'conflicto':
        return 'Este envío ya había sido registrado antes.';
      case 'datos':
        return 'Hay un dato con formato inválido en el registro.';
      case 'foto':
        return 'La foto ya no está disponible en el teléfono. Descártalo y vuelve a capturarlo.';
      case 'incompatible':
        return 'No se pudo procesar (posible desajuste de versión con el servidor). Descártalo; si vuelve a pasar, actualiza la app.';
      case 'red':
        return 'Sin conexión estable. Se reintentará solo cuando vuelva la señal.';
      case 'validacion':
        // El RPC devuelve un mensaje ya en español; se muestra tal cual.
        return item.error_msg || 'El sistema rechazó los datos de este registro.';
      default:
        return item.error_msg || 'No se pudo enviar. Intenta de nuevo o descártalo.';
    }
  }

  /**
   * W1 — detalle LEGIBLE derivado del `error_msg` crudo: mapea nombres de
   * constraint/tabla/RPC conocidos a una frase entendible ("El vehículo ya no
   * existe", "Este reporte ya fue registrado"). Devuelve '' si no reconoce nada
   * (entonces solo se muestra el mensaje genérico por familia). El crudo sigue
   * disponible en "Ver detalle técnico".
   */
  detalleLegible(item: OutboxItem): string {
    const raw = (item.error_msg ?? '').toLowerCase();
    if (!raw) return '';

    // Duplicado / ya registrado (idempotencia o unique constraint).
    if (
      raw.includes('duplicate key') ||
      raw.includes('ya fue registrad') ||
      raw.includes('ya existe un') ||
      raw.includes('already exists') ||
      (raw.includes('unique') && raw.includes('constraint'))
    ) {
      return 'Este registro ya había sido enviado antes. Puedes descartarlo.';
    }

    // Referencia rota (foreign key) → según la entidad mencionada.
    const rotaFk = raw.includes('foreign key') || raw.includes('fkey') || raw.includes('no encontrad');
    if (rotaFk || raw.includes('violates')) {
      if (raw.includes('vehiculo')) return 'El vehículo seleccionado ya no existe en el sistema.';
      if (raw.includes('conductor')) return 'El conductor seleccionado ya no existe en el sistema.';
      if (raw.includes('articulo')) return 'El artículo seleccionado ya no existe en el sistema.';
      if (raw.includes('bodega') || raw.includes('almacen')) return 'La bodega seleccionada ya no existe.';
      if (raw.includes('obra') || raw.includes('proyecto')) return 'La obra/proyecto seleccionado ya no existe.';
      if (raw.includes('material')) return 'El material seleccionado ya no existe.';
      if (rotaFk) return 'Hace referencia a algo que ya no existe en el sistema.';
    }

    // Permiso / RLS.
    if (raw.includes('row-level security') || raw.includes('permission denied') || raw.includes('not authorized')) {
      return 'No tienes permiso para enviar esto. Contacta a un administrador.';
    }

    // Existencias insuficientes (salida de inventario, carrera).
    if (raw.includes('existencia') || raw.includes('stock') || raw.includes('cantidad disponible')) {
      return 'No hay suficiente existencia para completar esta salida.';
    }
    return '';
  }

  esperandoTexto(item: OutboxItem): string {
    if (item.estado === 'syncing') return 'Enviando…';
    if (item.error_msg) return 'Reintentando automáticamente…';
    return this.online() ? 'En cola para enviar' : 'Esperando señal';
  }

  toggleDetalle(id: string): void {
    this.expandido.update((cur) => (cur === id ? null : id));
  }

  reintentar(item: OutboxItem): void {
    void this.sync.retry(item.id);
  }

  reintentarTodo(): void {
    void this.sync.retryErrored();
  }

  pedirDescartar(item: OutboxItem): void {
    this.confirmarDescartarId.set(item.id);
  }

  cancelarDescartar(): void {
    this.confirmarDescartarId.set(null);
  }

  confirmarDescartar(): void {
    const id = this.confirmarDescartarId();
    if (id) void this.sync.discard(id);
    this.confirmarDescartarId.set(null);
  }

  back(): void {
    this.location.back();
  }
}
