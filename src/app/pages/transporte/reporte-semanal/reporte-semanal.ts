import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { KmInput } from '../../../shared/ui/km-input/km-input';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { VehiculoCard } from '../../../shared/ui/vehiculo-card/vehiculo-card';
import { VoiceNotes, VoiceNoteItem } from '../../../shared/ui/voice-notes/voice-notes';
import { DraftBanner } from '../../../shared/ui/draft-banner/draft-banner';
import { GuardedWizard } from '../../../shared/guarded-wizard';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { ConductoresService } from '../../../core/services/conductores.service';
import { ReporteSemanalService } from '../../../core/services/reporte-semanal.service';
import { SyncService } from '../../../core/sync/sync.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { resetScrollOnStep } from '../../../shared/util/scroll';
import { formatFechaCortaHora } from '../../../core/util/fecha';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  ChecklistPlantilla,
  ChecklistPlantillaItem,
  RespuestaValor,
  RESPUESTA_OPCIONES,
} from '../../../core/models/checklist-preuso.model';
import {
  FOTOS_SEMANAL_FALLBACK,
  FotoSlotSemanal,
  ReporteSemanalVeh,
  tipoPlantillaSemanal,
  diaReporteSemanalDow,
  DIA_SEMANA_LABEL,
} from '../../../core/models/reporte-semanal.model';
import {
  VehiculoDetalle,
  VehiculoDisponible,
  NIVELES_COMBUSTIBLE,
  NIVEL_COMBUSTIBLE_AYUDA,
  nivelCombustibleLabel,
} from '../../../core/models/transporte.model';

/** A pool vehicle plus this week's report status (V10). */
interface VehSemanal {
  vehiculo_id: string;
  placa: string;
  marca: string;
  modelo: string;
  anio: number | null; // Z10
  tipo: string;
  /** AC14/AC5 — 'horas' = telehandler (plantilla y día de reporte propios). */
  medida_uso: string | null;
  km: number;
  foto_path: string | null;
  tiene_reporte: boolean;
  /** U8 — hay un reporte semanal de esta semana aún en la cola (sin confirmar). */
  enviando: boolean;
  /** Z13 — estado global: quién lo reportó y cuándo (aunque sea otro conductor). */
  reportado_por: string | null;
  reportado_por_id: string | null;
  reportado_at: string | null;
  /** Z13 — true si el reporte de esta semana lo hizo OTRA persona (no yo). */
  reportado_por_otro: boolean;
  /** W7 — dato de prueba (solo visible a admins). */
  es_prueba: boolean;
}

/**
 * AE9 — slice liviano del reporte semanal persistido para recuperar el borrador
 * tras un kill/llamada/bloqueo del teléfono. Las fotos viven aparte en
 * borrador_fotos (patrón pre-uso M1); aquí solo el estado de texto/selección.
 */
interface ReporteSemanalDraft {
  step: number;
  vehiculoId: string;
  respuestas: Record<string, RespuestaValor>;
  comentarios: Record<string, string>;
  km: number | null;
  nivelCombustible: string | null;
  observacion: string;
  firmaLista: boolean;
}

/**
 * Weekly vehicle report — S17/S26a: ahora tipo hoja (una SECCIÓN por pantalla)
 * y pide lo mismo que el pre-uso (fotos guiadas, km con estado de mantenimiento
 * EN VIVO, nivel de combustible y firma). Un selector de vehículo al inicio.
 * AE9 — autosave del borrador (estado + fotos) con recuperación al volver.
 */
@Component({
  selector: 'app-reporte-semanal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, StepBar, OptionButton, PhotoSlot, SignaturePad, KmInput, EmptyState, Skeleton, SyncBar, ConfirmDialog, VehiculoCard, WizardFooter, VoiceNotes, DraftBanner],
  templateUrl: './reporte-semanal.html',
  styleUrl: './reporte-semanal.scss',
})
export class ReporteSemanalPage extends GuardedWizard {
  private vehiculos = inject(VehiculosService);
  private conductores = inject(ConductoresService);
  private reportes = inject(ReporteSemanalService);
  private sync = inject(SyncService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private ctx = inject(UserContextService);
  private autosave = inject(AutosaveService);
  private borradorSvc = inject(BorradorService);

  private sig = viewChild(SignaturePad);

  // AE9 — recuperación del borrador. `borradorPrevio` = timestamp del último
  // autosave del vehículo elegido (muestra el banner "retomar / empezar nuevo").
  // `borradoresPorVeh` = mapa vehiculoId→timestamp para marcar en el picker cuáles
  // tienen un reporte a medio llenar. `hydratado` protege el autosave hasta que
  // el vehículo está cargado (o el borrador rehidratado).
  borradorPrevio = signal<number | null>(null);
  borradoresPorVeh = signal<Map<string, number>>(new Map());
  private hydratado = false;
  /** Deep-link ?reanudar=<vehiculoId> (desde "Documentación en proceso"). */
  private reanudarId: string | null = null;

  readonly opciones = RESPUESTA_OPCIONES;
  readonly niveles = NIVELES_COMBUSTIBLE;
  readonly nivelAyuda = NIVEL_COMBUSTIBLE_AYUDA;
  readonly nivelLabel = nivelCombustibleLabel;
  readonly fechaHora = formatFechaCortaHora; // Z13
  /** Z11 — fotos guiadas del semanal (checklist_foto_slots), agrupadas Exterior/Interior. */
  fotoSlots = signal<FotoSlotSemanal[]>(FOTOS_SEMANAL_FALLBACK);
  fotoGrupos = computed<{ seccion: string; slots: FotoSlotSemanal[] }[]>(() => {
    const grupos: { seccion: string; slots: FotoSlotSemanal[] }[] = [];
    for (const f of this.fotoSlots()) {
      let g = grupos.find((x) => x.seccion === f.seccion);
      if (!g) {
        g = { seccion: f.seccion, slots: [] };
        grupos.push(g);
      }
      g.slots.push(f);
    }
    return grupos;
  });

  loading = signal(true);
  /** Q2 — deep-link ?item=<vehiculo_id>: resalta y hace scroll a esa tarjeta. */
  highlightedId = signal<string | null>(null);
  semana = signal<ReporteSemanalVeh[]>([]);
  /** U8 — reporte_semanal pendientes en el outbox: vehiculoId → fecha. */
  reportesPendientes = signal<Map<string, string>>(new Map());
  pool = signal<VehiculoDisponible[]>([]);
  fotoUrls = signal<Record<string, string | null>>({});
  plantilla = signal<ChecklistPlantilla | null>(null);
  private conductorId: string | null = null;

  // Wizard state (null = showing the vehicle picker).
  vehiculo = signal<VehSemanal | null>(null);
  vehDetalle = signal<VehiculoDetalle | null>(null); // S19 — km_ultimo + intervalo
  odometro = signal<number | null>(null);
  step = signal(1);
  respuestas = signal<Record<string, RespuestaValor>>({});
  /** U7 — comentario por ítem (obligatorio cuando la respuesta es "Falla"). */
  comentarios = signal<Record<string, string>>({});
  // AA13 — foto + nota de voz opcionales por falla marcada (itemId → …).
  fallaFotos = signal<Record<string, CapturedPhoto>>({});
  fallaVoces = signal<Record<string, VoiceNoteItem[]>>({});
  km = signal<number | null>(null);
  nivelCombustible = signal<string | null>(null);
  fotos = signal<Record<string, CapturedPhoto>>({});
  voces = signal<VoiceNoteItem[]>([]); // Z23 — notas de voz
  firmaLista = signal(false);
  firmaBlob = signal<Blob | null>(null);
  observacion = signal('');
  submitting = signal(false);
  done = signal(false);
  resultadoEnviado = signal<'aprobado' | 'con_hallazgos' | 'bloqueado'>('aprobado');

  items = computed<ChecklistPlantillaItem[]>(() => this.plantilla()?.items ?? []);

  /** Ítems agrupados por sección (una sección por pantalla — S17). */
  seccionGrupos = computed<{ seccion: string; items: ChecklistPlantillaItem[] }[]>(() => {
    const grupos: { seccion: string; items: ChecklistPlantillaItem[] }[] = [];
    for (const it of this.items()) {
      let g = grupos.find((x) => x.seccion === it.seccion);
      if (!g) {
        g = { seccion: it.seccion, items: [] };
        grupos.push(g);
      }
      g.items.push(it);
    }
    return grupos;
  });

  // Layout de pasos: N secciones → fotos → km+combustible → firma → resumen.
  nSecciones = computed(() => this.seccionGrupos().length);
  total = computed(() => this.nSecciones() + 4);
  seccionActual = computed(() => {
    const s = this.step();
    return s >= 1 && s <= this.nSecciones() ? this.seccionGrupos()[s - 1] : null;
  });
  esFotos = computed(() => this.step() === this.nSecciones() + 1);
  esKm = computed(() => this.step() === this.nSecciones() + 2);
  esFirma = computed(() => this.step() === this.nSecciones() + 3);
  esResumen = computed(() => this.step() === this.nSecciones() + 4);

  /** Límites de la semana en curso (de la vista del servidor) para saber si una
   *  op pendiente pertenece a esta semana. Null si aún no hay datos del servidor. */
  private weekBounds = computed<{ inicio: string; fin: string } | null>(() => {
    const s = this.semana();
    return s.length ? { inicio: s[0].semana_inicio, fin: s[0].semana_fin } : null;
  });

  /** Z13 — mi usuario id (para distinguir "reportado por mí" vs "por otro"). */
  private miUid = computed(() => this.ctx.profile()?.id ?? null);

  lista = computed<VehSemanal[]>(() => {
    const status = new Map(this.semana().map((s) => [s.vehiculo_id, s]));
    const pend = this.reportesPendientes();
    const wb = this.weekBounds();
    const uid = this.miUid();
    return this.pool().map((v) => {
      const fechaPend = pend.get(v.vehiculo_id);
      // U8 — "enviando" solo si la op pendiente cae en la semana en curso.
      const enviando = !!fechaPend && (!wb || (fechaPend >= wb.inicio && fechaPend <= wb.fin));
      const s = status.get(v.vehiculo_id);
      const reportadoPorId = s?.reportado_por_id ?? null;
      return {
        vehiculo_id: v.vehiculo_id,
        placa: v.placa,
        marca: v.marca,
        modelo: v.modelo,
        anio: v.anio ?? null, // Z10
        tipo: v.tipo,
        medida_uso: v.medida_uso ?? 'km', // AC14/AC5
        km: v.km,
        foto_path: v.foto_path ?? null,
        tiene_reporte: s?.tiene_reporte ?? false,
        enviando,
        // Z13 — estado global del reporte de la semana.
        reportado_por: s?.reportado_por ?? null,
        reportado_por_id: reportadoPorId,
        reportado_at: s?.reportado_at ?? null,
        reportado_por_otro: !!s?.tiene_reporte && !!reportadoPorId && reportadoPorId !== uid,
        es_prueba: v.es_prueba ?? false,
      };
    });
  });

  // Un vehículo "enviando" ya no cuenta como pendiente (está resuelto en la cola).
  pendientes = computed(() => this.lista().filter((v) => !v.tiene_reporte && !v.enviando));

  // AC5 — día de hoy (0=domingo … 6=sábado) para marcar "toca reportar HOY".
  private hoyDow = new Date().getDay();
  /** AC5 — hoy es el día programado de reporte de este vehículo (telehandler=sábado, resto=domingo). */
  tocaHoy(v: VehSemanal): boolean {
    return this.hoyDow === diaReporteSemanalDow(v.medida_uso) && !v.tiene_reporte && !v.enviando;
  }
  /** AC5 — nombre del día programado del vehículo ("sábado" / "domingo"). */
  diaProgramadoLabel(v: VehSemanal): string {
    return DIA_SEMANA_LABEL[diaReporteSemanalDow(v.medida_uso)];
  }

  /** W4 — ids de vehículos asignados a mí (asignaciones + recepciones en cola). */
  misIds = signal<Set<string>>(new Set());

  /** W4 — listado en grupos: "Tus vehículos" arriba, "Resto de la flota" debajo. */
  grupos = computed<{ titulo: string; items: VehSemanal[] }[]>(() => {
    const mine = this.misIds();
    const lista = this.lista();
    const mios = lista.filter((v) => mine.has(v.vehiculo_id));
    const resto = lista.filter((v) => !mine.has(v.vehiculo_id));
    const out: { titulo: string; items: VehSemanal[] }[] = [];
    if (mios.length) out.push({ titulo: 'Tus vehículos', items: mios });
    // Si no hay "míos" no ponemos encabezado al resto (lista simple, como antes).
    if (resto.length) out.push({ titulo: mios.length ? 'Resto de la flota' : '', items: resto });
    return out;
  });

  fotosCompletas = computed(() => this.fotoSlots().every((f) => !!this.fotos()[f.slot]));
  fotosFaltan = computed(() => this.fotoSlots().filter((f) => !this.fotos()[f.slot]).length);

  kmInvalido = computed(() => {
    const km = this.km();
    const odo = this.odometro();
    return km != null && odo != null && km < odo;
  });

  /** S19 — estado de mantenimiento EN VIVO (para el aviso del resumen). */
  mantenimiento = computed(() => {
    const v = this.vehDetalle();
    const km = this.km();
    if (!v || v.km_ultimo_mantenimiento == null || km == null || km <= 0) return null;
    const proximo = v.km_ultimo_mantenimiento + (v.intervalo_mantenimiento_km ?? 5000);
    const faltan = proximo - km;
    const estado: 'ok' | 'pre_cita' | 'vencido' = faltan <= 0 ? 'vencido' : faltan <= 500 ? 'pre_cita' : 'ok';
    return { estado, faltan, proximo };
  });

  resultadoLocal = computed<'aprobado' | 'con_hallazgos' | 'bloqueado'>(() => {
    const r = this.respuestas();
    const items = this.items();
    if (items.some((it) => it.es_critico && r[it.id] === 'no')) return 'bloqueado';
    return items.some((it) => r[it.id] === 'no') ? 'con_hallazgos' : 'aprobado';
  });

  constructor() {
    super();
    this.registerBackGuard();
    resetScrollOnStep(() => this.step(), () => this.done()); // U3/U4
    // Q2 — destino de deep-link: ?item=<vehiculo_id> resalta esa tarjeta del pool.
    const item = this.route.snapshot.queryParamMap.get('item');
    if (item) this.highlightedId.set(item);
    // AE9 — ?reanudar=<vehiculo_id>: retomar un reporte a medio llenar (viene de
    // "Documentación en proceso"). Se procesa tras cargar el pool (en load()).
    this.reanudarId = this.route.snapshot.queryParamMap.get('reanudar');
    void this.load();
    // U8 — refrescar estado del listado tras cada cambio del outbox (envío/drain),
    // como en /pendientes (P4/P5). Reconciliar servidor + ops en cola.
    effect(() => {
      this.sync.changed();
      void this.refreshEstados();
    });
    // AE9 — autosave del borrador (debounce + flush al ocultar/descargar) para
    // recuperar el reporte si el SO mata el proceso, hay una llamada o se bloquea
    // el teléfono. Las fotos se persisten aparte al capturarlas (persistFoto).
    effect(() => {
      const snap: ReporteSemanalDraft = {
        step: this.step(),
        vehiculoId: this.vehiculo()?.vehiculo_id ?? '',
        respuestas: this.respuestas(),
        comentarios: this.comentarios(),
        km: this.km(),
        nivelCombustible: this.nivelCombustible(),
        observacion: this.observacion(),
        firmaLista: this.firmaLista(),
      };
      const veh = this.vehiculo();
      if (!this.hydratado || !veh || this.submitting() || this.done()) return;
      if (!this.tieneDatos()) return;
      this.autosave.queue(this.claveBorrador(veh.vehiculo_id), snap, {
        tipo: 'checklist',
        etiqueta: 'Reporte semanal' + (veh.placa ? ' · ' + veh.placa : ''),
        ruta: `/transporte/reporte-semanal?reanudar=${veh.vehiculo_id}`,
      });
    });
  }

  private claveBorrador(vehiculoId?: string): string {
    const uid = this.ctx.profile()?.id ?? 'anon';
    const vid = vehiculoId ?? this.vehiculo()?.vehiculo_id ?? 'nuevo';
    return `reporte_semanal:${vid}:${uid}`;
  }

  /** AE9 — persiste una foto del borrador (nunca debe romper la captura). */
  private persistFoto(slot: string, blob: Blob): void {
    const veh = this.vehiculo();
    if (!veh) return;
    void this.borradorSvc.saveFoto(this.claveBorrador(veh.vehiculo_id), slot, blob);
  }
  private dropFoto(slot: string): void {
    const veh = this.vehiculo();
    if (!veh) return;
    void this.borradorSvc.removeFoto(this.claveBorrador(veh.vehiculo_id), slot);
  }

  /** U8 — recomputa cumplimiento del servidor + reportes en cola. */
  private async refreshEstados(): Promise<void> {
    const [semana, pend] = await Promise.all([
      this.reportes.getSemanaTodas(), // AA3 — estado por vehículo, no solo los míos
      this.sync.reportesSemanalesPendientes(),
    ]);
    this.semana.set(semana);
    this.reportesPendientes.set(pend);
  }

  tieneDatos(): boolean {
    if (this.done() || !this.vehiculo()) return false;
    return (
      Object.keys(this.respuestas()).length > 0 ||
      this.km() != null ||
      !!this.nivelCombustible() ||
      Object.keys(this.fotos()).length > 0 ||
      !!this.firmaBlob() ||
      !!this.observacion().trim()
    );
  }

  protected override salir(): void {
    // AE9 — al volver al picker, flush del autosave y refresca los chips: si el
    // usuario dejó el reporte a medio llenar, queda como "documentación en proceso".
    if (this.vehiculo()) {
      void this.autosave.flushAll().then(() => this.cargarBorradores());
      this.vehiculo.set(null);
    } else {
      this.location.back();
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [semana, plantilla, fotoSlots, cond, pool, asignaciones, recepcionesEnCola] = await Promise.all([
        this.reportes.getSemanaTodas(), // AA3 — estado por vehículo, no solo los míos
        this.reportes.getPlantilla(),
        this.reportes.getFotoSlotsSemanal(), // Z11
        this.conductores.getMiConductor(),
        this.vehiculos.getVehiculosDisponibles(),
        this.vehiculos.getMisAsignaciones().catch(() => []),
        this.vehiculos.entregasRecepcionPendientes().catch(() => new Set<string>()),
      ]);
      this.semana.set(semana);
      this.plantilla.set(plantilla);
      this.fotoSlots.set(fotoSlots); // Z11
      this.conductorId = cond?.id ?? null;
      this.pool.set(pool);
      // W4 — "Tus vehículos" = asignados a mí + recepciones aún en la cola (U12).
      this.misIds.set(new Set([...asignaciones.map((a) => a.vehiculo_id), ...recepcionesEnCola]));
      void this.loadFotos(pool.map((v) => v.vehiculo_id));
      // AE9 — marcar en el picker qué vehículos tienen un reporte a medio llenar.
      await this.cargarBorradores();
      // AE9 — retomar desde "Documentación en proceso" (?reanudar=<vehiculoId>).
      if (this.reanudarId) {
        const veh = this.lista().find((v) => v.vehiculo_id === this.reanudarId);
        this.reanudarId = null;
        if (veh) this.elegir(veh);
      }
    } finally {
      this.loading.set(false);
      this.scrollToHighlighted(); // Q2 — tras pintar el listado
    }
  }

  /** AE9 — mapa vehiculoId→timestamp de los reportes a medio llenar (picker). */
  private async cargarBorradores(): Promise<void> {
    try {
      const uid = this.ctx.profile()?.id ?? 'anon';
      const prefix = 'reporte_semanal:';
      const suffix = ':' + uid;
      const map = new Map<string, number>();
      for (const b of await this.borradorSvc.list()) {
        if (b.clave.startsWith(prefix) && b.clave.endsWith(suffix)) {
          const vid = b.clave.slice(prefix.length, b.clave.length - suffix.length);
          if (vid) map.set(vid, b.updated_at);
        }
      }
      this.borradoresPorVeh.set(map);
    } catch {
      /* best-effort */
    }
  }

  /** AE9 — ¿este vehículo tiene un reporte a medio llenar? (chip en el picker). */
  tieneBorrador(vehiculoId: string): boolean {
    return this.borradoresPorVeh().has(vehiculoId);
  }

  /** Q2 — hace scroll a la tarjeta del deep-link y quita el resaltado tras unos segundos. */
  private scrollToHighlighted(): void {
    const id = this.highlightedId();
    if (!id) return;
    setTimeout(() => {
      document.getElementById('rsem-veh-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => this.highlightedId.set(null), 3000);
    }, 150);
  }

  private async loadFotos(ids: string[]): Promise<void> {
    const paths = await this.vehiculos.getFotosPaths(ids);
    const urls: Record<string, string | null> = {};
    await Promise.all(
      Object.entries(paths).map(async ([id, p]) => {
        urls[id] = p ? await this.vehiculos.getFotoUrl(p) : null;
      }),
    );
    this.fotoUrls.set(urls);
  }

  elegir(v: VehSemanal): void {
    this.vehiculo.set(v);
    // AC14 — plantilla del semanal según el tipo del vehículo: el telehandler usa
    // sus 15 puntos; el resto, la genérica. Se recarga por cada vehículo elegido.
    this.plantilla.set(null);
    void this.reportes
      .getPlantilla(tipoPlantillaSemanal(v.medida_uso))
      .then((p) => this.plantilla.set(p));
    // AC5 — aviso si hoy no es el día programado de este equipo (se permite igual).
    if (!v.tiene_reporte && !v.enviando && this.hoyDow !== diaReporteSemanalDow(v.medida_uso)) {
      this.toast.show(
        `Hoy no toca el reporte de este equipo (le toca los ${this.diaProgramadoLabel(v)}). Puedes reportarlo igual.`,
        'info',
        5000,
      );
    }
    // Estado en blanco por vehículo (se rehidrata si el usuario retoma el borrador).
    this.hydratado = false;
    this.borradorPrevio.set(null);
    this.step.set(1);
    this.respuestas.set({});
    this.comentarios.set({});
    this.fallaFotos.set({});
    this.fallaVoces.set({});
    this.voces.set([]);
    this.km.set(null);
    this.nivelCombustible.set(null);
    this.fotos.set({});
    this.firmaBlob.set(null);
    this.firmaLista.set(false);
    this.observacion.set('');
    this.odometro.set(v.km ?? null);
    this.vehDetalle.set(null);
    // S19 — datos de mantenimiento para el km-input (mejor esfuerzo).
    // U1 — getVehiculoDetalle ya devuelve el km EFECTIVO (servidor + outbox); usarlo
    // como referencia del odómetro para que el semanal no muestre un km viejo.
    void this.vehiculos.getVehiculoDetalle(v.vehiculo_id).then((d) => {
      this.vehDetalle.set(d);
      if (d?.kilometraje != null) this.odometro.set(d.kilometraje);
    });
    // AE9 — ¿hay un reporte a medio llenar de este vehículo? → ofrecer retomarlo.
    void this.borradorSvc.get(this.claveBorrador(v.vehiculo_id)).then((b) => {
      if (b && this.vehiculo()?.vehiculo_id === v.vehiculo_id) this.borradorPrevio.set(b.updated_at);
      this.hydratado = true;
    });
  }

  /** AE9 — rehidrata el reporte (estado + fotos) tras un kill/llamada/bloqueo. */
  async continuarBorrador(): Promise<void> {
    const veh = this.vehiculo();
    if (!veh) return;
    const clave = this.claveBorrador(veh.vehiculo_id);
    try {
      const d = await this.borradorSvc.load<ReporteSemanalDraft>(clave);
      if (d) {
        this.respuestas.set(d.respuestas ?? {});
        this.comentarios.set(d.comentarios ?? {});
        this.km.set(d.km ?? null);
        this.nivelCombustible.set(d.nivelCombustible ?? null);
        this.observacion.set(d.observacion ?? '');
      }
      // Fotos: reconstruye Blobs + object URLs desde IndexedDB.
      const fotos = await this.borradorSvc.loadFotos(clave);
      const guided = { ...this.fotos() };
      const fallas = { ...this.fallaFotos() };
      for (const f of fotos) {
        const photo: CapturedPhoto = { blob: f.blob, previewUrl: URL.createObjectURL(f.blob) };
        if (f.slot === 'firma') {
          this.firmaBlob.set(f.blob);
          this.firmaLista.set(true);
        } else if (f.slot.startsWith('falla:')) {
          fallas[f.slot.slice('falla:'.length)] = photo;
        } else {
          guided[f.slot] = photo;
        }
      }
      this.fotos.set(guided);
      this.fallaFotos.set(fallas);
      const step = d?.step ?? 1;
      this.step.set(step >= 1 && step <= this.total() ? step : 1);
    } catch {
      this.toast.error('No se pudo recuperar todo el borrador, pero puedes continuar.');
    }
    this.borradorPrevio.set(null);
  }

  descartarBorrador(): void {
    const veh = this.vehiculo();
    if (veh) void this.autosave.discard(this.claveBorrador(veh.vehiculo_id));
    this.borradorPrevio.set(null);
    void this.cargarBorradores();
  }

  setRespuesta(itemId: string, valor: RespuestaValor): void {
    this.respuestas.update((r) => ({ ...r, [itemId]: valor }));
    // U7 — si deja de ser "Falla", limpiar el comentario asociado.
    if (valor !== 'no') {
      this.comentarios.update((c) => {
        if (!(itemId in c)) return c;
        const next = { ...c };
        delete next[itemId];
        return next;
      });
      // AA13 — y su foto + nota de voz opcionales.
      this.onFallaFotoCleared(itemId);
      this.setFallaVoces(itemId, []);
    }
  }

  setComentario(itemId: string, texto: string): void {
    this.comentarios.update((c) => ({ ...c, [itemId]: texto }));
  }

  // AA13 — foto + nota de voz opcionales por falla.
  getFallaFoto(itemId: string): CapturedPhoto | null {
    return this.fallaFotos()[itemId] ?? null;
  }
  onFallaFoto(itemId: string, photo: CapturedPhoto): void {
    this.fallaFotos.update((m) => ({ ...m, [itemId]: photo }));
    this.persistFoto('falla:' + itemId, photo.blob); // AE9
  }
  onFallaFotoCleared(itemId: string): void {
    this.fallaFotos.update((m) => {
      const next = { ...m };
      if (next[itemId]) URL.revokeObjectURL(next[itemId].previewUrl);
      delete next[itemId];
      return next;
    });
    this.dropFoto('falla:' + itemId); // AE9
  }
  getFallaVoces(itemId: string): VoiceNoteItem[] {
    return this.fallaVoces()[itemId] ?? [];
  }
  setFallaVoces(itemId: string, notes: VoiceNoteItem[]): void {
    this.fallaVoces.update((m) => ({ ...m, [itemId]: notes }));
  }

  onFoto(slot: string, photo: CapturedPhoto): void {
    this.fotos.update((f) => ({ ...f, [slot]: photo }));
    this.persistFoto(slot, photo.blob); // AE9
  }
  onFotoCleared(slot: string): void {
    this.fotos.update((f) => {
      const next = { ...f };
      delete next[slot];
      return next;
    });
    this.dropFoto(slot); // AE9
  }

  async onFirmaChanged(hasSignature: boolean): Promise<void> {
    this.firmaLista.set(hasSignature);
    const blob = hasSignature ? ((await this.sig()?.toBlob()) ?? null) : null;
    this.firmaBlob.set(blob);
    // AE9 — persistir/limpiar la firma en el borrador.
    if (blob) this.persistFoto('firma', blob);
    else this.dropFoto('firma');
  }

  next(): void {
    if (!this.canAdvance()) return;
    this.step.update((s) => Math.min(this.total(), s + 1));
  }
  prev(): void {
    this.step.update((s) => Math.max(1, s - 1));
  }

  private canAdvance(): boolean {
    const sec = this.seccionActual();
    if (sec) {
      const r = this.respuestas();
      if (!sec.items.every((it) => !!r[it.id])) {
        this.toast.error('Responde todas las preguntas de esta sección.');
        return false;
      }
      // U7 — toda "Falla" exige un comentario que describa la falla.
      const c = this.comentarios();
      if (!sec.items.every((it) => r[it.id] !== 'no' || !!c[it.id]?.trim())) {
        this.toast.error('Describe la falla en el comentario.');
        return false;
      }
      return true;
    }
    if (this.esFotos() && !this.fotosCompletas()) {
      this.toast.error(`Faltan ${this.fotosFaltan()} foto(s).`);
      return false;
    }
    if (this.esKm()) {
      if (this.km() == null || this.km()! <= 0) {
        this.toast.error('Escribe el kilometraje actual.');
        return false;
      }
      if (this.kmInvalido()) {
        this.toast.error(`El kilometraje no puede ser menor al último registrado (${this.odometro()} km).`);
        return false;
      }
      if (!this.nivelCombustible()) {
        this.toast.error('Elige el nivel de combustible.');
        return false;
      }
      return true;
    }
    if (this.esFirma() && !this.firmaLista()) {
      this.toast.error('Firma antes de continuar.');
      return false;
    }
    return true;
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    const veh = this.vehiculo();
    const plantilla = this.plantilla();
    if (!veh || !plantilla) return;
    if (this.km() == null || this.km()! <= 0 || this.kmInvalido()) {
      this.toast.error('Revisa el kilometraje.');
      return;
    }
    if (!this.firmaBlob()) {
      this.toast.error('Falta la firma.');
      return;
    }
    this.submitting.set(true);
    try {
      const r = this.respuestas();
      const c = this.comentarios();
      const respuestas = this.items().map((it) => ({
        etiqueta: it.etiqueta,
        seccion: it.seccion,
        es_critico: it.es_critico,
        respuesta: r[it.id],
        // U7 — comentario de la falla (el RPC ya lo acepta por ítem).
        comentario: c[it.id]?.trim() || null,
        orden: it.orden,
        // AA13 — foto + nota de voz opcionales de la falla.
        blob: r[it.id] === 'no' ? (this.fallaFotos()[it.id]?.blob ?? null) : null,
        voz: r[it.id] === 'no' ? (this.fallaVoces()[it.id]?.[0]?.blob ?? null) : null,
      }));
      const fotos: Record<string, Blob> = {};
      for (const f of this.fotoSlots()) fotos[f.slot] = this.fotos()[f.slot].blob;
      const resultado = this.resultadoLocal();
      await this.reportes.enqueue({
        vehiculoId: veh.vehiculo_id,
        placa: veh.placa,
        plantillaId: plantilla.id,
        conductorId: this.conductorId,
        fecha: new Date().toISOString().slice(0, 10),
        kilometraje: this.km(),
        nivelCombustible: this.nivelCombustible(),
        observacion: this.observacion().trim() || null,
        respuestas,
        fotos,
        firma: this.firmaBlob(),
        voces: this.voces().map((n) => n.blob),
        resultado,
      });
      // AE9 — enviado: limpia el borrador (estado + fotos) para no reofrecerlo.
      void this.autosave.discard(this.claveBorrador(veh.vehiculo_id));
      this.borradorPrevio.set(null);
      void this.cargarBorradores();
      this.resultadoEnviado.set(resultado);
      this.done.set(true);
      this.semana.set(await this.reportes.getSemanaTodas()); // AA3
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo enviar. Intenta de nuevo.');
    } finally {
      this.submitting.set(false);
    }
  }

  finish(): void {
    this.done.set(false);
    this.vehiculo.set(null);
    void this.cargarBorradores(); // AE9 — refresca los chips del picker
  }

  irAsignar(): void {
    void this.router.navigate(['/transporte/asignar']);
  }

  get online(): boolean {
    return this.network.online();
  }
}
