import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { SelectOption } from '../../../shared/ui/select-list/select-list';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { resetScrollOnStep } from '../../../shared/util/scroll';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { LocationPicker, UbicacionSeleccionada } from '../../../shared/ui/location-picker/location-picker';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { VehiculoPicker } from '../../../shared/ui/vehiculo-picker/vehiculo-picker';
import { VoiceNotes, VoiceNoteItem } from '../../../shared/ui/voice-notes/voice-notes';
import { AyudantePicker } from '../../../shared/ui/ayudante-picker/ayudante-picker';
import { AyudanteUsuario } from '../../../core/services/ayudante.service';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { ConducesService, LugarDestino, RutaParadaCaptura, RutaTipo } from '../../../core/services/conduces.service';
import { ConductoresService } from '../../../core/services/conductores.service';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { VehiculoDisponible } from '../../../core/models/transporte.model';
import { GeocodingService } from '../../../core/services/geocoding.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { PermisoGateService } from '../../../core/services/permiso-gate.service';
import { TrackingService } from '../../../core/services/tracking.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { DraftBanner } from '../../../shared/ui/draft-banner/draft-banner';
import { formatearDuracion } from '../../../core/util/duracion';

/** AF24.5 — estado del borrador de crear-ruta (sin fotos; se re-capturan). */
interface CrearRutaDraft {
  vehiculoId: string;
  vehiculoLabel: string;
  conductorId: string;
  origen: string;
  origenLat: number | null;
  origenLng: number | null;
  usandoGps: boolean;
  destinoModo: DestinoModo;
  destinoLugarId: string;
  destinoMapaTexto: string;
  destinoMapaCoords: { lat: number; lng: number } | null;
  km: number | null;
  notas: string;
  tipo: RutaTipo;
  paradas: ParadaUI[];
  // AV11 — id estable de la ruta + flag de "documentación pendiente" (se desvió al
  // checklist de uso). Al reanudar se reusa el mismo id → nunca se duplica.
  rutaId?: string;
  holdChecklist?: boolean;
}

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
  imports: [FormsModule, CollapsibleSelect, OptionButton, StepBar, WizardFooter, Skeleton, LocationPicker, ConfirmDialog, VehiculoPicker, VoiceNotes, PhotoSlot, DraftBanner, AyudantePicker],
  templateUrl: './crear-ruta.html',
  styleUrl: './crear-ruta.scss',
})
export class CrearRutaPage implements OnDestroy {
  private conduces = inject(ConducesService);
  private conductores = inject(ConductoresService);
  private vehiculos = inject(VehiculosService);
  private ctx = inject(UserContextService);
  // AI6 — ids de vehículos asignados al chofer actual (para desviar a Uso de vehículo).
  private misAsignados = new Set<string>();
  private geo = inject(GeocodingService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private permissions = inject(PermissionsService);
  private gate = inject(PermisoGateService);
  private tracking = inject(TrackingService);
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  /** AY11 — si la ruta se crea PLANIFICANDO una solicitud de movimiento, su id
   *  (se vincula al crear y pre-llena origen/destino). */
  private solicitudId = this.route.snapshot.queryParamMap.get('solicitud');
  /** AG15 — tarea que originó esta ruta (se enlaza al crear). */
  private tareaVinculada: string | null = null;
  private location = inject(Location);
  private navGuard = inject(NavGuardService);

  // AF24.5 — borrador persistente (retomar si el teléfono se bloquea / muere la app).
  private readonly clave = 'transporte:crear-ruta';
  private hydrated = false;
  draftFecha = signal<number | null>(null);

  fmtDur = formatearDuracion; // U23 — para el template

  // El jefe de flota (elevado) asigna la ruta a un conductor; el chofer se la crea
  // a sí mismo y NO ve el paso "conductor" (el backend la auto-asigna a quien la crea).
  // AY11 — planificar una solicitud SIEMPRE es modo "asignador" (el referente elige
  // el chofer), aunque su rol no sea flota-elevado.
  readonly esElevado = this.ctx.esFlotaElevado() || !!this.solicitudId;

  // AF24 — wizard de ≤4 pasos (igual para chofer y jefe de flota):
  // 1 vehículo (+ conductor si es elevado) · 2 origen + destino + paradas ·
  // 3 carga (foto obligatoria) + notas · 4 resumen.
  readonly total = 4;
  step = signal(1);

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
  /** AT4 — usuario_id del ayudante (opcional); le suma la ruta al incentivo. */
  ayudanteId = signal<string | null>(null);
  onAyudante = (u: AyudanteUsuario | null): void => this.ayudanteId.set(u?.id ?? null);
  // AV11 — id estable de la ruta (idempotencia) + estado "documentación pendiente"
  // cuando el flujo se desvió al checklist de uso y va a reanudar la MISMA ruta.
  rutaId = signal('');
  holdChecklist = signal(false);

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
  // AN — se reincluyen los almacenes SUELTOS (ej. Bodega Central) como origen/destino
  // seleccionable. destinos_transporte() ya NUNCA expone el almacén implícito de una
  // obra (AH9), así que no hay duplicado: solo aparecen las bodegas independientes.
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
    this.tareaVinculada = this.route.snapshot.queryParamMap.get('tarea'); // AG15
    void this.load();
    void this.captureGps();
    this.navGuard.register(this.backHandler); // U4 — botón físico Android
    // AF24.5 — autosave del borrador (sin fotos): al cambiar cualquier campo,
    // guarda el avance para poder retomarlo si el teléfono se bloquea o muere la app.
    effect(() => this.autosaveEffect());
  }

  /** AF24.5 — snapshot + autosave del borrador (se dispara con cualquier cambio). */
  private autosaveEffect(): void {
    const snap: CrearRutaDraft = {
      vehiculoId: this.vehiculoId(),
      vehiculoLabel: this.vehiculoLabel(),
      conductorId: this.conductorId(),
      origen: this.origen(),
      origenLat: this.gps?.lat ?? null,
      origenLng: this.gps?.lng ?? null,
      usandoGps: this.usandoGps(),
      destinoModo: this.destinoModo(),
      destinoLugarId: this.destinoLugarId(),
      destinoMapaTexto: this.destinoMapaTexto(),
      destinoMapaCoords: this.destinoMapaCoords(),
      km: this.km(),
      notas: this.notas(),
      tipo: this.tipoRuta(),
      paradas: this.paradas(),
      rutaId: this.rutaId() || undefined,
      holdChecklist: this.holdChecklist() || undefined,
    };
    // No trackear hasta hidratar / decidir, ni tras enviar.
    if (!this.hydrated || this.done() || this.submitting()) return;
    if (!this.tieneDatos()) return;
    this.autosave.queue(this.clave, snap, {
      tipo: 'crear_ruta',
      etiqueta: 'Ruta',
      ruta: this.location.path(),
    });
  }

  /** AF24.5 — retomar el borrador: rehidrata los campos (las fotos se re-capturan). */
  continuarBorrador(): void {
    const load = async () => {
      const d = await this.borrador.load<CrearRutaDraft>(this.clave);
      if (d) {
        this.vehiculoId.set(d.vehiculoId ?? '');
        this.vehiculoLabel.set(d.vehiculoLabel ?? '');
        this.conductorId.set(d.conductorId ?? '');
        this.origen.set(d.origen ?? '');
        this.gps = d.origenLat != null && d.origenLng != null ? { lat: d.origenLat, lng: d.origenLng } : null;
        this.usandoGps.set(d.usandoGps ?? false);
        this.destinoModo.set(d.destinoModo ?? 'lugar');
        this.destinoLugarId.set(d.destinoLugarId ?? '');
        this.destinoMapaTexto.set(d.destinoMapaTexto ?? '');
        this.destinoMapaCoords.set(d.destinoMapaCoords ?? null);
        this.km.set(d.km ?? null);
        this.notas.set(d.notas ?? '');
        this.tipoRuta.set(d.tipo ?? 'material');
        this.paradas.set(d.paradas ?? []);
        // AV11 — reusar el MISMO id al reanudar (idempotencia) + estado hold.
        this.rutaId.set(d.rutaId ?? '');
        this.holdChecklist.set(d.holdChecklist ?? false);
      }
      // AF24.5 — rehidrata las fotos del borrador (carga/documento).
      const fotos = await this.borrador.loadFotos(this.clave);
      for (const f of fotos) {
        const photo: CapturedPhoto = { blob: f.blob, previewUrl: URL.createObjectURL(f.blob) };
        if (f.slot === 'carga') this.fotoCarga.set(photo);
        else if (f.slot === 'documento') this.fotoDocumento.set(photo);
      }
      this.draftFecha.set(null);
      this.hydrated = true;
    };
    void load();
  }

  /** AF24.5 — empezar de nuevo: descarta el borrador. */
  descartarBorrador(): void {
    void this.autosave.discard(this.clave);
    this.draftFecha.set(null);
    this.hydrated = true;
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      // B1 — el vehículo se elige del pool (VehiculoPicker); aquí solo cargamos
      // los lugares (obras/almacenes) para origen/destino + S16 los conductores.
      const [lugares, conductores, asig] = await Promise.all([
        this.conduces.getLugaresDestino(),
        this.conductores.getConductores().catch(() => []),
        this.esElevado ? Promise.resolve([]) : this.vehiculos.getMisAsignaciones().catch(() => []),
      ]);
      this.lugares.set(lugares);
      this.conductorOpts.set(conductores.map((c) => ({ id: c.id, label: c.nombre })));
      this.misAsignados = new Set(asig.map((a) => a.vehiculo_id)); // AI6
      // AY11 — al planificar una solicitud, pre-llena origen/destino desde ella
      // (la obra ancla + el otro extremo) y salta el banner de borrador.
      if (this.solicitudId) {
        this.prefillDesdeSolicitud();
        this.hydrated = true;
        return;
      }
      // AF24.5 — ¿hay un borrador previo? Ofrecer retomarlo (banner). Hasta que el
      // usuario decida, NO trackeamos (para no pisar el borrador).
      const d = await this.borrador.get(this.clave);
      if (d) this.draftFecha.set(d.updated_at);
      else this.hydrated = true;
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * AY11 — pre-llena origen/destino desde la solicitud de movimiento. La obra
   * (proyecto) es un `lugar` cuyo id == proyecto_id, así que si viene en la lista la
   * preseleccionamos (con sus coords); el otro extremo va como texto.
   */
  private prefillDesdeSolicitud(): void {
    const qp = this.route.snapshot.queryParamMap;
    const destLugar = qp.get('destinoLugarId');
    const origLugar = qp.get('origenLugarId');
    const origTexto = qp.get('origenTexto');
    const destTexto = qp.get('destinoTexto');
    const notas = qp.get('notas');
    const hayLugar = (id: string | null) => !!id && this.lugares().some((l) => l.id === id);

    // Destino
    if (hayLugar(destLugar)) {
      this.destinoModo.set('lugar');
      this.destinoLugarId.set(destLugar!);
    } else if (destTexto) {
      this.destinoModo.set('mapa');
      this.destinoMapaTexto.set(destTexto);
    }
    // Origen (crear-ruta valida/envía el texto `origen`; si la obra está en la lista
    // usamos su nombre como texto).
    if (hayLugar(origLugar)) {
      const l = this.lugares().find((x) => x.id === origLugar);
      this.origenLugar.set(true);
      this.origenLugarId.set(origLugar!);
      if (l) this.origen.set(l.nombre);
    } else if (origTexto) {
      this.origen.set(origTexto);
    }
    if (notas) this.notas.set(notas);
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
      // AF31.1 — geocerca: si estás dentro/junto a una obra registrada, ofrece
      // fijarla como origen (continuidad salida-origen; nunca una coord suelta).
      const cercana = this.obraCercana(r.lat, r.lng);
      if (cercana) {
        this.toast.withAction(
          `¿Estás en la obra ${cercana.nombre}? Se registrará como el origen.`,
          { label: 'Sí, es esa', run: () => this.onOrigenLugar(cercana.id) },
          'info',
          9000,
        );
      } else {
        this.toast.success('Ubicación actual fijada como origen.');
      }
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

  /** AF31.1 — obra registrada más cercana a un punto (≤300 m), o null. */
  private obraCercana(lat: number, lng: number): LugarDestino | null {
    let mejor: LugarDestino | null = null;
    let mejorDist = 300; // metros
    for (const l of this.lugares()) {
      if (l.tipo !== 'obra' || l.latitud == null || l.longitud == null) continue;
      const d = this.distanciaM(lat, lng, l.latitud, l.longitud);
      if (d <= mejorDist) {
        mejorDist = d;
        mejor = l;
      }
    }
    return mejor;
  }

  /** Distancia haversine en metros. */
  private distanciaM(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
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

  /** AC6/AF24.3 — fotos de evidencia inicial (la del VEHÍCULO se eliminó). */
  fotosEvidencia = computed(() =>
    [this.fotoCarga(), this.fotoDocumento()].filter((f): f is CapturedPhoto => !!f),
  );

  /** AI5 — la foto de la ruta pasa a OPCIONAL y genérica: la evidencia con peso
   *  vive en el CONDUCE (recepción/entrega), no en la ruta (informativa). */
  cargaObligatoria = computed(() => false);

  // AF24.5 — las fotos del borrador se persisten en borrador_fotos y se rehidratan.
  capFotoCarga(p: CapturedPhoto): void {
    this.fotoCarga.set(p);
    void this.borrador.saveFoto(this.clave, 'carga', p.blob);
  }
  clrFotoCarga(): void {
    this.fotoCarga.set(null);
    void this.borrador.removeFoto(this.clave, 'carga');
  }
  capFotoDocumento(p: CapturedPhoto): void {
    this.fotoDocumento.set(p);
    void this.borrador.saveFoto(this.clave, 'documento', p.blob);
  }
  clrFotoDocumento(): void {
    this.fotoDocumento.set(null);
    void this.borrador.removeFoto(this.clave, 'documento');
  }

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

  /** AF24 — avanza validando el paso actual (4 pasos). */
  next(): void {
    const s = this.step();
    if (s === 1) {
      if (!this.vehiculoId()) {
        this.toast.error('Elige el vehículo.');
        return;
      }
      if (this.esElevado && !this.conductorId()) {
        this.toast.error('Elige el conductor al que le asignas la ruta.');
        return;
      }
    }
    if (s === 2) {
      if (!this.origen().trim()) {
        this.toast.error('Indica el origen.');
        return;
      }
      if (!this.destinoResumen()) {
        this.toast.error(this.destinoModo() === 'lugar' ? 'Elige la obra de destino.' : 'Marca el destino en el mapa.');
        return;
      }
    }
    if (s === 3 && this.cargaObligatoria() && !this.fotoCarga()) {
      this.toast.error('Toma la foto de la carga.');
      return;
    }
    this.step.set(Math.min(this.total, s + 1));
  }

  /** Retrocede; en el paso 1 intenta salir (con confirmación si hay datos). */
  prev(): void {
    if (this.step() === 1) {
      this.back();
      return;
    }
    this.step.set(Math.max(1, this.step() - 1));
  }

  /**
   * AI6 — si el chofer arma la ruta con un vehículo que NO tiene asignado, lo
   * mandamos primero a "Uso de vehículo" (asignarme) con el vehículo preseleccionado;
   * al terminar vuelve a este borrador (AF24.5). Devuelve true si desvió. Los roles
   * elevados (asignan a otro conductor) no se desvían.
   */
  private async desviarAUsoDeVehiculo(): Promise<boolean> {
    const vId = this.vehiculoId();
    if (!vId || this.esElevado || this.misAsignados.has(vId)) return false;
    // Evita el bucle si el traspaso aún no sincronizó: solo una vez por vehículo/sesión.
    const key = `ai6-uso:${vId}`;
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, '1');
    } catch { /* sessionStorage no disponible */ }
    // AV11 — fija el id ESTABLE de la ruta y marca "documentación pendiente" ANTES
    // de irnos al checklist. Al volver, se reanuda ESTA ruta con el mismo id (no
    // se crea una segunda). Ambos viajan en el borrador que flushAll persiste.
    if (!this.rutaId()) this.rutaId.set(crypto.randomUUID());
    this.holdChecklist.set(true);
    this.toast.show('Primero registra el uso de este vehículo. Tu ruta queda pendiente y la reanudas al terminar.', 'info');
    await this.autosave.flushAll(); // AF24.5 — persiste el borrador antes de salir
    await this.router.navigate(['/transporte/asignarme'], {
      queryParams: { returnUrl: this.router.url, vehiculoId: vId },
    });
    return true;
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
      this.toast.error(this.destinoModo() === 'lugar' ? 'Elige la obra de destino.' : 'Marca el destino en el mapa.');
      return;
    }
    // AF24.3 — la foto de carga es obligatoria en rutas de material.
    if (this.cargaObligatoria() && !this.fotoCarga()) {
      this.toast.error('Toma la foto de la carga.');
      return;
    }
    // AI6 — vehículo distinto al asignado → primero "Uso de vehículo" (vuelve al borrador).
    if (await this.desviarAUsoDeVehiculo()) return;
    // AF26 — crear una ruta exige GPS activo (bloquea si está apagado/revocado).
    if (!(await this.tracking.exigirGps('crear_ruta'))) return;
    const lugar = this.destinoModo() === 'lugar' ? this.selectedLugar() : null;
    const mapaCoords = this.destinoModo() === 'mapa' ? this.destinoMapaCoords() : null;
    // AV11 — id estable (idempotencia por p_id). Si venimos del checklist ya viene
    // fijado; si no, lo generamos ahora para blindar también el doble-tap normal.
    if (!this.rutaId()) this.rutaId.set(crypto.randomUUID());
    this.submitting.set(true);
    try {
      await this.conduces.crearRuta({
        id: this.rutaId(),
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
        tareaVinculada: this.tareaVinculada, // AG15
        solicitudId: this.solicitudId, // AY11 — vincula la ruta a la solicitud al crear
        ayudanteId: this.ayudanteId(), // AT4
      });
      void this.autosave.discard(this.clave); // AF24.5 — borrador cumplido
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
    // AF24.5 — al descartar explícitamente, se limpia el borrador.
    void this.autosave.discard(this.clave);
    this.location.back();
  }

  cancelarSalir(): void {
    this.confirmSalir.set(false);
  }

  get online(): boolean {
    return this.network.online();
  }
}
