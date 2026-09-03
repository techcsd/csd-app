import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { SyncBadge } from '../../shared/ui/sync-badge/sync-badge';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { SyncService, OutboxFixActivo } from '../../core/sync/sync.service';
import { NetworkService } from '../../core/services/network.service';
import { ConducesService } from '../../core/services/conduces.service';
import { ToastService } from '../../core/services/toast.service';
import { OutboxOp } from '../../core/db/app-db';
import { formatFechaRelativa } from '../../core/util/fecha';
import { tipoOpLabel, tipoOpIcon } from '../../core/util/outbox-labels';
import {
  outboxCategoria,
  categoriaPill,
  MENSAJE_SISTEMA,
  OutboxCategoria,
} from '../../core/util/outbox-categoria';
import { versionAlMenos } from '../../core/util/version';
import { environment } from '../../../environments/environment';

type OutboxItem = OutboxOp & { fotos: number };

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

  // BG1(c) — fixes publicados por Tecnología (señal "corregido") + ids de los
  // pendientes 'sistema' que un fix puede resolver → banner de reintento sugerido.
  private fixes = signal<OutboxFixActivo[]>([]);
  reintentandoFix = signal(false);

  online = this.network.online;
  fmt = formatFechaRelativa;

  constructor() {
    // Se refresca sola ante cualquier cambio del outbox (envío, error, descarte).
    effect(() => {
      this.sync.changed();
      void this.load();
    });
    // BG1(c) — consulta las correcciones publicadas (online, best-effort).
    void this.cargarFixes();
  }

  private async load(): Promise<void> {
    try {
      this.items.set(await this.sync.listOutbox());
    } finally {
      this.loading.set(false);
    }
  }

  private async cargarFixes(): Promise<void> {
    this.fixes.set(await this.sync.outboxFixesActivos());
  }

  /** BG1(c) — pendientes 'sistema' que coinciden con un fix publicado (por tipo_op /
   *  error_code y versión de la app ≥ mínima del fix). Sugerimos reintentarlos. */
  private itemsConFix(): OutboxItem[] {
    const fixes = this.fixes();
    if (!fixes.length) return [];
    return this.items().filter((it) => {
      if (!this.esSistema(it)) return false;
      return fixes.some(
        (f) =>
          (!f.tipo_op || f.tipo_op === it.tipo_op) &&
          // BI2 — error_code es OPCIONAL: solo estrecha cuando el ITEM lo trae. Los
          // registros atascados de agosto lo tienen VACÍO y siempre lo tendrán (el
          // campo nació en 2.10.0; StorageApiError no trae code) → exigirlo hacía la
          // señal estructuralmente inalcanzable. tipo_op + versión bastan.
          (!f.error_code || !(it.error_code ?? '').trim() || (it.error_code ?? '').startsWith(f.error_code)) &&
          versionAlMenos(environment.version, f.min_app_version),
      );
    });
  }
  /** ¿Hay una corrección publicada que aplica a pendientes atascados? (banner) */
  hayFixSugerido(): boolean {
    return this.itemsConFix().length > 0;
  }
  fixSugeridoCount(): number {
    return this.itemsConFix().length;
  }
  /** BG1(c) — reintenta los pendientes que la corrección publicada puede resolver. */
  reintentarConFix(): void {
    const ids = this.itemsConFix().map((i) => i.id);
    if (!ids.length || this.reintentandoFix()) return;
    this.reintentandoFix.set(true);
    void this.sync.retryVarios(ids).finally(() => this.reintentandoFix.set(false));
    this.toast.show('Reintentando tus pendientes con la corrección…', 'info');
  }

  hayReintentables(): boolean {
    // BI2 — "Reintentar todos" se muestra siempre que haya algo en `error`, permanente
    // o no. El reintento de un permanente (RLS/constraint post-fix) es PRECISAMENTE la
    // acción que BG1 vino a habilitar; esconderlo cuando todo es permanente era lo
    // contrario de lo que hace falta.
    return this.items().some((i) => i.estado === 'error');
  }

  /** S30 — un pending/syncing lleva demasiado tiempo atascado (>24h). */
  private readonly VIEJO_MS = 24 * 60 * 60 * 1000;
  esViejo(item: OutboxItem): boolean {
    return item.estado !== 'error' && Date.now() - item.created_local > this.VIEJO_MS;
  }

  /** BI2 — un pending/syncing que ya falló al menos una vez o lleva > 2 min sin salir
   *  puede reintentarse a mano (antes NO tenía ningún reintento y era invisible en el
   *  banner de errores). Fuerza el envío ahora sin esperar el backoff. */
  private readonly ATASCADO_MS = 2 * 60 * 1000;
  puedeForzarEnvio(item: OutboxItem): boolean {
    if (item.estado === 'error') return false;
    return item.intentos > 0 || Date.now() - item.created_local > this.ATASCADO_MS;
  }
  /** S30/BG1 — se puede descartar DESDE LA TARJETA: error permanente de DATO, o
   *  pending atascado >24h. Los de categoría 'sistema' NO muestran Descartar aquí
   *  (data real de obra): su descarte vive en la vista de contenido, tras doble
   *  confirmación con aviso de pérdida. */
  puedeDescartar(item: OutboxItem): boolean {
    if (this.esSistema(item)) return false;
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
    return tipoOpLabel(t);
  }
  tipoIcon(t: string): string {
    return tipoOpIcon(t);
  }

  // ── BG1 — categoría (transitorio / dato / sistema) ─────────────────────────
  categoria(item: OutboxItem): OutboxCategoria {
    return outboxCategoria(item);
  }
  esSistema(item: OutboxItem): boolean {
    return item.estado === 'error' && this.categoria(item) === 'sistema';
  }
  pill(item: OutboxItem) {
    return categoriaPill(this.categoria(item));
  }

  /** BG3 — tap en la tarjeta → vista de solo-lectura del contenido + duplicar/exportar. */
  abrirContenido(item: OutboxItem): void {
    void this.router.navigate(['/pendientes', item.id]);
  }

  /** P5/BG1 — error técnico → mensaje entendible en español según su categoría. */
  mensajeError(item: OutboxItem): string {
    if (item.estado !== 'error' && !item.error_msg) return '';
    // BG1 — categoría 'sistema': el mensaje NO culpa al usuario (el permiso de
    // negocio existe; el sistema estaba mal configurado). Reemplaza el texto viejo
    // "No tienes permiso para enviar esto. Contacta a un administrador".
    if (this.esSistema(item)) return MENSAJE_SISTEMA;
    switch (item.error_kind) {
      case 'permiso':
        return MENSAJE_SISTEMA;
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

    // Permiso / RLS → categoría 'sistema' (no es culpa del usuario). El mensaje
    // honesto ya lo da mensajeError(); aquí no repetimos una frase que culpe.
    if (raw.includes('row-level security') || raw.includes('permission denied') || raw.includes('not authorized')) {
      return '';
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
