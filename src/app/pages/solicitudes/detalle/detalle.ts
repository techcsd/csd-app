import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { QtyInput } from '../../../shared/ui/qty-input/qty-input';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { SolicitudesService } from '../../../core/services/solicitudes.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  Bodega,
  RequisicionAvanceItem,
  RequisicionCobertura,
  RequisicionDetalle,
  RequisicionDetalleItem,
  RequisicionEdicion,
  requisicionCodigo,
  faseRequisicion,
  necesidadInfo,
  NecesidadInfo,
} from '../../../core/models/inventario.model';
import { Proyecto } from '../../../core/models/bitacora.model';
import { formatFechaMedia, fechaLocalISO } from '../../../core/util/fecha';
import { combinarUnidades } from '../../../core/util/unidades';

/** Una línea en edición (BB10). Conserva el id del renglón + si es no catalogado. */
interface EditItem {
  id: string;
  articulo_id: string | null;
  descripcion: string;
  cantidad: number;
  unidad: string;
  talla: string | null;
}

/** AS7/AS6/BC1/BC4 — Detalle completo de una requisición (destino del deep-link de
 *  la push): obra etiquetada, solicitante+rol, REQ-XXX, estado, avance de despachos,
 *  historial, y acciones por estado (editar/cancelar/aprobar/rechazar). */
@Component({
  selector: 'app-requisicion-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, CollapsibleSelect, QtyInput, ConfirmDialog, TranslatePipe],
  templateUrl: './detalle.html',
  styleUrl: './detalle.scss',
})
export class RequisicionDetallePage {
  private service = inject(SolicitudesService);
  private inventario = inject(InventarioService);
  private ctx = inject(UserContextService);
  private net = inject(NetworkService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);

  fmtFecha = formatFechaMedia;
  codigo = requisicionCodigo;

  loading = signal(true);
  req = signal<RequisicionDetalle | null>(null);
  avance = signal<RequisicionAvanceItem[]>([]);
  ediciones = signal<RequisicionEdicion[]>([]);
  error = signal(false);
  refreshing = signal(false);
  desincronizado = signal(false); // BC1 — mostrando caché offline
  fetchedAt = signal<number | null>(null);

  // AS7 — gestión (aprobar/rechazar) solo para admin/módulo inventario.
  // BV11 — 'fecha' = editar la fecha de necesidad.
  modo = signal<'none' | 'aprobar' | 'rechazar' | 'editar' | 'cancelar' | 'fecha'>('none');

  // BV11 — edición de la fecha de necesidad (offline-safe por outbox).
  fechaNecesidadEdit = signal('');
  fechaMotivo = signal('');
  readonly hoyISO = fechaLocalISO();
  // BV4 — material que cubre esta requisición (para el aprobador).
  coberturas = signal<RequisicionCobertura[]>([]);
  bodegas = signal<Bodega[]>([]);
  bodegaId = signal('');
  responsable = signal('');
  observaciones = signal('');
  rechazoNota = signal('');
  procesando = signal(false);
  // AT7 — stock por renglón del almacén elegido (para el aprobador).
  private stockPorArticulo = signal<Record<string, number>>({});

  // BB10/BF6 — edición del autor (pendiente o rechazada).
  editItems = signal<EditItem[]>([]);
  editUrgencia = signal<'normal' | 'urgente'>('normal');
  editNotas = signal('');
  editProyectoId = signal(''); // BF6 — obra editable
  proyectos = signal<Proyecto[]>([]); // BF6 — obras pickables (mismo scoping que crear)
  unidades = signal<string[]>([]);
  puedeGestionarSig = signal(false);
  confirmarQuitar = signal<string | null>(null);

  bodegaOptions = computed(() => this.bodegas().map((b) => ({ id: b.id, label: b.nombre })));
  proyectoOptions = computed(() => this.proyectos().map((p) => ({ id: p.id, label: p.nombre })));
  private proyectosMap = computed(() => {
    const m: Record<string, string> = {};
    for (const p of this.proyectos()) m[p.id] = p.nombre;
    return m;
  });
  puedeGestionar = computed(() => this.ctx.esAdmin() || this.ctx.hasModulo('inventario'));
  esPendiente = computed(() => this.req()?.estado === 'pendiente');
  /** BH1 — Aprobar/Rechazar son actos de un TERCERO gestor: el servidor niega
   *  auto-aprobar ("No puedes aprobar tu propia requisición") y auto-rechazar
   *  ("No puedes rechazar tu propia solicitud"). La visibilidad del botón se deriva
   *  de la MISMA condición del guard: nunca se pinta al autor (salvo admin). Al autor
   *  le queda "Cancelar", que sí le corresponde (puedeCancelar). */
  puedeAprobarORechazar = computed(
    () => this.puedeGestionar() && this.esPendiente() && (!this.esAutor() || this.ctx.esAdmin()),
  );
  /** BF6 — una rechazada no es callejón: el autor la corrige y la reenvía. */
  esRechazada = computed(() => this.req()?.estado === 'rechazada');
  esAutor = computed(() => !!this.req()?.solicitante_id && this.req()?.solicitante_id === this.ctx.profile()?.id);
  /** BB10/BF6 — el autor (o admin) edita mientras esté pendiente O rechazada. */
  puedeEditar = computed(() => (this.esPendiente() || this.esRechazada()) && (this.esAutor() || this.ctx.esAdmin()));
  /** BA6 — cancelar: rol con permiso (o el autor de la pendiente). */
  puedeCancelar = computed(
    () => this.req()?.estado !== 'cancelada' && this.req()?.estado !== 'completada' && (this.puedeGestionarSig() || (this.esAutor() && this.esPendiente())),
  );
  puedeVerObra = computed(() => this.ctx.esAdmin() || this.ctx.hasModulo('proyectos') || this.ctx.puedeVerSubmodulo('proyectos.obras'));

  // BV10 — info de la fecha de necesidad (para el bloque destacado del detalle).
  necesidad = computed<NecesidadInfo>(() => necesidadInfo(this.req()?.fecha_necesidad, this.hoyISO));
  // BV11 — ¿puede editar la fecha? solicitante (mientras no esté completada/rechazada) o
  // inventario/flota-elevado. Espeja el gate del RPC requisicion_set_fecha_necesidad.
  puedeEditarFecha = computed(() => {
    const r = this.req();
    if (!r) return false;
    const fase = faseRequisicion(r.estado, r.fase);
    const autorEditable = this.esAutor() && (fase === 'pendiente' || fase === 'en_proceso');
    return autorEditable || this.ctx.esFlotaElevado() || this.ctx.hasModulo('inventario') || this.ctx.esAdmin();
  });

  /** BA6 — resumen del avance: "N de M renglones despachados". */
  avanceResumen = computed(() => {
    const a = this.avance();
    if (!a.length) return null;
    const despachados = a.filter((i) => i.despachado > 0 && i.pendiente <= 0).length;
    return { despachados, total: a.length };
  });
  hayDespachos = computed(() => this.avance().some((i) => i.despachado > 0));

  get online(): boolean {
    return this.net.online();
  }

  constructor() {
    void this.load();
  }

  private get id(): string {
    return this.route.snapshot.paramMap.get('id') ?? '';
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [r, av, eds, gestion, at] = await Promise.all([
        this.service.detalle(this.id),
        this.service.avance(this.id).catch(() => [] as RequisicionAvanceItem[]),
        this.service.ediciones(this.id).catch(() => [] as RequisicionEdicion[]),
        this.service.puedeGestionar(this.id).catch(() => false),
        this.service.detalleFetchedAt(this.id),
      ]);
      if (!r) this.error.set(true);
      else this.req.set(r);
      this.avance.set(av);
      this.ediciones.set(eds);
      this.puedeGestionarSig.set(gestion);
      // BV4 — coberturas (best-effort, detrás de capacidad).
      this.service.cobertura(this.id).then((c) => this.coberturas.set(c)).catch(() => {});
      this.fetchedAt.set(at);
      // BC1 — si estamos offline y la data viene de caché, avisar que puede estar vieja.
      this.desincronizado.set(!this.net.online() && at != null);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
    // Almacenes para el despacho (solo si puede gestionar).
    if (this.puedeGestionar()) {
      this.inventario.getBodegas().then((b) => this.bodegas.set(b)).catch(() => {});
    }
    // BF6 — obras para el selector de edición + resolver nombres en el historial.
    if (this.puedeEditar() || this.ediciones().length) {
      this.service.getProyectos().then((p) => this.proyectos.set(p)).catch(() => {});
    }
  }

  /** BC1 — pull-to-refresh manual: re-consulta el servidor. */
  async refrescar(): Promise<void> {
    if (this.refreshing()) return;
    if (!this.net.online()) {
      this.toast.error(this.i18n.t('Sin conexión. Se muestra la última versión guardada.'));
      return;
    }
    this.refreshing.set(true);
    await this.service.invalidarCache(this.id).catch(() => {});
    await this.load();
    this.refreshing.set(false);
  }

  private hoy(): string {
    return new Date().toISOString().slice(0, 10);
  }

  abrirAprobar(): void {
    this.modo.set('aprobar');
  }
  abrirRechazar(): void {
    this.modo.set('rechazar');
  }
  cancelarAccion(): void {
    this.modo.set('none');
  }

  // ── AT7 — stock por renglón según el almacén elegido (aprobador) ──
  async onBodegaElegida(id: string): Promise<void> {
    this.bodegaId.set(id);
    if (!id) return;
    try {
      const ex = await this.inventario.getExistencias(id);
      const map: Record<string, number> = {};
      for (const e of ex) map[e.articulo_id] = e.cantidad;
      this.stockPorArticulo.set(map);
    } catch {
      this.stockPorArticulo.set({});
    }
  }
  stockDe(it: RequisicionDetalleItem): number | null {
    if (!it.articulo_id || !this.bodegaId()) return null;
    return this.stockPorArticulo()[it.articulo_id] ?? 0;
  }

  async confirmarAprobar(): Promise<void> {
    const r = this.req();
    if (!r || this.procesando()) return;
    if (!this.bodegaId()) {
      this.toast.error(this.i18n.t('Elige el almacén de despacho.'));
      return;
    }
    if (!this.net.online()) {
      this.toast.error(this.i18n.t('Necesitas conexión para aprobar.'));
      return;
    }
    this.procesando.set(true);
    try {
      await this.service.aprobarRequisicion({
        id: r.id,
        bodegaId: this.bodegaId(),
        fecha: this.hoy(),
        responsable: this.responsable().trim() || null,
        observaciones: this.observaciones().trim() || null,
        items: r.items.map((i) => ({
          articulo_id: i.articulo_id,
          descripcion: i.descripcion,
          cantidad: i.cantidad,
          unidad: i.unidad,
          talla: i.talla,
        })),
      });
      this.toast.success(this.i18n.t('Requisición aprobada. Se despachó lo disponible; el faltante generó una compra.'));
      this.modo.set('none');
      await this.refrescar();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo aprobar.'));
    } finally {
      this.procesando.set(false);
    }
  }

  async confirmarRechazar(): Promise<void> {
    const r = this.req();
    if (!r || this.procesando()) return;
    if (!this.net.online()) {
      this.toast.error(this.i18n.t('Necesitas conexión para rechazar.'));
      return;
    }
    this.procesando.set(true);
    try {
      await this.service.rechazarRequisicion(r.id, this.rechazoNota().trim() || null);
      this.toast.success(this.i18n.t('Requisición rechazada.'));
      this.modo.set('none');
      await this.refrescar();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo rechazar.'));
    } finally {
      this.procesando.set(false);
    }
  }

  // ── BB10/BF6 — editar la requisición pendiente o rechazada ──
  async abrirEditar(): Promise<void> {
    const r = this.req();
    if (!r) return;
    this.editUrgencia.set(r.urgencia === 'urgente' ? 'urgente' : 'normal');
    this.editNotas.set(r.notas ?? '');
    this.editProyectoId.set(r.proyecto_id ?? '');
    if (!this.proyectos().length) {
      this.service.getProyectos().then((p) => this.proyectos.set(p)).catch(() => {});
    }
    this.editItems.set(
      r.items.map((i) => ({
        id: i.id,
        articulo_id: i.articulo_id,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        unidad: i.unidad ?? 'UND',
        talla: i.talla,
      })),
    );
    this.modo.set('editar');
    // Unidades para el desplegable de renglones no catalogados (AU13).
    if (!this.unidades().length) {
      this.inventario
        .getUnidades()
        .then((u) => this.unidades.set(combinarUnidades(u.map((x) => x.nombre || x.codigo))))
        .catch(() => this.unidades.set(combinarUnidades([])));
    }
  }

  esCustomEdit(it: EditItem): boolean {
    return !it.articulo_id;
  }
  setCantidadEdit(id: string, v: number): void {
    this.editItems.update((l) => l.map((it) => (it.id === id ? { ...it, cantidad: Math.max(0, v || 0) } : it)));
  }
  setUnidadEdit(id: string, u: string): void {
    this.editItems.update((l) => l.map((it) => (it.id === id ? { ...it, unidad: u } : it)));
  }
  pedirQuitarEdit(id: string): void {
    this.confirmarQuitar.set(id);
  }
  cancelarQuitar(): void {
    this.confirmarQuitar.set(null);
  }
  confirmarQuitarEdit(): void {
    const id = this.confirmarQuitar();
    if (id) this.editItems.update((l) => l.filter((it) => it.id !== id));
    this.confirmarQuitar.set(null);
  }

  async guardarEdicion(): Promise<void> {
    const r = this.req();
    if (!r || this.procesando()) return;
    const items = this.editItems().filter((it) => it.cantidad > 0);
    if (!items.length) {
      this.toast.error(this.i18n.t('Deja al menos un renglón con cantidad.'));
      return;
    }
    if (!this.net.online()) {
      this.toast.error(this.i18n.t('Necesitas conexión para guardar los cambios.'));
      return;
    }
    this.procesando.set(true);
    try {
      const { reenviada } = await this.service.editar({
        id: r.id,
        urgencia: this.editUrgencia(),
        notas: this.editNotas().trim() || null,
        proyectoId: this.editProyectoId() || null,
        items: items.map((it) => ({
          articulo_id: it.articulo_id,
          descripcion: it.descripcion,
          cantidad: it.cantidad,
          unidad: it.unidad,
          talla: it.talla,
        })),
      });
      this.toast.success(reenviada ? this.i18n.t('Requisición corregida y reenviada para aprobación.') : this.i18n.t('Requisición actualizada.'));
      this.modo.set('none');
      await this.refrescar();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo guardar.'));
    } finally {
      this.procesando.set(false);
    }
  }

  /** BF6 — resumen legible del diff de una edición (para el aprobador y el autor). */
  resumenCambios(e: RequisicionEdicion): string[] {
    const c = e.cambios as { antes?: Record<string, unknown>; despues?: Record<string, unknown>; reenviada?: boolean } | null;
    if (!c || !c.antes || !c.despues) return [];
    const a = c.antes;
    const d = c.despues;
    const map = this.proyectosMap();
    const out: string[] = [];
    if (c.reenviada) out.push('🔄 Corregida y reenviada tras rechazo');
    if (a['proyecto_id'] !== d['proyecto_id']) {
      const na = (a['proyecto_id'] && map[a['proyecto_id'] as string]) || 'obra anterior';
      const nd = (d['proyecto_id'] && map[d['proyecto_id'] as string]) || 'obra nueva';
      out.push(`🏗️ Obra: ${na} → ${nd}`);
    }
    if (a['urgencia'] !== d['urgencia']) out.push(`Urgencia: ${a['urgencia'] === 'urgente' ? 'urgente' : 'normal'} → ${d['urgencia'] === 'urgente' ? 'urgente' : 'normal'}`);
    const na = Array.isArray(a['items']) ? (a['items'] as unknown[]).length : null;
    const nd = Array.isArray(d['items']) ? (d['items'] as unknown[]).length : null;
    if (na !== null && nd !== null && na !== nd) out.push(`Renglones: ${na} → ${nd}`);
    if ((a['notas'] ?? '') !== (d['notas'] ?? '')) out.push('Notas actualizadas');
    return out;
  }

  // ── BV11 — editar la fecha de necesidad (offline-safe por outbox) ──
  abrirEditarFecha(): void {
    this.fechaNecesidadEdit.set(this.req()?.fecha_necesidad ?? '');
    this.fechaMotivo.set('');
    this.modo.set('fecha');
  }
  async guardarFecha(): Promise<void> {
    const r = this.req();
    if (!r || this.procesando()) return;
    const fecha = this.fechaNecesidadEdit();
    if (!fecha) {
      this.toast.error(this.i18n.t('Elige la fecha de necesidad.'));
      return;
    }
    this.procesando.set(true);
    try {
      await this.service.setFechaNecesidad(r.id, fecha, this.fechaMotivo().trim() || null);
      // Optimista: refleja la fecha ya (el outbox la confirmará al drenar).
      this.req.update((cur) => (cur ? { ...cur, fecha_necesidad: fecha } : cur));
      this.toast.success(this.i18n.t('Fecha de necesidad actualizada.'));
      this.modo.set('none');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo actualizar la fecha.'));
    } finally {
      this.procesando.set(false);
    }
  }

  // ── BV4 — quitar una cobertura dudosa (aprobador) ──
  async quitarCobertura(c: RequisicionCobertura): Promise<void> {
    if (!this.net.online()) {
      this.toast.error(this.i18n.t('Necesitas conexión para quitar la cobertura.'));
      return;
    }
    try {
      await this.service.desvincularCobertura(c.id);
      this.coberturas.update((list) => list.filter((x) => x.id !== c.id));
      this.toast.success(this.i18n.t('Cobertura quitada.'));
      await this.refrescar();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo quitar la cobertura.'));
    }
  }

  // ── BA6 — cancelar con motivo ──
  abrirCancelar(): void {
    this.rechazoNota.set('');
    this.modo.set('cancelar');
  }
  async confirmarCancelar(): Promise<void> {
    const r = this.req();
    if (!r || this.procesando()) return;
    const motivo = this.rechazoNota().trim();
    if (!motivo) {
      this.toast.error(this.i18n.t('Escribe el motivo de la cancelación.'));
      return;
    }
    if (!this.net.online()) {
      this.toast.error(this.i18n.t('Necesitas conexión para cancelar.'));
      return;
    }
    this.procesando.set(true);
    try {
      await this.service.cancelar(r.id, motivo);
      this.toast.success(this.i18n.t('Requisición cancelada.'));
      this.modo.set('none');
      await this.refrescar();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo cancelar.'));
    } finally {
      this.procesando.set(false);
    }
  }

  // ── Navegación a documentos vinculados ──
  verConduce(): void {
    const salida = this.req()?.salida_id;
    if (salida) void this.router.navigate(['/transporte/conduce-detalle', salida]);
  }
  verObra(): void {
    const id = this.req()?.proyecto_id;
    if (id && this.puedeVerObra()) void this.router.navigate(['/proyectos', id]);
  }

  estadoLabel(e: string): string {
    switch (e) {
      case 'pendiente': return this.i18n.t('Pendiente');
      case 'aprobada': return this.i18n.t('Aprobada');
      case 'por_despachar': return this.i18n.t('Por despachar');
      case 'entregada': return this.i18n.t('Entregada');
      case 'completada':
      case 'cerrada': return this.i18n.t('Completada');
      case 'rechazada': return this.i18n.t('Rechazada');
      case 'cancelada': return this.i18n.t('Cancelada');
      default: return e;
    }
  }

  back(): void {
    this.location.back();
  }
}
