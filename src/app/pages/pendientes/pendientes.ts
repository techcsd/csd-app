import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { SyncBadge } from '../../shared/ui/sync-badge/sync-badge';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { SyncService } from '../../core/sync/sync.service';
import { NetworkService } from '../../core/services/network.service';
import { ConducesService } from '../../core/services/conduces.service';
import { ToastService } from '../../core/services/toast.service';
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
  mantenimiento_cierre: 'Cierre de mantenimiento',
  crear_ruta: 'Ruta creada',
  ruta_estado: 'Cambio de estado de ruta',
  ruta_agregar_parada: 'Parada agregada a ruta',
  ruta_cambiar_destino: 'Cambio de destino de ruta',
  parada_avanzar: 'Avance de parada',
  conduce_entrega: 'Entrega de conduce',
  conduce_recepcion: 'Recepción de conduce',
  conduce_simple: 'Conduce (entrega directa)',
  conduce_transportista: 'Conduce con transportista',
  conduce_estado_op: 'Cambio de estado de conduce',
  conduce_entregado: 'Conduce entregado',
  conduce_confirmar: 'Confirmación de conduce',
  conduce_vincular_parada: 'Conduce vinculado a parada',
  conduce_firmar_receptor: 'Firma de recepción de conduce',
  conduce_transf_aceptar: 'Aceptar transferencia de conduce',
  vehiculo_traspaso: 'Traspaso de vehículo',
  aviso_novedad_vehiculo: 'Novedad de vehículo',
  accidente_vehiculo: 'Accidente de vehículo',
  dano_vehiculo: 'Daño de vehículo',
  multa_conductor: 'Multa de conductor',
  mensaje_enviar: 'Mensaje enviado',
  tarea_app_iniciar: 'Inicio de tarea',
  tarea_app_completar: 'Tarea completada',
  cronograma_tarea_iniciar: 'Inicio de tarea de cronograma',
  cronograma_tarea_completar: 'Tarea de cronograma completada',
  tarea_enlazar: 'Enlace de tarea',
  rrhh_asignar_item: 'Asignación de item a empleado',
  rrhh_asignacion_estado: 'Cambio de asignación',
  cl_liberacion: 'Liberación de checklist',
  inv_entrada: 'Entrada de inventario',
  inv_devolucion_obra: 'Devolución de obra',
  inv_salida: 'Salida de inventario',
  inv_conteo: 'Conteo de inventario',
  devolucion_chofer: 'Devolución de chofer',
  compra_ferreteria: 'Compra en ferretería',
  entrada_ferreteria_confirmar: 'Confirmar entrada de ferretería',
  solicitud: 'Requisición de materiales',
  reporte: 'Reporte',
  reporte_semanal: 'Inspección de vehículo',
  documento_upload: 'Documento (cédula / licencia)',
  nota_guardar: 'Nota guardada',
  nota_checklist_set: 'Nota de checklist',
  // obra_* — módulo de obra
  obra_charla: 'Charla de seguridad',
  obra_nc: 'No conformidad',
  obra_incidente: 'Incidente en obra',
  obra_accion_hecha: 'Acción correctiva hecha',
  obra_nc_verificar: 'Verificación de no conformidad',
  obra_checklist: 'Checklist de obra',
  obra_cubicacion: 'Cubicación',
  obra_avance_tarea: 'Avance de tarea de obra',
  obra_prueba_campo: 'Prueba de campo',
  obra_mano_obra: 'Registro de mano de obra',
  obra_pedido_urgente: 'Pedido urgente',
};

const TIPO_ICON: Record<string, string> = {
  bitacora: '📓',
  checklist_preuso: '📋',
  vehiculo_entrega: '🚚',
  mantenimiento: '🔧',
  combustible: '⛽',
  mantenimiento_cierre: '🔧',
  crear_ruta: '🗺️',
  ruta_estado: '🗺️',
  ruta_agregar_parada: '📍',
  ruta_cambiar_destino: '📍',
  parada_avanzar: '📍',
  conduce_entrega: '📦',
  conduce_recepcion: '📥',
  conduce_simple: '📦',
  conduce_transportista: '🚛',
  conduce_estado_op: '🔄',
  conduce_entregado: '📦',
  conduce_confirmar: '✅',
  conduce_vincular_parada: '🔗',
  conduce_firmar_receptor: '✍️',
  conduce_transf_aceptar: '↔️',
  vehiculo_traspaso: '🔁',
  aviso_novedad_vehiculo: '⚠️',
  accidente_vehiculo: '💥',
  dano_vehiculo: '🛠️',
  multa_conductor: '🚦',
  mensaje_enviar: '💬',
  tarea_app_iniciar: '▶️',
  tarea_app_completar: '✅',
  cronograma_tarea_iniciar: '▶️',
  cronograma_tarea_completar: '✅',
  tarea_enlazar: '🔗',
  rrhh_asignar_item: '🧑‍💼',
  rrhh_asignacion_estado: '🧑‍💼',
  cl_liberacion: '✅',
  inv_entrada: '📥',
  inv_devolucion_obra: '🏗️',
  inv_salida: '📤',
  inv_conteo: '🔢',
  devolucion_chofer: '↩️',
  compra_ferreteria: '🛒',
  entrada_ferreteria_confirmar: '📥',
  solicitud: '🛒',
  reporte: '📝',
  reporte_semanal: '📊',
  documento_upload: '🪪',
  nota_guardar: '🗒️',
  nota_checklist_set: '🗒️',
  // obra_* — módulo de obra
  obra_charla: '🦺',
  obra_nc: '⚠️',
  obra_incidente: '🚨',
  obra_accion_hecha: '✅',
  obra_nc_verificar: '🔎',
  obra_checklist: '📋',
  obra_cubicacion: '📐',
  obra_avance_tarea: '📈',
  obra_prueba_campo: '🧪',
  obra_mano_obra: '👷',
  obra_pedido_urgente: '🛒',
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
  private router = inject(Router);
  private conduces = inject(ConducesService);
  private toast = inject(ToastService);
  // AV3 — id del item cuyo recordatorio al despachante se está enviando.
  recordandoId = signal<string | null>(null);

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

  /** AO3 — un conduce con error (ej. stock insuficiente) se puede CORREGIR: reabre el
   *  wizard con los datos y fotos del conduce atascado para ajustar cantidades/almacén. */
  puedeCorregir(item: OutboxItem): boolean {
    return item.estado === 'error' && item.tipo_op === 'conduce_simple';
  }
  /** AO3 — abre el wizard de conduce en modo corrección (reconstruye desde el payload). */
  corregir(item: OutboxItem): void {
    void this.router.navigate(['/transporte/generar-conduce'], { queryParams: { corregir: item.id } });
  }

  /** AV3 — ¿este error es "falta la firma del despachante" (DR456)? */
  esErrorFirmaDespachante(item: OutboxItem): boolean {
    if (item.tipo_op !== 'conduce_entregado') return false;
    const raw = (item.error_msg ?? '').toLowerCase();
    return raw.includes('firma del despachante') || raw.includes('dr456');
  }

  /** AV3 — muestra el atajo "Recordarle al despachante" en ese error. */
  puedeRecordarDespachante(item: OutboxItem): boolean {
    return item.estado === 'error' && this.esErrorFirmaDespachante(item);
  }

  /** AV3 — re-avisa al despachante que firme (re-push manual desde el outbox). */
  async recordarDespachante(item: OutboxItem): Promise<void> {
    const salidaId = (item.payload as Record<string, unknown> | null)?.['salida_id'] as string | undefined;
    if (!salidaId || this.recordandoId()) return;
    if (!this.online()) {
      this.toast.error('Necesitas conexión para recordarle al despachante.');
      return;
    }
    this.recordandoId.set(item.id);
    try {
      const nombre = await this.conduces.recordarDespachante(salidaId);
      if (nombre === null) {
        // Ya firmó → reintenta el envío ahora.
        this.toast.success('El despachante ya firmó. Reintentando el envío…');
        void this.sync.retry(item.id);
      } else {
        this.toast.success(`Se le recordó a ${nombre}. Reintenta el envío cuando firme.`);
      }
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo enviar el recordatorio.');
    } finally {
      this.recordandoId.set(null);
    }
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
        // BC3 — si el servidor señaló el campo, decir CUÁL (ya no una frase genérica).
        return this.conCampo(item, item.error_msg || 'Un dato del registro tiene un formato inválido.');
      case 'foto':
        return 'La foto ya no está disponible en el teléfono. Descártalo y vuelve a capturarlo.';
      case 'incompatible':
        return 'No se pudo procesar (posible desajuste de versión con el servidor). Descártalo; si vuelve a pasar, actualiza la app.';
      case 'red':
        return 'Sin conexión estable. Se reintentará solo cuando vuelva la señal.';
      case 'validacion':
        // BC3 — el RPC devuelve un mensaje ya en español; se muestra tal cual + el campo.
        return this.conCampo(item, item.error_msg || 'El sistema rechazó los datos de este registro.');
      default:
        return item.error_msg || 'No se pudo enviar. Intenta de nuevo o descártalo.';
    }
  }

  // BC3 — nombres de campo legibles para el aviso "revisa <campo>".
  private static readonly CAMPO_LABEL: Record<string, string> = {
    tarea_id: 'la tarea',
    bitacora_id: 'la bitácora',
    foto_path: 'la foto de evidencia',
    proyecto_id: 'la obra',
    fecha: 'la fecha',
    litros: 'los litros',
    monto: 'el monto',
    odometro: 'el odómetro',
    origen_id: 'el origen',
    destino_id: 'el destino',
    salida_id: 'el conduce',
  };
  /** BC3 — ¿el fallo señaló un campo concreto a corregir? */
  campoSenalado(item: OutboxItem): string | null {
    const c = (item as OutboxItem & { error_campo?: string }).error_campo;
    if (!c) return null;
    return PendientesPage.CAMPO_LABEL[c] ?? c;
  }
  /** Añade "Revisa <campo>." al mensaje cuando el servidor lo señaló. */
  private conCampo(item: OutboxItem, base: string): string {
    const c = this.campoSenalado(item);
    return c ? `${base} Revisa ${c}.` : base;
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

    // AV3 — el conduce se rechazó porque falta la firma del despachante (DR456):
    // accionable, no un fallo genérico. Se reintenta cuando el despachante firme.
    if (this.esErrorFirmaDespachante(item)) {
      return 'Falta la firma del despachante. No se puede entregar hasta que firme el conduce desde su sesión. Recuérdaselo con el botón de abajo y reintenta cuando firme.';
    }

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
