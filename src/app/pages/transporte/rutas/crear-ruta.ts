import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

import { SelectList, SelectOption } from '../../../shared/ui/select-list/select-list';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { resetScrollOnStep } from '../../../shared/util/scroll';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { LocationPicker, UbicacionSeleccionada } from '../../../shared/ui/location-picker/location-picker';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { VehiculoPicker } from '../../../shared/ui/vehiculo-picker/vehiculo-picker';
import { VoiceNotes, VoiceNoteItem } from '../../../shared/ui/voice-notes/voice-notes';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { ConducesService, LugarDestino, RutaParadaCaptura, RutaTipo } from '../../../core/services/conduces.service';
import { ConductoresService } from '../../../core/services/conductores.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { VehiculoDisponible } from '../../../core/models/transporte.model';
import { GeocodingService } from '../../../core/services/geocoding.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { PermisoGateService } from '../../../core/services/permiso-gate.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { formatearDuracion } from '../../../core/util/duracion';

type DestinoModo = 'lugar' | 'mapa';

/** AC13 — una parada intermedia editable en el wizard. */
interface ParadaUI {
  /** AE — cómo se fija la parada: por obra/almacén o marcándola en el mapa. */
  modo: 'lugar' | 'mapa';
  lugarId: string;
  ubicacion: string;
  lat: number | null;
  lng: number | null;
  notas: string;
  proyectoId: string | null;
}

/**
 * Crear ruta desde el móvil (R7). Espeja la creación de rutas de la web SGC
 * (vehículo + origen + destino [obra o libre] + fecha + km/notas opcionales),
 * simplificada para campo. Offline-first vía outbox (crear_ruta_app idempotente).
 */
@Component({
  selector: 'app-crear-ruta',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, SelectList, OptionButton, StepBar, WizardFooter, Skeleton, LocationPicker, ConfirmDialog, VehiculoPicker, VoiceNotes, PhotoSlot],
  templateUrl: './crear-ruta.html',
  styleUrl: './crear-ruta.scss',
})
export class CrearRutaPage implements OnDestroy {
  private conduces = inject(ConducesService);
  private conductores = inject(ConductoresService);
  private ctx = inject(UserContextService);
  private geo = inject(GeocodingService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private permissions = inject(PermissionsService);
  private gate = inject(PermisoGateService);
  private router = inject(Router);
  private location = inject(Location);
  private navGuard = inject(NavGuardService);

  fmtDur = formatearDuracion; // U23 — para el template

  // El jefe de flota (elevado) asigna la ruta a un conductor; el chofer se la crea
  // a sí mismo y NO ve el paso "conductor" (el backend la auto-asigna a quien la crea).
  readonly esElevado = this.ctx.esFlotaElevado();

  // Wizard tipo hoja. Elevado (6): 1 vehículo → 2 conductor → 3 origen → 4 destino →
  // 5 detalles → 6 resumen. Chofer (5): se salta el paso 2 (conductor).
  private readonly MAX_STEP = 6;
  readonly total = computed(() => (this.esElevado ? 6 : 5));
  step = signal(1);
  // Paso "visible" para la barra de progreso: en el chofer los pasos internos
  // 1,3,4,5,6 se muestran como 1..5 (se descuenta el paso 2 saltado).
  displayStep = computed(() => {
    const s = this.step();
    return this.esElevado ? s : s > 2 ? s - 1 : s;
  });

  loading = signal(true);
  submitting = signal(false);
  done = signal(false);
  confirmSalir = signal(false); // U4 — confirmar descarte si hay datos

  lugares = signal<LugarDestino[]>([]);

  // S16 — el jefe de flota asigna la ruta a un conductor (dispara la notificación).
  conductorId = signal('');
  conductorOpts = signal<SelectOption[]>([]);

  vehiculoId = signal('');
  vehiculoLabel = signal(''); // B1 — placa/modelo del vehículo elegido del pool
  origen = signal('');
  usandoGps = signal(false); // U21 — origen fijado por ubicación/mapa
  origenMapa = signal(false); // muestra el picker de origen
  origenLugarId = signal(''); // U22 — origen por obra/almacén
  origenLugar = signal(false); // muestra el selector de obra/almacén de origen
  destinoModo = signal<DestinoModo>('lugar');
  destinoLugarId = signal('');
  destinoMapaTexto = signal('');
  destinoMapaCoords = signal<{ lat: number; lng: number } | null>(null);
  km = signal<number | null>(null);
  notas = signal('');
  voces = signal<VoiceNoteItem[]>([]); // Z23 — notas de voz

  // AD6 — tipo de ruta (solo el chofer al crearse la suya; material no exige nada
  // nuevo, personal/traslado no exigen carga). El elevado siempre crea 'material'.
  tipoRuta = signal<RutaTipo>('material');
  readonly tiposRuta: { valor: RutaTipo; label: string; icon: string; hint: string }[] = [
    { valor: 'material', label: 'Material', icon: '📦', hint: 'Llevas carga/mercancía' },
    { valor: 'personal', label: 'Personal', icon: '👷', hint: 'Repartes personal entre obras' },
    { valor: 'traslado', label: 'Traslado', icon: '🚚', hint: 'Te mueves sin carga' },
  ];

  // AC13 — paradas intermedias (estilo Uber): entre el origen y el destino final.
  paradas = signal<ParadaUI[]>([]);
  // AC6 — fotos de evidencia inicial (carga / vehículo / documento), solo cámara.
  fotoCarga = signal<CapturedPhoto | null>(null);
  fotoVehiculo = signal<CapturedPhoto | null>(null);
  fotoDocumento = signal<CapturedPhoto | null>(null);

  // U23 — duración estimada (min) calculada por OSRM cuando hay coords de ambos extremos.
  duracionMin = signal<number | null>(null);
  calculandoRuta = signal(false);

  private gps: { lat: number; lng: number } | null = null;

  // U22 — obras + almacenes (con ícono por tipo) para los selectores de origen/destino.
  // Y2 — el ícono va por ítem (🏗️ obra / 🏢 bodega); NO se hornea en el label ni
  // se repite con el icon de la lista (eso causaba el doble emoji).
  lugarOpts = computed<SelectOption[]>(() =>
    this.lugares().map((l) => ({
      id: l.id,
      label: l.nombre,
      icon: l.tipo === 'obra' ? '🏗️' : '🏢',
    })),
  );

  selectedLugar = computed<LugarDestino | null>(
    () => this.lugares().find((l) => l.id === this.destinoLugarId()) ?? null,
  );

  selectedOrigenLugar = computed<LugarDestino | null>(
    () => this.lugares().find((l) => l.id === this.origenLugarId()) ?? null,
  );

  private readonly backHandler = (): boolean => {
    if (!this.done() && this.tieneDatos()) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  constructor() {
    // Crear ruta lo puede usar el jefe de flota (asigna a un conductor) y también
    // el chofer (se la crea a sí mismo → el backend la auto-asigna a quien la crea).
    resetScrollOnStep(() => this.step(), () => this.done()); // U3/U4
    void this.load();
    void this.captureGps();
    this.navGuard.register(this.backHandler); // U4 — botón físico Android
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      // B1 — el vehículo se elige del pool (VehiculoPicker); aquí solo cargamos
      // los lugares (obras/almacenes) para origen/destino + S16 los conductores.
      const [lugares, conductores] = await Promise.all([
        this.conduces.getLugaresDestino(),
        this.conductores.getConductores().catch(() => []),
      ]);
      this.lugares.set(lugares);
      this.conductorOpts.set(conductores.map((c) => ({ id: c.id, label: c.nombre })));
    } finally {
      this.loading.set(false);
    }
  }

  /** B1 — vehículo elegido del pool: continúa creando la ruta con ese vehículo. */
  onVehiculoElegido(v: VehiculoDisponible): void {
    this.vehiculoId.set(v.vehiculo_id);
    this.vehiculoLabel.set(`${v.placa} · ${v.marca} ${v.modelo}`.trim());
  }

  /** B1 — volver a elegir otro vehículo del pool. */
  cambiarVehiculo(): void {
    this.vehiculoId.set('');
    this.vehiculoLabel.set('');
  }

  private async captureGps(): Promise<void> {
    // Best-effort al abrir: solo pre-carga si el permiso YA está concedido (no
    // abre diálogos aquí; eso pasa cuando el usuario toca "usar mi ubicación").
    if ((await this.permissions.checkLocation()) !== 'granted') return;
    const r = await this.permissions.getPosition({ timeout: 8000 });
    this.gps = r.ok ? { lat: r.lat, lng: r.lng } : null;
  }

  /**
   * U21 — "usar mi ubicación actual" como origen, con permiso nativo y error
   * visible. Pide permiso de geolocalización y, si lo concede, fija el origen
   * con las coordenadas del GPS.
   */
  async usarMiUbicacion(): Promise<void> {
    // X4 — primero aseguramos el permiso con su explicación; si el usuario no lo
    // concede, la tarjeta ya le mostró cómo activarlo → no seguimos en silencio.
    if (!(await this.gate.asegurar('location'))) return;
    const r = await this.permissions.getPosition({ highAccuracy: true, timeout: 10000 });
    if (r.ok) {
      this.gps = { lat: r.lat, lng: r.lng };
      this.origen.set('Mi ubicación actual');
      this.usandoGps.set(true);
      this.origenLugarId.set('');
      this.toast.success('Ubicación actual fijada como origen.');
      void this.recalcularRuta();
      return;
    }
    // P2 — mensajes claros por causa; ofrecer ajustes si es denegado permanente.
    if (r.reason === 'denied-permanent') {
      if (this.permissions.isNative) {
        this.toast.withAction('Ubicación bloqueada para esta app.', {
          label: 'Abrir ajustes',
          run: () => void this.permissions.openAppSettings(),
        });
      } else {
        this.toast.error('Ubicación bloqueada. Actívala en los ajustes del navegador.');
      }
    } else if (r.reason === 'denied') {
      this.toast.error('Necesito tu permiso de ubicación para fijar el origen.');
    } else if (r.reason === 'timeout') {
      this.toast.error('No se pudo obtener la señal GPS. Ve a un lugar despejado y reintenta.');
    } else {
      this.toast.error('No se pudo obtener tu ubicación. Escribe el origen o márcalo en el mapa.');
    }
  }

  onOrigenInput(v: string): void {
    this.origen.set(v);
    // Si el usuario escribe manualmente, deja de usar las coords del GPS/mapa/lugar.
    if (this.usandoGps()) {
      this.usandoGps.set(false);
      this.gps = null;
      this.origenLugarId.set('');
      void this.recalcularRuta();
    }
  }

  /** U20 — origen marcado en el mapa (pin/búsqueda/ubicación dentro del picker). */
  onOrigenUbicacion(u: UbicacionSeleccionada): void {
    this.gps = { lat: u.latitud, lng: u.longitud };
    this.origen.set(u.direccion || 'Punto en el mapa');
    this.usandoGps.set(true);
    this.origenLugarId.set('');
    void this.recalcularRuta();
  }

  /** U22 — origen por obra o almacén (usa sus coordenadas guardadas). */
  onOrigenLugar(id: string): void {
    this.origenLugarId.set(id);
    const lugar = this.selectedOrigenLugar();
    if (!lugar) return;
    this.origen.set(lugar.nombre);
    if (lugar.latitud != null && lugar.longitud != null) {
      this.gps = { lat: lugar.latitud, lng: lugar.longitud };
      this.usandoGps.set(true);
    } else {
      this.gps = null;
      this.usandoGps.set(false);
    }
    void this.recalcularRuta();
  }

  // AC13 — gestión de paradas intermedias (agregar / quitar / reordenar).
  agregarParada(): void {
    this.paradas.update((list) => [
      ...list,
      { modo: 'lugar', lugarId: '', ubicacion: '', lat: null, lng: null, notas: '', proyectoId: null },
    ]);
  }
  /** AE — alternar cómo se fija la parada: obra/almacén o punto en el mapa. */
  setParadaModo(i: number, modo: 'lugar' | 'mapa'): void {
    this.paradas.update((list) => list.map((p, idx) => (idx === i ? { ...p, modo } : p)));
  }
  /** AE — parada marcada/buscada en el mapa (pin, buscador o "mi ubicación"). */
  onParadaUbicacion(i: number, u: UbicacionSeleccionada): void {
    this.paradas.update((list) =>
      list.map((p, idx) =>
        idx === i
          ? { ...p, ubicacion: u.direccion || 'Punto en el mapa', lat: u.latitud, lng: u.longitud, lugarId: '', proyectoId: null }
          : p,
      ),
    );
  }
  quitarParada(i: number): void {
    this.paradas.update((list) => list.filter((_, idx) => idx !== i));
  }
  moverParada(i: number, dir: -1 | 1): void {
    this.paradas.update((list) => {
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  /** AC13 — parada por obra/almacén (usa sus coordenadas). */
  setParadaLugar(i: number, id: string): void {
    const lugar = this.lugares().find((l) => l.id === id);
    this.paradas.update((list) =>
      list.map((p, idx) =>
        idx === i
          ? {
              ...p,
              lugarId: id,
              ubicacion: lugar?.nombre ?? p.ubicacion,
              lat: lugar?.latitud ?? null,
              lng: lugar?.longitud ?? null,
              proyectoId: lugar?.tipo === 'obra' ? id : null,
            }
          : p,
      ),
    );
  }
  setParadaNota(i: number, texto: string): void {
    this.paradas.update((list) => list.map((p, idx) => (idx === i ? { ...p, notas: texto } : p)));
  }

  /** AC6 — fotos de evidencia inicial capturadas (no nulas), para el resumen. */
  fotosEvidencia = computed(() =>
    [this.fotoCarga(), this.fotoVehiculo(), this.fotoDocumento()].filter(
      (f): f is CapturedPhoto => !!f,
    ),
  );

  /** U20/U22 — destino marcado en el mapa. */
  onDestinoUbicacion(u: UbicacionSeleccionada): void {
    this.destinoMapaCoords.set({ lat: u.latitud, lng: u.longitud });
    this.destinoMapaTexto.set(u.direccion || 'Punto en el mapa');
    void this.recalcularRuta();
  }

  /** U22 — destino por obra o almacén. */
  onDestinoLugar(id: string): void {
    this.destinoLugarId.set(id);
    void this.recalcularRuta();
  }

  private destinoCoords(): { lat: number; lng: number } | null {
    if (this.destinoModo() === 'lugar') {
      const l = this.selectedLugar();
      return l?.latitud != null && l?.longitud != null ? { lat: l.latitud, lng: l.longitud } : null;
    }
    return this.destinoMapaCoords();
  }

  /**
   * U23 — recalcula distancia + duración estimadas (OSRM) cuando hay coords de
   * origen y destino. Autollena km si está vacío. Silencioso si falla (offline).
   */
  private async recalcularRuta(): Promise<void> {
    const o = this.gps;
    const d = this.destinoCoords();
    if (!o || !d) {
      this.duracionMin.set(null);
      return;
    }
    this.calculandoRuta.set(true);
    try {
      const r = await this.geo.ruta(o, d);
      if (r) {
        this.duracionMin.set(Math.round(r.duracionSeg / 60));
        if (this.km() == null) this.km.set(Math.round(r.distanciaM / 1000));
      } else {
        this.duracionMin.set(null);
      }
    } finally {
      this.calculandoRuta.set(false);
    }
  }

  private destinoTexto(): string {
    if (this.destinoModo() === 'lugar') {
      return this.selectedLugar()?.nombre ?? '';
    }
    return this.destinoMapaTexto().trim();
  }

  // S16 — nombre del conductor + destino para el resumen (paso 6).
  conductorNombre = computed(
    () => this.conductorOpts().find((o) => o.id === this.conductorId())?.label ?? '',
  );
  destinoResumen = computed(() =>
    this.destinoModo() === 'lugar' ? (this.selectedLugar()?.nombre ?? '') : this.destinoMapaTexto().trim(),
  );

  /** S16 — avanza validando el paso actual. */
  next(): void {
    const s = this.step();
    if (s === 1 && !this.vehiculoId()) {
      this.toast.error('Elige el vehículo.');
      return;
    }
    if (s === 2 && !this.conductorId()) {
      this.toast.error('Elige el conductor al que le asignas la ruta.');
      return;
    }
    if (s === 3 && !this.origen().trim()) {
      this.toast.error('Indica el origen.');
      return;
    }
    if (s === 4 && !this.destinoResumen()) {
      this.toast.error(this.destinoModo() === 'lugar' ? 'Elige la obra o almacén de destino.' : 'Marca el destino en el mapa.');
      return;
    }
    // El chofer se salta el paso 2 (conductor): la ruta es para él mismo.
    let nxt = s + 1;
    if (nxt === 2 && !this.esElevado) nxt = 3;
    this.step.set(Math.min(this.MAX_STEP, nxt));
  }

  /** S16 — retrocede; en el paso 1 intenta salir (con confirmación si hay datos). */
  prev(): void {
    if (this.step() === 1) {
      this.back();
      return;
    }
    let prv = this.step() - 1;
    if (prv === 2 && !this.esElevado) prv = 1; // saltar conductor al retroceder
    this.step.set(Math.max(1, prv));
  }

  async guardar(): Promise<void> {
    if (this.submitting()) return;
    if (!this.vehiculoId()) {
      this.toast.error('Elige el vehículo.');
      return;
    }
    if (this.esElevado && !this.conductorId()) {
      this.toast.error('Elige el conductor al que le asignas la ruta.');
      return;
    }
    if (!this.origen().trim()) {
      this.toast.error('Escribe el origen.');
      return;
    }
    if (!this.destinoTexto()) {
      this.toast.error(this.destinoModo() === 'lugar' ? 'Elige la obra o almacén de destino.' : 'Marca el destino en el mapa.');
      return;
    }
    const lugar = this.destinoModo() === 'lugar' ? this.selectedLugar() : null;
    const mapaCoords = this.destinoModo() === 'mapa' ? this.destinoMapaCoords() : null;
    this.submitting.set(true);
    try {
      await this.conduces.crearRuta({
        vehiculoId: this.vehiculoId(),
        conductorId: this.conductorId() || null,
        tipo: this.tipoRuta(), // AD6 — solo aplica en el alta del chofer (self-assign)
        origen: this.origen().trim(),
        destino: this.destinoTexto(),
        fecha: new Date().toISOString().slice(0, 10),
        destinoProyectoId: lugar?.tipo === 'obra' ? lugar.id : null,
        kmEstimado: this.km(),
        notas: this.notas().trim() || null,
        origen_lat: this.gps?.lat ?? null,
        origen_lng: this.gps?.lng ?? null,
        destino_lat: lugar?.latitud ?? mapaCoords?.lat ?? null,
        destino_lng: lugar?.longitud ?? mapaCoords?.lng ?? null,
        voces: this.voces().map((n) => n.blob),
        // AC13 — paradas intermedias válidas (con ubicación), en orden.
        paradas: this.paradas()
          .filter((p) => p.ubicacion.trim())
          .map<RutaParadaCaptura>((p) => ({
            ubicacion: p.ubicacion.trim(),
            lat: p.lat,
            lng: p.lng,
            notas: p.notas.trim() || null,
            proyectoId: p.proyectoId,
          })),
        // AC6 — fotos de evidencia inicial (carga/vehículo/documento).
        fotos: this.fotosEvidencia().map((f) => f.blob),
      });
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo crear la ruta. Intenta de nuevo.');
    } finally {
      this.submitting.set(false);
    }
  }

  finish(): void {
    void this.router.navigate(['/transporte/conduces'], { replaceUrl: true });
  }

  irAsignar(): void {
    void this.router.navigate(['/transporte/asignar']);
  }

  /** U4 — ¿hay datos que se perderían al salir? */
  private tieneDatos(): boolean {
    return !!(
      this.origen().trim() ||
      this.origenLugarId() ||
      this.destinoLugarId() ||
      this.destinoMapaTexto().trim() ||
      this.km() != null ||
      this.notas().trim() ||
      this.paradas().length > 0 || // AC13
      this.fotosEvidencia().length > 0 // AC6
    );
  }

  back(): void {
    if (this.done()) {
      this.location.back();
      return;
    }
    if (this.tieneDatos()) this.confirmSalir.set(true);
    else this.location.back();
  }

  confirmarSalir(): void {
    this.confirmSalir.set(false);
    this.location.back();
  }

  cancelarSalir(): void {
    this.confirmSalir.set(false);
  }

  get online(): boolean {
    return this.network.online();
  }
}
