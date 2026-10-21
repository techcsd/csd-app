import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, Location } from '@angular/common';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { InventarioService, EntradaFerreteriaPendiente } from '../../../core/services/inventario.service';
import { CapturedPhoto, CameraService } from '../../../core/services/camera.service';
import { ToastService } from '../../../core/services/toast.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NetworkService } from '../../../core/services/network.service';
import { Conduce } from '../../../core/models/transporte.model';
import { formatFechaCortaHora } from '../../../core/util/fecha';
import { resolverConduceDeBorrador } from '../../../core/util/recepcion';
import { MotionService } from '../../../core/services/motion.service';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

/** Estado serializable de la recepción abierta (regla 4 — autosave/borrador).
 *  CT5 — `conduceSnapshot` es una copia liviana (folio + renglones) del conduce
 *  en el momento de abrirlo: permite retomar el borrador SIN SEÑAL aunque
 *  `conducesPorRecibir()` no responda (antes se descartaba como "huérfano" solo
 *  por no verlo en la lista, perdiendo cantidades/fotos/notas ya capturadas).
 *  `receptorNombre` se guarda para no perder quién recibía (la firma SÍ se vuelve
 *  a pedir siempre, a propósito). */
interface RecibirDraft {
  expandedId: string;
  cantidades: Record<string, number>;
  notas: string;
  receptorNombre: string;
  conduceSnapshot: Conduce | null;
}

/** Z20 — bodeguero/chofer confirma la recepción de un conduce despachado.
 *  Presentación clara: lista con encabezado legible → hoja de detalle con
 *  origen→destino, quién/cuándo, ítems recibido/esperado editables, notas,
 *  fotos y confirmación tipo hoja. Offline-first. */
@Component({
  selector: 'app-recibir-conduce',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, FormsModule, DecimalPipe, SyncBar, PhotoSlot, SignaturePad, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './recibir.html',
  styleUrl: './recibir.scss',
})
export class RecibirConducePage {
  private inventario = inject(InventarioService);
  private toast = inject(ToastService);
  private location = inject(Location);
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);
  private ctx = inject(UserContextService);
  private i18n = inject(I18nService);
  private camera = inject(CameraService);
  private motion = inject(MotionService);
  private network = inject(NetworkService);

  private sig = viewChild(SignaturePad);

  readonly clave = 'inventario:recibir';
  private hydrated = false;
  /** CK — `at` de la última foto recuperada ya re-atada (no repetir trabajo). */
  private ultimaRestauracion = 0;

  readonly fechaHora = formatFechaCortaHora;

  conduces = signal<Conduce[]>([]);
  // AE — compras de ferretería pendientes. El chofer las VE (solo lectura); solo
  // Almacén/Inventario les da entrada (antifraude: Almacén valida antes de subir stock).
  entradasFerreteria = signal<EntradaFerreteriaPendiente[]>([]);
  confirmandoId = signal<string | null>(null);
  puedeConfirmarEntrada = computed(() => this.ctx.hasModulo('inventario') || this.ctx.hasRol('admin'));
  loading = signal(true);
  /** Conduce abierto en la hoja de detalle (null = vista lista). */
  activo = signal<Conduce | null>(null);
  /** CT3a — true mientras la hoja está en modo "Ver conduce" (solo lectura,
   *  sin borrador: tocar un conduce para identificarlo no debe crear nada). */
  viendoSolo = signal(false);
  /** CT3a — miniatura de la foto del despacho por conduce, para la tarjeta de la lista. */
  fotoThumbs = signal<Record<string, string>>({});
  cantidades = signal<Record<string, number>>({});
  // AF30 — varias fotos de evidencia de la descarga (mínimo 2). `nuevaFoto` es el
  // slot "agregar" (siempre vacío: al capturar se empuja al array y se limpia).
  fotos = signal<CapturedPhoto[]>([]);
  nuevaFoto = signal<CapturedPhoto | null>(null);
  // BK5: knob `bitacora_min_fotos` del padre no existe → hardcodeado (docs/bk5-limites-fotos.md).
  readonly MIN_FOTOS = 2;
  faltanFotos = computed(() => this.fotos().length < this.MIN_FOTOS);
  notas = signal(''); // APP-041 — discrepancias de recepción
  // AE — firma del receptor (prueba de recepción, AC7).
  receptorNombre = signal('');
  firmaLista = signal(false);
  firmaBlob = signal<Blob | null>(null);
  submitting = signal(false);
  /** Z20 — URL firmada de la foto del despacho (si la hay) + lightbox. */
  despachoFotoUrl = signal<string | null>(null);
  lightbox = signal(false);

  /** AF16 — ¿el conduce lleva algún artículo de alto valor / entrega en mano? */
  altoValor = computed(() => !!this.activo()?.items.some((it) => it.entregaEnMano));

  /** Z20 — ¿alguna cantidad recibida difiere de la esperada? (discrepancia). */
  hayDiscrepancia = computed(() => {
    const c = this.activo();
    if (!c) return false;
    return c.items.some((it) => (this.cantidades()[it.detalle_id] ?? it.cantidad) !== it.cantidad);
  });

  constructor() {
    void this.load();
    // Regla 4 — autosave: no perder las cantidades recibidas / notas de discrepancia
    // si el SO mata la app al abrir la cámara (foto de recepción).
    effect(() => {
      const c = this.activo();
      const snap: RecibirDraft = {
        expandedId: c?.id ?? '',
        cantidades: this.cantidades(),
        notas: this.notas(),
        receptorNombre: this.receptorNombre(),
        // CT5 — copia liviana del conduce para poder retomar sin señal.
        conduceSnapshot: c,
      };
      // CT3a — "Ver conduce" nunca escribe un borrador (solo mirar no es un proceso iniciado).
      if (!this.hydrated || this.submitting() || !snap.expandedId || this.viendoSolo()) return;
      this.autosave.queue(this.clave, snap, {
        tipo: 'recibir',
        // CT5 — el folio en la etiqueta identifica DE CUÁL conduce es el borrador
        // (el banner del home y "Documentación en proceso" la muestran tal cual).
        etiqueta: c?.codigo
          ? this.i18n.t('Recepción de conduce {codigo}', { codigo: c.codigo })
          : this.i18n.t('Recepción de conduce'),
        ruta: this.location.path(),
      });
    });
    // CK (patrón CJ13 de combustible) — si el SO destruyó la Activity durante la
    // captura (equipos de poca memoria), la foto vuelve por `appRestoredResult` y se
    // guarda en el borrador (por índice), a veces DESPUÉS de que `restoreDraft` ya
    // cargó las fotos. Este effect re-sincroniza el arreglo de fotos desde el borrador
    // en cuanto el servicio de cámara anuncia la recuperación. Cierra la carrera.
    effect(() => {
      const r = this.camera.restored();
      if (!r || r.clave !== this.clave || r.at <= this.ultimaRestauracion) return;
      this.ultimaRestauracion = r.at;
      void this.reatachFotoRestaurada();
    });
  }

  /**
   * CK — re-sincroniza el arreglo de fotos desde el borrador (fuente única) tras una
   * recuperación por `appRestoredResult`. Como las fotos se persisten por índice y
   * `onAddFoto` siempre re-persiste todas, basta con recargar el arreglo ordenado —
   * la MISMA forma que `restoreDraft`. Revoca las previews previas para no filtrarlas.
   */
  private async reatachFotoRestaurada(): Promise<void> {
    try {
      const fotos = await this.borrador.loadFotos(this.clave);
      if (!fotos.length) return;
      const orden = [...fotos].sort((a, b) => Number(a.slot) - Number(b.slot));
      for (const f of this.fotos()) {
        if (f.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(f.previewUrl);
      }
      this.fotos.set(orden.map((f) => ({ blob: f.blob, previewUrl: URL.createObjectURL(f.blob) })));
    } catch {
      /* best-effort: recuperar la foto nunca debe tumbar la pantalla */
    }
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [conduces, entradas] = await Promise.all([
        this.inventario.conducesPorRecibir(),
        this.inventario.misEntradasFerreteriaPendientes().catch(() => [] as EntradaFerreteriaPendiente[]),
      ]);
      this.conduces.set(conduces);
      this.entradasFerreteria.set(entradas);
      await this.restoreDraft();
      void this.cargarMiniaturas(conduces);
    } finally {
      this.loading.set(false);
    }
  }

  /** CT3a/B2 — miniatura de la foto del despacho en la tarjeta de la lista
   *  (identificar el conduce sin abrir nada). Best-effort, no bloquea la lista. */
  private async cargarMiniaturas(conduces: Conduce[]): Promise<void> {
    const conFoto = conduces.filter((c) => c.foto_path);
    for (const c of conFoto) {
      try {
        const url = await this.inventario.getFotoUrl(c.foto_path);
        if (url) this.fotoThumbs.update((m) => ({ ...m, [c.id]: url }));
      } catch {
        /* sin miniatura: la tarjeta igual muestra folio/origen/fecha */
      }
    }
  }

  /** AE — dar entrada (materializar stock) a una compra de ferretería propia. */
  async confirmarEntrada(e: EntradaFerreteriaPendiente): Promise<void> {
    if (this.confirmandoId()) return;
    this.confirmandoId.set(e.id);
    try {
      await this.inventario.enqueueConfirmarEntradaFerreteria(
        e.id,
        e.items.map((i) => ({ articulo_id: i.articulo_id, cantidad: i.cantidad })),
      );
      this.entradasFerreteria.update((list) => list.filter((x) => x.id !== e.id));
      this.motion.momento('entrada'); // CL2 F4 — caja entra al almacén (también offline)
      this.toast.success(this.i18n.t('Entrada registrada. Se sube al stock al sincronizar.'));
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : this.i18n.t('No se pudo dar entrada.'));
    } finally {
      this.confirmandoId.set(null);
    }
  }

  /**
   * CT5 — retoma el borrador de recepción. Antes se consideraba "huérfano" (y se
   * DESCARTABA, perdiendo cantidades/fotos/notas ya capturadas) con solo no
   * encontrar el conduce en `conducesPorRecibir()` — exactamente lo que pasaba
   * offline (la lista cacheada puede no traerlo todavía). Ahora:
   *  1) si el conduce sigue en la lista (online o cache fresco) → se usa esa copia
   *     (la más actualizada);
   *  2) si no está en la lista pero el borrador guardó una copia del conduce
   *     (`conduceSnapshot`) y NO hay señal → se restaura de todas formas desde
   *     el snapshot (no se puede confirmar nada sin red, así que no se descarta);
   *  3) si no está en la lista Y hay señal → el servidor confirma que ya no está
   *     pendiente (alguien más lo recibió, o ya se envió) → se descarta.
   */
  private async restoreDraft(): Promise<void> {
    const d = await this.borrador.load<RecibirDraft>(this.clave);
    if (d) {
      const candidato = d.expandedId
        ? resolverConduceDeBorrador(d.expandedId, d.conduceSnapshot ?? null, this.conduces(), this.network.online())
        : null;
      if (candidato) {
        this.cantidades.set(d.cantidades ?? {});
        this.notas.set(d.notas ?? '');
        this.receptorNombre.set(d.receptorNombre ?? '');
        this.abrir(candidato, true);
        // BT4 — recupera también las fotos ya tomadas (antes se re-tomaban al reabrir).
        const fotos = await this.borrador.loadFotos(this.clave);
        if (fotos.length) {
          const orden = [...fotos].sort((a, b) => Number(a.slot) - Number(b.slot));
          this.fotos.set(orden.map((f) => ({ blob: f.blob, previewUrl: URL.createObjectURL(f.blob) })));
        }
      } else {
        // Con señal y sin match: el servidor ya no lo tiene pendiente. Sin señal
        // y sin snapshot (borrador viejo, anterior a CT5): no hay nada que ofrecer.
        void this.autosave.discard(this.clave);
      }
    }
    this.hydrated = true;
  }

  /** BT4 — re-persiste todas las fotos por índice (la lista puede reordenarse). */
  private async persistFotos(): Promise<void> {
    try {
      await this.borrador.clearFotos(this.clave);
      const fs = this.fotos();
      for (let i = 0; i < fs.length; i++) await this.borrador.saveFoto(this.clave, String(i), fs[i].blob);
    } catch {
      /* persistir la foto nunca debe romper la captura */
    }
  }

  /** CT3a — "Ver conduce": hoja de solo lectura para identificarlo (folio, origen,
   *  obra, fecha, artículos, foto del despacho). Sin borrador, sin cámara, sin firma. */
  verConduce(c: Conduce): void {
    this.viendoSolo.set(true);
    this.activo.set(c);
    this.despachoFotoUrl.set(null);
    this.lightbox.set(false);
    void this.resolveDespachoFoto(c);
  }

  /** CT3a — desde "Ver conduce", pasa al flujo real de recepción (nace el borrador). */
  empezarRecibir(): void {
    const c = this.activo();
    if (!c) return;
    this.abrir(c);
  }

  /** Z20 — abre la hoja de detalle de un conduce. `retomando` conserva las
   *  cantidades/notas del borrador; en apertura normal se pre-llena con lo esperado. */
  abrir(c: Conduce, retomando = false): void {
    this.viendoSolo.set(false);
    if (!retomando) {
      const init: Record<string, number> = {};
      for (const it of c.items) init[it.detalle_id] = it.cantidad;
      this.cantidades.set(init);
      this.notas.set('');
      this.fotos.set([]);
      this.nuevaFoto.set(null);
    }
    // AE — precarga el receptor con el usuario logueado y limpia la firma (la firma
    // no se persiste en el borrador: se re-firma al retomar).
    if (!this.receptorNombre().trim()) this.receptorNombre.set(this.ctx.nombre() || '');
    this.firmaLista.set(false);
    this.firmaBlob.set(null);
    this.activo.set(c);
    this.despachoFotoUrl.set(null);
    this.lightbox.set(false);
    void this.resolveDespachoFoto(c);
  }

  /** Z20 — resuelve la foto del despacho a URL firmada (best-effort, online). */
  private async resolveDespachoFoto(c: Conduce): Promise<void> {
    if (!c.foto_path) return;
    const url = await this.inventario.getFotoUrl(c.foto_path);
    if (url && this.activo()?.id === c.id) this.despachoFotoUrl.set(url);
  }

  /** Vuelve a la lista desde la hoja de detalle. */
  cerrarDetalle(): void {
    this.activo.set(null);
    this.viendoSolo.set(false);
    this.lightbox.set(false);
  }

  setCantidad(detalleId: string, v: number): void {
    this.cantidades.update((m) => ({ ...m, [detalleId]: Math.max(0, v || 0) }));
  }

  ajustar(detalleId: string, delta: number): void {
    const actual = this.cantidades()[detalleId] ?? 0;
    this.setCantidad(detalleId, actual + delta);
  }

  /** Z20 — ¿esta línea difiere de lo esperado? (para marcar la fila). */
  difiere(it: { detalle_id: string; cantidad: number }): boolean {
    return (this.cantidades()[it.detalle_id] ?? it.cantidad) !== it.cantidad;
  }

  /** AF30 — al capturar, la foto se agrega a la lista y el slot vuelve a estar vacío. */
  onAddFoto(p: CapturedPhoto): void {
    this.fotos.update((list) => [...list, p]);
    this.nuevaFoto.set(null);
    void this.persistFotos(); // BT4
  }
  quitarFoto(i: number): void {
    this.fotos.update((list) => {
      const f = list[i];
      if (f) URL.revokeObjectURL(f.previewUrl);
      return list.filter((_, idx) => idx !== i);
    });
    void this.persistFotos(); // BT4
  }

  /** AE — firma del receptor capturada en el pad. */
  async onFirmaChanged(hasSignature: boolean): Promise<void> {
    this.firmaLista.set(hasSignature);
    this.firmaBlob.set(hasSignature ? ((await this.sig()?.toBlob()) ?? null) : null);
  }

  async confirm(): Promise<void> {
    const c = this.activo();
    if (!c || this.submitting()) return;
    // AE — el receptor debe firmar la recepción (prueba de entrega, AC7).
    if (!this.receptorNombre().trim()) {
      this.toast.error(this.i18n.t('Escribe el nombre de quien recibe.'));
      return;
    }
    if (this.faltanFotos()) {
      this.toast.error(this.i18n.t('Toma al menos {n} fotos de la mercancía recibida.', { n: this.MIN_FOTOS }));
      return;
    }
    if (!this.firmaBlob()) {
      this.toast.error(this.i18n.t('Falta la firma de quien recibe.'));
      return;
    }
    this.submitting.set(true);
    try {
      // AF13 — checklist recibido vs enviado (para el registro de confirmación).
      const checklist = c.items.map((it) => {
        const recibida = this.cantidades()[it.detalle_id] ?? it.cantidad;
        return {
          nombre: it.articulo,
          cantidad_enviada: it.cantidad,
          cantidad_recibida: recibida,
          diferencia: recibida - it.cantidad,
        };
      });
      await this.inventario.enqueueRecepcion({
        salidaId: c.id,
        items: c.items.map((it) => ({
          detalle_id: it.detalle_id,
          cantidad_recibida: this.cantidades()[it.detalle_id] ?? it.cantidad,
        })),
        notas: this.notas().trim() || null,
        fotos: this.fotos().map((f) => f.blob),
        checklist,
        firmaReceptor: this.firmaBlob(),
        receptorNombre: this.receptorNombre().trim(),
      });
      void this.autosave.discard(this.clave); // borrador enviado → limpiar
      this.conduces.update((list) => list.filter((x) => x.id !== c.id));
      this.cerrarDetalle();
      this.motion.momento('entrada'); // CL2 F4 — caja entra al almacén (recepción OK, también offline)
      this.toast.success(this.i18n.t('Recepción guardada.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo guardar.'));
    } finally {
      this.submitting.set(false);
    }
  }

  back(): void {
    if (this.activo()) {
      this.cerrarDetalle();
      return;
    }
    this.location.back();
  }
}
