import { ChangeDetectionStrategy, Component, OnDestroy, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Capacitor } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { DecimalPipe, Location } from '@angular/common';
import { Router } from '@angular/router';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { SyncService } from '../../../core/sync/sync.service';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { GeocodingService } from '../../../core/services/geocoding.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { PermisoGateService } from '../../../core/services/permiso-gate.service';
import { formatearDuracion } from '../../../core/util/duracion';
import {
  ConducesService,
  RutaDetalleTransporte,
  RutaParadaEjec,
  RutaConduceEjec,
  ParadaEstado,
} from '../../../core/services/conduces.service';
import { ToastService } from '../../../core/services/toast.service';
import { NetworkService } from '../../../core/services/network.service';
import { Conduce, RutaHoy } from '../../../core/models/transporte.model';

const ESTADO_RUTA_LABEL: Record<string, string> = {
  planificada: 'Planificada',
  en_curso: 'En curso',
  completada: 'Completada',
  cancelada: 'Cancelada',
};

const PARADA_ESTADO_LABEL: Record<ParadaEstado, string> = {
  pendiente: 'Pendiente',
  en_camino: 'En camino',
  entregada: 'Entregada',
  omitida: 'Omitida',
};

/** Driver's routes + dispatched conduces for the day. */
@Component({
  selector: 'app-conduces',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, SyncBar, DecimalPipe, SignaturePad, PhotoSlot],
  templateUrl: './conduces.html',
  styleUrl: './conduces.scss',
})
export class ConducesPage implements OnDestroy {
  private service = inject(ConducesService);
  private router = inject(Router);
  private location = inject(Location);
  private toast = inject(ToastService);
  private network = inject(NetworkService);
  private sync = inject(SyncService);
  private geo = inject(GeocodingService);
  private permissions = inject(PermissionsService);
  private gate = inject(PermisoGateService);
  private primerSync = true;
  readonly fmtDur = formatearDuracion;

  // AE — ETA (min) a la próxima parada por ruta, calculada bajo demanda con el GPS.
  etaProxima = signal<Record<string, number | null>>({});
  calculandoEta = signal<string | null>(null);

  estadoLabel(estado: string): string {
    return ESTADO_RUTA_LABEL[estado] ?? estado;
  }
  paradaEstadoLabel(e: ParadaEstado): string {
    return PARADA_ESTADO_LABEL[e] ?? e;
  }

  conduces = signal<Conduce[]>([]);
  rutas = signal<RutaHoy[]>([]);
  loading = signal(true);

  // AE5 — detalle de EJECUCIÓN de la ruta (paradas con estado + conduce vinculado)
  // expandible en el sitio.
  private expandidas = signal<Set<string>>(new Set());
  private detalles = signal<Record<string, RutaDetalleTransporte>>({});
  // AC6 — fotos de evidencia inicial de la ruta (no cambian durante la ejecución).
  private fotosRuta = signal<Record<string, string[]>>({});
  fotos(id: string): string[] {
    return this.fotosRuta()[id] ?? [];
  }
  /** AE5 — parada cuyo selector "Adjuntar conduce" está abierto. */
  adjuntando = signal<string | null>(null);
  /** AE5 — parada con una acción en curso (spinner/anti-doble-tap). */
  paradaOcupada = signal<string | null>(null);

  estaExpandida(id: string): boolean {
    return this.expandidas().has(id);
  }
  detalle(id: string): RutaDetalleTransporte | null {
    return this.detalles()[id] ?? null;
  }
  toggleDetalle(rutaId: string): void {
    const abierto = this.expandidas().has(rutaId);
    this.expandidas.update((s) => {
      const next = new Set(s);
      abierto ? next.delete(rutaId) : next.add(rutaId);
      return next;
    });
    if (!abierto) this.cargarDetalle(rutaId);
  }

  /** Carga (una vez) el detalle de ejecución + las fotos de una ruta. */
  private cargarDetalle(rutaId: string): void {
    if (this.detalles()[rutaId]) return;
    void this.service
      .getRutaDetalleTransporte(rutaId)
      .then((d) => this.detalles.update((m) => ({ ...m, [rutaId]: d })));
    // AC6 — fotos de evidencia inicial (una sola vez; no cambian en ejecución).
    void this.service
      .getRutaDetalle(rutaId)
      .then((d) => this.fotosRuta.update((m) => ({ ...m, [rutaId]: d.fotos })));
  }

  /** AE — abre automáticamente el detalle de las rutas EN CURSO: el chofer ve sus
   *  paradas sin un toque extra al entrar. */
  private autoExpandEnCurso(): void {
    for (const r of this.rutas()) {
      if (r.estado === 'en_curso' && !this.expandidas().has(r.id)) {
        this.expandidas.update((s) => new Set(s).add(r.id));
        this.cargarDetalle(r.id);
      }
    }
  }

  /** AE — progreso de la ruta: paradas entregadas de total (null si sin paradas). */
  progreso(rutaId: string): { entregadas: number; total: number } | null {
    const d = this.detalle(rutaId);
    if (!d || !d.paradas.length) return null;
    return { entregadas: d.paradas.filter((p) => p.estado === 'entregada').length, total: d.paradas.length };
  }

  /** AE — próxima parada a atender (la primera pendiente o en camino). */
  proximaParada(rutaId: string): RutaParadaEjec | null {
    return (
      this.detalle(rutaId)?.paradas.find((p) => p.estado === 'pendiente' || p.estado === 'en_camino') ?? null
    );
  }

  /** AE — ¿la próxima parada tiene coordenadas para calcular el tiempo? */
  proximaTieneCoords(rutaId: string): boolean {
    const np = this.proximaParada(rutaId);
    return !!np && np.lat != null && np.lng != null;
  }

  /** AE — tiempo estimado (auto) desde tu posición actual a la próxima parada. */
  async calcularEta(rutaId: string): Promise<void> {
    // AE7 — guard por RUTA (antes era global y bloqueaba calcular el ETA de otra
    // ruta mientras una calculaba — y el cálculo con GPS/OSRM tarda segundos).
    if (this.calculandoEta() === rutaId) return;
    const np = this.proximaParada(rutaId);
    if (!np || np.lat == null || np.lng == null) return;
    if (!(await this.gate.asegurar('location'))) return;
    this.calculandoEta.set(rutaId);
    try {
      const r = await this.permissions.getPosition({ highAccuracy: true, timeout: 10000 });
      if (!r.ok) {
        this.toast.error('No se pudo obtener tu ubicación. Reintenta en un lugar despejado.');
        return;
      }
      const ruta = await this.geo.ruta({ lat: r.lat, lng: r.lng }, { lat: np.lat, lng: np.lng });
      this.etaProxima.update((m) => ({ ...m, [rutaId]: ruta ? Math.round(ruta.duracionSeg / 60) : null }));
      if (!ruta) this.toast.error('No se pudo calcular el tiempo ahora (sin señal o sin ruta).');
    } finally {
      this.calculandoEta.set(null);
    }
  }

  private async refrescarDetalle(rutaId: string): Promise<void> {
    await this.service.invalidarRutaDetalle(rutaId);
    const d = await this.service.getRutaDetalleTransporte(rutaId);
    // Si mientras cargábamos aparecieron ops pendientes (el chofer tocó "entregar"
    // o "adjuntar" durante el refetch), NO pisar el estado optimista con el snapshot
    // viejo del servidor. La próxima reconciliación (con outbox drenado) lo cuadra.
    if (this.sync.pendingCount() > 0) return;
    this.detalles.update((m) => ({ ...m, [rutaId]: d }));
  }

  // ── AE5 — ejecución por parada ─────────────────────────────────────────────

  /** El conduce vinculado a una parada (para pintar sus ítems + botón entregar). */
  conduceDeParada(rutaId: string, p: RutaParadaEjec): RutaConduceEjec | null {
    if (!p.conduce_id) return null;
    return this.detalle(rutaId)?.conduces.find((c) => c.id === p.conduce_id) ?? null;
  }

  /** Conduces del chofer que aún no están atados a NINGUNA parada (de esta u otra
   *  ruta cargada). AE7 — antes solo excluía los de ESTA ruta, así que un conduce
   *  ya atado a otra ruta seguía ofrecido aquí y adjuntarlo lo "robaba" de la otra. */
  conducesParaAdjuntar(_rutaId: string): Conduce[] {
    const usados = new Set<string>();
    for (const d of Object.values(this.detalles())) {
      for (const p of d.paradas) if (p.conduce_id) usados.add(p.conduce_id);
    }
    return this.conduces().filter((c) => !usados.has(c.id));
  }

  toggleAdjuntar(paradaId: string): void {
    this.adjuntando.update((cur) => (cur === paradaId ? null : paradaId));
  }

  async adjuntarConduce(rutaId: string, paradaId: string, conduceId: string): Promise<void> {
    if (this.paradaOcupada()) return;
    this.paradaOcupada.set(paradaId);
    // Optimista (offline-first): ata el conduce a la parada e inyéctalo en el
    // detalle para que se vea al instante; el outbox lo confirma al sincronizar.
    const conduce = this.conduces().find((c) => c.id === conduceId);
    this.actualizarParadaLocal(rutaId, paradaId, { conduce_id: conduceId });
    if (conduce) this.inyectarConduceLocal(rutaId, conduce, paradaId);
    this.adjuntando.set(null);
    try {
      await this.service.vincularConduceParada(conduceId, paradaId);
      this.toast.success('Conduce adjuntado a la parada.');
    } catch (e) {
      this.toast.error(this.msgError(e, 'No se pudo adjuntar el conduce.'));
    } finally {
      this.paradaOcupada.set(null);
    }
  }

  // ── AE — entregar una parada SIN conduce con firma + evidencia (prueba AC7) ──
  private sigPad = viewChild(SignaturePad);
  entregando = signal<{ rutaId: string; parada: RutaParadaEjec } | null>(null);
  entRecibio = signal('');
  entFirmaBlob = signal<Blob | null>(null);
  entFoto = signal<CapturedPhoto | null>(null);
  entGuardando = signal(false);

  abrirEntregarParada(rutaId: string, p: RutaParadaEjec): void {
    this.entRecibio.set(p.entregado_a ?? '');
    this.entFirmaBlob.set(null);
    this.entFoto.set(null);
    this.entregando.set({ rutaId, parada: p });
  }
  cerrarEntregarParada(): void {
    this.entregando.set(null);
  }
  async onEntFirma(has: boolean): Promise<void> {
    this.entFirmaBlob.set(has ? ((await this.sigPad()?.toBlob()) ?? null) : null);
  }
  onEntFoto(photo: CapturedPhoto): void {
    this.entFoto.set(photo);
  }
  onEntFotoCleared(): void {
    this.entFoto.set(null);
  }

  /** AE — confirma la entrega de una parada con nombre + firma (+ foto opcional). */
  async confirmarEntregarParada(): Promise<void> {
    const ctx = this.entregando();
    if (!ctx || this.entGuardando()) return;
    if (!this.entRecibio().trim()) {
      this.toast.error('Escribe quién recibió.');
      return;
    }
    if (!this.entFirmaBlob()) {
      this.toast.error('Falta la firma de quien recibe.');
      return;
    }
    this.entGuardando.set(true);
    const { rutaId, parada } = ctx;
    const nombre = this.entRecibio().trim();
    // Optimista: la parada queda entregada al instante.
    this.actualizarParadaLocal(rutaId, parada.id, {
      estado: 'entregada',
      entregada_at: new Date().toISOString(),
      entregado_a: nombre,
    });
    this.entregando.set(null);
    try {
      await this.service.avanzarParada(parada.id, 'entregada', {
        entregadoA: nombre,
        firma: this.entFirmaBlob(),
        foto: this.entFoto()?.blob ?? null,
      });
      this.toast.success('Parada entregada.');
    } catch (e) {
      this.toast.error(this.msgError(e, 'No se pudo registrar la entrega.'));
    } finally {
      this.entGuardando.set(false);
    }
  }

  /** AE5 — avanza la parada (en_camino / entregada / omitida). Offline-first:
   *  aplica el cambio de forma optimista y lo encola en el outbox. */
  async marcarParada(rutaId: string, p: RutaParadaEjec, estado: ParadaEstado): Promise<void> {
    if (this.paradaOcupada()) return;
    this.paradaOcupada.set(p.id);
    const now = new Date().toISOString();
    const cambios: Partial<RutaParadaEjec> = { estado };
    if (estado === 'en_camino') cambios.llegada_at = p.llegada_at ?? now;
    if (estado === 'entregada') cambios.entregada_at = now;
    this.actualizarParadaLocal(rutaId, p.id, cambios); // optimista
    try {
      await this.service.avanzarParada(p.id, estado);
    } catch (e) {
      this.toast.error(this.msgError(e, 'No se pudo actualizar la parada.'));
    } finally {
      this.paradaOcupada.set(null);
    }
  }

  /** Aplica cambios optimistas a una parada del detalle cargado. */
  private actualizarParadaLocal(rutaId: string, paradaId: string, cambios: Partial<RutaParadaEjec>): void {
    this.detalles.update((m) => {
      const d = m[rutaId];
      if (!d) return m;
      return {
        ...m,
        [rutaId]: { ...d, paradas: d.paradas.map((p) => (p.id === paradaId ? { ...p, ...cambios } : p)) },
      };
    });
    // AE7 — si la parada AVANZÓ de estado, la "próxima parada" cambió → el ETA
    // calculado quedó viejo (apuntaba a la parada anterior). Lo invalidamos para
    // que no muestre un tiempo engañoso; el chofer puede recalcular.
    if (cambios.estado !== undefined) {
      this.etaProxima.update((m) => {
        const next = { ...m };
        delete next[rutaId];
        return next;
      });
    }
  }

  /** Inyecta (optimista) un conduce recién atado a una parada en el detalle. */
  private inyectarConduceLocal(rutaId: string, c: Conduce, paradaId: string): void {
    this.detalles.update((m) => {
      const d = m[rutaId];
      if (!d) return m;
      if (d.conduces.some((x) => x.id === c.id)) {
        return {
          ...m,
          [rutaId]: {
            ...d,
            conduces: d.conduces.map((x) => (x.id === c.id ? { ...x, ruta_parada_id: paradaId } : x)),
          },
        };
      }
      const nuevo: RutaConduceEjec = {
        id: c.id,
        fecha: c.fecha,
        estado: c.estado,
        destino: c.destino,
        bodega: c.bodega,
        ruta_parada_id: paradaId,
        parada_ubicacion: null,
        items: c.items.map((it) => ({ articulo: it.articulo, unidad: it.unidad, cantidad: it.cantidad })),
      };
      return { ...m, [rutaId]: { ...d, conduces: [...d.conduces, nuevo] } };
    });
  }

  /** AE5 — entregar el conduce de la parada (firmas AC7 → cierra la parada solo). */
  entregarConduceParada(conduceId: string): void {
    void this.router.navigate(['/transporte/conduces', conduceId]);
  }

  /** AE5 — navegar a la parada (usa sus coords si las tiene, si no su texto). */
  comoLlegarParada(p: RutaParadaEjec): void {
    void this.comoLlegarA(p.ubicacion, p.lat, p.lng);
  }

  private msgError(e: unknown, fallback: string): string {
    if (!this.network.online()) return 'Sin señal. Vuelve a intentarlo cuando tengas conexión.';
    return e instanceof Error ? e.message : fallback;
  }

  /** Y4 — reloj que avanza cada segundo para el contador en vivo de rutas en curso. */
  now = signal(Date.now());
  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    void this.load();
    // El contador se calcula desde `iniciada_at` (no un acumulador en memoria),
    // así sobrevive a salir y volver a la pantalla.
    this.timer = setInterval(() => this.now.set(Date.now()), 1000);
    // AE — al drenar el outbox (p. ej. una entrega de conduce que cierra su parada
    // vía trigger), reconciliar con el servidor los detalles de ruta abiertos.
    effect(() => {
      this.sync.changed();
      const pend = this.sync.pendingCount();
      if (this.primerSync) {
        this.primerSync = false;
        return;
      }
      // Reconciliar SOLO cuando el outbox está drenado y hay señal: si aún hay ops
      // pendientes (una parada recién marcada), refetch traería el estado viejo del
      // servidor y pisaría el cambio optimista. Offline, conservamos lo cargado.
      if (pend > 0 || !this.network.online()) return;
      const abiertas = untracked(() => this.expandidas());
      for (const id of abiertas) void this.refrescarDetalle(id);
    });
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [c, r] = await Promise.all([this.service.misConduces(), this.service.misRutas()]);
      this.conduces.set(c);
      this.rutas.set(r);
      this.autoExpandEnCurso(); // AE — abre las paradas de las rutas en curso
      // Y3 — al ver la lista, las rutas planificadas dejan de ser "nuevas" (limpia el badge).
      void this.service.marcarRutasVistas();
    } finally {
      this.loading.set(false);
    }
  }

  entregar(conduce: Conduce): void {
    void this.router.navigate(['/transporte/conduces', conduce.id]);
  }

  crearRuta(): void {
    void this.router.navigate(['/transporte/rutas/crear']);
  }

  /** AE — generar un conduce (sacar material de una bodega hacia una obra). */
  generarConduce(): void {
    void this.router.navigate(['/transporte/generar-conduce']);
  }

  async ruta(rutaId: string, estado: 'en_curso' | 'completada'): Promise<void> {
    // Y4 — capturar el instante del TAP (no el del round-trip al servidor).
    const at = new Date().toISOString();
    try {
      await this.service.marcarRuta(rutaId, estado, at);
      this.rutas.update((list) =>
        list.map((r) =>
          r.id === rutaId
            ? {
                ...r,
                estado,
                // Optimista: arranca el contador / fija el fin al instante del TAP.
                iniciada_at: estado === 'en_curso' ? (r.iniciada_at ?? at) : r.iniciada_at,
                finalizada_at: estado === 'completada' ? at : r.finalizada_at,
              }
            : r,
        ),
      );
    } catch (e) {
      this.toast.error(
        !this.network.online()
          ? 'Sin señal. Vuelve a intentar la ruta cuando tengas conexión.'
          : e instanceof Error
            ? e.message
            : 'No se pudo actualizar la ruta.',
      );
    }
  }

  // ---- Y4 — tiempos de ruta -------------------------------------------------

  private fmtHms(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  }

  /** Contador en vivo (hh:mm:ss) de una ruta en curso; null si no aplica. */
  cronometro(r: RutaHoy): string | null {
    if (r.estado !== 'en_curso' || !r.iniciada_at) return null;
    return this.fmtHms(this.now() - new Date(r.iniciada_at).getTime());
  }

  /** Resumen "real vs estimado" de una ruta completada; null si faltan datos. */
  resumenTiempo(r: RutaHoy): { real: number; est: number | null; pct: number | null } | null {
    if (r.estado !== 'completada' || !r.iniciada_at || !r.finalizada_at) return null;
    const real = Math.max(
      0,
      Math.round((new Date(r.finalizada_at).getTime() - new Date(r.iniciada_at).getTime()) / 60000),
    );
    const est = r.tiempo_estimado_min ?? null;
    const pct = est && est > 0 ? Math.round(((real - est) / est) * 100) : null;
    return { real, est, pct };
  }

  /**
   * W2 — abre la NAVEGACIÓN de Google Maps hacia el destino de la ruta.
   * En nativo intenta el intent `google.navigation:` (abre la app de Maps con la
   * ruta trazada); si Maps no está instalado o el intent falla, cae a la URL
   * https. En web/PWA siempre usa la URL https.
   */
  comoLlegar(r: RutaHoy): void {
    void this.comoLlegarA(r.destino, null, null);
  }

  /**
   * W2/AE5 — abre la NAVEGACIÓN de Google Maps hacia un destino (ruta o parada).
   * Con coordenadas navega a `lat,lng` (más preciso); sin ellas, por el texto.
   * En nativo intenta el intent `google.navigation:`; si falla, cae a la URL https.
   */
  private async comoLlegarA(
    destino: string | null,
    lat: number | null,
    lng: number | null,
  ): Promise<void> {
    const q = lat != null && lng != null ? `${lat},${lng}` : (destino ? encodeURIComponent(destino) : '');
    if (!q) return;
    const httpsUrl = 'https://www.google.com/maps/dir/?api=1&destination=' + q;

    if (Capacitor.isNativePlatform()) {
      try {
        const navUrl = 'google.navigation:q=' + q;
        const { value } = await AppLauncher.canOpenUrl({ url: navUrl });
        if (value) {
          await AppLauncher.openUrl({ url: navUrl });
          return;
        }
      } catch {
        /* cae al fallback https */
      }
      try {
        await AppLauncher.openUrl({ url: httpsUrl });
        return;
      } catch {
        /* último recurso: window.open */
      }
    }
    window.open(httpsUrl, '_system');
  }

  back(): void {
    this.location.back();
  }
}
