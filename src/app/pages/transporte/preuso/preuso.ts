import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { VehiculoPicker } from '../../../shared/ui/vehiculo-picker/vehiculo-picker';
import { DraftBanner } from '../../../shared/ui/draft-banner/draft-banner';
import { GuardedWizard } from '../../../shared/guarded-wizard';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { ChecklistPreusoService } from '../../../core/services/checklist-preuso.service';
import { ConductoresService } from '../../../core/services/conductores.service';
import { LicenciaCategoriasService, LicenciaCategoria } from '../../../core/services/licencia-categorias.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { formatFecha } from '../../../core/util/fecha';
import {
  PreusoReportService,
  PreusoReportData,
  ReportFoto,
} from '../../../core/services/preuso-report.service';
import {
  ChecklistPlantilla,
  ChecklistPlantillaItem,
  ChecklistResultado,
  claseVehiculo,
  esVehiculoPesado,
  FOTOS_PREUSO,
  itemAplica,
  NIVELES_COMBUSTIBLE_PREUSO,
  RESPUESTA_OPCIONES,
  RespuestaValor,
} from '../../../core/models/checklist-preuso.model';
import { VehiculoDetalle, VehiculoDisponible } from '../../../core/models/transporte.model';
import { Conductor, diasHasta, estadoLicencia } from '../../../core/models/conductor.model';

interface RespuestaDraft {
  respuesta: RespuestaValor | null;
  comentario: string;
  photo: CapturedPhoto | null;
}

/** M1 — typed slice of the pre-uso wizard persisted for crash recovery. Photos
 *  live in the borrador_fotos store; here we only keep the light state. */
interface PreusoDraft {
  step: number;
  plantillaId: string;
  km: number | null;
  nivelCombustible: string | null;
  observacion: string;
  firmaLista: boolean;
  respuestas: Record<string, { respuesta: RespuestaValor | null; comentario: string }>;
}

interface SeccionGrupo {
  seccion: string;
  items: ChecklistPlantillaItem[];
}

interface Hallazgo {
  numero: string | null;
  seccion: string;
  etiqueta: string;
  es_critico: boolean;
  comentario: string | null;
}

interface EstadoMantenimiento {
  estado: 'ok' | 'pre_cita' | 'vencido';
  faltan: number;
  proximo: number;
}

const TOTAL_STEPS = 5;
const PRECITA_KM = 500; // sgc.flota_config → umbral_precita_km

/**
 * Pre-use vehicle inspection (v2). Licence/registration/insurance blocks up
 * front, "datos de salida" (km + fuel + live maintenance line), the v2 catalog
 * checklist (críticos + Herramienta Pesado only for heavy vehicles), 7 guided
 * photos, signature, then a tri-state verdict with a shareable PDF report.
 * Saved offline via the outbox; the server re-validates + computes resultado.
 */
@Component({
  selector: 'app-preuso',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, StepBar, PhotoSlot, OptionButton, SignaturePad, ConfirmDialog, Skeleton, VehiculoPicker, DraftBanner],
  templateUrl: './preuso.html',
  styleUrl: './preuso.scss',
})
export class PreusoPage extends GuardedWizard {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private vehiculos = inject(VehiculosService);
  private checklist = inject(ChecklistPreusoService);
  private conductores = inject(ConductoresService);
  private licCategorias = inject(LicenciaCategoriasService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private report = inject(PreusoReportService);
  private autosave = inject(AutosaveService);
  private borradorSvc = inject(BorradorService);
  private userCtx = inject(UserContextService);

  private sig = viewChild(SignaturePad);
  borradorPrevio = signal<number | null>(null); // M1 — banner de recuperación
  private hydrated = false;

  readonly total = TOTAL_STEPS;
  readonly opciones = RESPUESTA_OPCIONES;
  readonly niveles = NIVELES_COMBUSTIBLE_PREUSO;
  readonly fotosReq = FOTOS_PREUSO;
  // V15 — fotos agrupadas EXTERIOR (4) / INTERIOR (3) para los encabezados.
  readonly fotosExterior = FOTOS_PREUSO.filter((f) => f.grupo === 'EXTERIOR');
  readonly fotosInterior = FOTOS_PREUSO.filter((f) => f.grupo === 'INTERIOR');

  vehiculoId = '';
  necesitaVehiculo = signal(false); // B1 — elegir del pool cuando no llega por ruta
  vehiculo = signal<VehiculoDetalle | null>(null);
  conductor = signal<Conductor | null>(null);
  loadingCtx = signal(true);

  step = signal(1);
  plantillas = signal<ChecklistPlantilla[]>([]);
  categorias = signal<LicenciaCategoria[]>([]); // C1 — para etiquetar la licencia en el reporte
  plantillaId = signal('');
  respuestas = signal<Record<string, RespuestaDraft>>({});
  km = signal<number | null>(null);
  nivelCombustible = signal<string | null>(null);
  observacion = signal('');
  fotos = signal<Record<string, CapturedPhoto>>({});
  firmaLista = signal(false);
  firmaBlob = signal<Blob | null>(null);
  precitaKm = signal(PRECITA_KM); // sgc.flota_config.umbral_precita_km (cargado en loadContext)

  submitting = signal(false);
  done = signal(false);
  sharing = signal(false);

  // ── Derived context ────────────────────────────────────────────────────
  placa = computed(() => this.vehiculo()?.placa ?? '');
  modelo = computed(() => {
    const v = this.vehiculo();
    return v ? `${v.marca} ${v.modelo}` : '';
  });
  esPesado = computed(() => esVehiculoPesado(this.vehiculo()?.tipo));
  private clase = computed(() => claseVehiculo(this.vehiculo()?.tipo));
  /** #2 seguridad: el chofer debe estar autorizado para la clase del vehículo. */
  autorizadoParaVehiculo = computed(() => {
    const auth = this.conductor()?.tipo_vehiculo_autorizado;
    if (!auth || auth === 'Ambos') return true;
    return auth === this.clase();
  });

  licenciaUmbral = signal(30); // APP-039 — umbral "por vencer" configurable (flota_config)
  licenciaEstado = computed(() =>
    estadoLicencia(this.conductor()?.licencia_vencimiento ?? null, this.licenciaUmbral()),
  );
  licenciaDias = computed(() => diasHasta(this.conductor()?.licencia_vencimiento ?? null));

  /** Hard block that prevents opening the checklist at all. */
  bloqueoPrevio = computed<{ titulo: string; motivo: string } | null>(() => {
    if (this.licenciaEstado() === 'vencida') {
      return {
        titulo: 'Licencia vencida',
        motivo: 'Tu licencia de conducir está vencida. No puedes hacer el pre-uso. Contacta a RRHH.',
      };
    }
    const v = this.vehiculo();
    if (v?.vencimiento_matricula && new Date(v.vencimiento_matricula + 'T00:00:00') < this.hoy()) {
      return {
        titulo: 'Matrícula vencida',
        motivo: `La matrícula del vehículo ${v.placa} está vencida (venció ${formatFecha(v.vencimiento_matricula)}). No puede salir.`,
      };
    }
    if (v?.vencimiento_seguro && new Date(v.vencimiento_seguro + 'T00:00:00') < this.hoy()) {
      return {
        titulo: 'Seguro vencido',
        motivo: `El seguro del vehículo ${v!.placa} está vencido (venció ${formatFecha(v!.vencimiento_seguro)}). No puede salir.`,
      };
    }
    return null;
  });

  private hoy(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  plantillaSel = computed<ChecklistPlantilla | null>(
    () => this.plantillas().find((p) => p.id === this.plantillaId()) ?? null,
  );

  /** Only the items that apply to this vehicle's class. */
  itemsAplicables = computed<ChecklistPlantillaItem[]>(() =>
    (this.plantillaSel()?.items ?? []).filter((it) => itemAplica(it, this.clase())),
  );

  grupos = computed<SeccionGrupo[]>(() => {
    const grupos: SeccionGrupo[] = [];
    for (const it of this.itemsAplicables()) {
      let g = grupos.find((x) => x.seccion === it.seccion);
      if (!g) {
        g = { seccion: it.seccion, items: [] };
        grupos.push(g);
      }
      g.items.push(it);
    }
    return grupos;
  });

  totalItems = computed(() => this.itemsAplicables().length);
  respondidos = computed(
    () =>
      this.itemsAplicables().filter((it) => this.draft(it.id).respuesta !== null).length,
  );

  /** Live status semaphore for the checklist bar. */
  semaforo = computed<'ok' | 'hallazgos' | 'critico'>(() => {
    let critico = false;
    let hallazgo = false;
    for (const it of this.itemsAplicables()) {
      if (this.draft(it.id).respuesta === 'no') {
        hallazgo = true;
        if (it.es_critico) critico = true;
      }
    }
    return critico ? 'critico' : hallazgo ? 'hallazgos' : 'ok';
  });

  hallazgos = computed<Hallazgo[]>(() =>
    this.itemsAplicables()
      .filter((it) => this.draft(it.id).respuesta === 'no')
      .map((it) => ({
        numero: it.numero,
        seccion: it.seccion,
        etiqueta: it.etiqueta,
        es_critico: it.es_critico,
        comentario: this.draft(it.id).comentario.trim() || null,
      })),
  );

  veredicto = computed<ChecklistResultado>(() => {
    const h = this.hallazgos();
    if (h.some((x) => x.es_critico)) return 'bloqueado';
    return h.length ? 'con_hallazgos' : 'aprobado';
  });

  /** Maintenance line from the vehicle's km_ultimo + intervalo (mirrors server). */
  mantenimiento = computed<EstadoMantenimiento | null>(() => {
    const v = this.vehiculo();
    const km = this.km();
    if (!v || v.km_ultimo_mantenimiento == null || km == null || km <= 0) return null;
    const proximo = v.km_ultimo_mantenimiento + (v.intervalo_mantenimiento_km ?? 5000);
    const faltan = proximo - km;
    const estado = faltan <= 0 ? 'vencido' : faltan <= this.precitaKm() ? 'pre_cita' : 'ok';
    return { estado, faltan, proximo };
  });

  fotosCompletas = computed(() => this.fotosReq.every((f) => !!this.fotos()[f.slot]));
  /** V15 — how many of the 7 guided photos are still missing (for the button). */
  fotosFaltan = computed(() => this.fotosReq.filter((f) => !this.fotos()[f.slot]).length);

  /** V15 — "Continuar al checklist" enabled only with km + fuel level. */
  datosSalidaCompletos = computed(() => this.km() != null && this.km()! > 0 && !!this.nivelCombustible());

  /** V15 — card line: "Mantenimiento cada N km · próx. X". */
  mantResumen = computed(() => {
    const v = this.vehiculo();
    if (!v || v.km_ultimo_mantenimiento == null) return null;
    const intervalo = v.intervalo_mantenimiento_km ?? 5000;
    return { intervalo, proximo: v.km_ultimo_mantenimiento + intervalo, ultimoKm: v.kilometraje };
  });

  kmInvalido = computed(() => {
    const km = this.km();
    const odo = this.vehiculo()?.kilometraje;
    return km != null && odo != null && km < odo;
  });

  constructor() {
    super();
    this.registerBackGuard();
    this.vehiculoId = this.route.snapshot.paramMap.get('vehiculoId') ?? '';
    // B1 — deep-link por vehículo salta el paso; sin él, se elige del pool.
    if (this.vehiculoId) {
      void this.loadContext();
    } else {
      this.necesitaVehiculo.set(true);
      this.loadingCtx.set(false);
    }
    // M1 — autosave del estado (con debounce + flush al ocultar/descargar) para
    // recuperar el pre-uso si el SO mata el proceso. Las fotos se persisten
    // aparte en el momento de capturarlas (persistFoto).
    effect(() => {
      const snap: PreusoDraft = {
        step: this.step(),
        plantillaId: this.plantillaId(),
        km: this.km(),
        nivelCombustible: this.nivelCombustible(),
        observacion: this.observacion(),
        firmaLista: this.firmaLista(),
        respuestas: Object.fromEntries(
          Object.entries(this.respuestas()).map(([id, d]) => [
            id,
            { respuesta: d.respuesta, comentario: d.comentario },
          ]),
        ),
      };
      if (!this.hydrated || this.submitting() || this.done() || !this.vehiculoId) return;
      if (!this.tieneDatos()) return;
      this.autosave.queue(this.claveBorrador(), snap, {
        tipo: 'checklist',
        etiqueta: 'Pre-uso' + (this.placa() ? ' · ' + this.placa() : ''),
        ruta: `/transporte/preuso/${this.vehiculoId}`,
      });
    });
  }

  private claveBorrador(): string {
    const uid = this.userCtx.profile()?.id ?? 'anon';
    return `preuso:${this.vehiculoId || 'nuevo'}:${uid}`;
  }

  /** M1 — persiste una foto del borrador (no debe romper nunca la captura). */
  private persistFoto(slot: string, blob: Blob): void {
    if (!this.vehiculoId) return;
    void this.borradorSvc.saveFoto(this.claveBorrador(), slot, blob);
  }
  private dropFoto(slot: string): void {
    if (!this.vehiculoId) return;
    void this.borradorSvc.removeFoto(this.claveBorrador(), slot);
  }

  /** Rehidrata el borrador (estado + fotos) tras un kill del proceso. */
  async continuarBorrador(): Promise<void> {
    const clave = this.claveBorrador();
    try {
      const d = await this.borradorSvc.load<PreusoDraft>(clave);
      if (d) {
        if (d.plantillaId && d.plantillaId !== this.plantillaId()) this.pickPlantilla(d.plantillaId);
        this.km.set(d.km ?? null);
        this.nivelCombustible.set(d.nivelCombustible ?? null);
        this.observacion.set(d.observacion ?? '');
        this.respuestas.update((cur) => {
          const next = { ...cur };
          for (const [id, r] of Object.entries(d.respuestas ?? {})) {
            const base = next[id] ?? { respuesta: null, comentario: '', photo: null };
            next[id] = { ...base, respuesta: r.respuesta, comentario: r.comentario };
          }
          return next;
        });
      }
      // Fotos: reconstruye Blobs + object URLs desde IndexedDB.
      const fotos = await this.borradorSvc.loadFotos(clave);
      const guided = { ...this.fotos() };
      for (const f of fotos) {
        const photo: CapturedPhoto = { blob: f.blob, previewUrl: URL.createObjectURL(f.blob) };
        if (f.slot === 'firma') {
          this.firmaBlob.set(f.blob);
          this.firmaLista.set(true);
        } else if (f.slot.startsWith('item:')) {
          const id = f.slot.slice('item:'.length);
          this.respuestas.update((cur) => {
            const base = cur[id] ?? { respuesta: null, comentario: '', photo: null };
            return { ...cur, [id]: { ...base, photo } };
          });
        } else {
          guided[f.slot] = photo;
        }
      }
      this.fotos.set(guided);
      const step = d?.step ?? 1;
      this.step.set(step >= 1 && step <= this.total ? step : 1);
    } catch {
      this.toast.error('No se pudo recuperar todo el borrador, pero puedes continuar.');
    }
    this.borradorPrevio.set(null);
  }

  descartarBorrador(): void {
    void this.autosave.discard(this.claveBorrador());
    this.borradorPrevio.set(null);
  }

  /** B1 — vehículo elegido del pool: continúa el pre-uso con ese vehículo. */
  onVehiculoElegido(v: VehiculoDisponible): void {
    this.vehiculoId = v.vehiculo_id;
    this.necesitaVehiculo.set(false);
    void this.loadContext();
  }

  /** U4 — inspección iniciada con respuestas/fotos/firma sin guardar. */
  tieneDatos(): boolean {
    if (this.done()) return false;
    const answered = Object.values(this.respuestas()).some(
      (d) => d.respuesta != null || d.comentario.trim() || d.photo,
    );
    return (
      answered ||
      Object.keys(this.fotos()).length > 0 ||
      !!this.firmaBlob() ||
      !!this.observacion().trim() ||
      !!this.nivelCombustible()
    );
  }

  private async loadContext(): Promise<void> {
    this.loadingCtx.set(true);
    try {
      const [v, c, list, cfg, cats] = await Promise.all([
        this.vehiculos.getVehiculoDetalle(this.vehiculoId),
        this.conductores.getMiConductor(),
        this.checklist.getPlantillas(),
        this.conductores.getFlotaConfig(),
        this.licCategorias.getCategorias().catch(() => [] as LicenciaCategoria[]),
      ]);
      this.vehiculo.set(v);
      this.conductor.set(c);
      this.plantillas.set(list);
      this.categorias.set(cats);
      this.precitaKm.set(cfg.precitaKm);
      this.licenciaUmbral.set(cfg.licenciaDias);
      if (list.length) this.pickPlantilla(list[0].id);
      // El km de salida arranca VACÍO (el usuario escribe el actual). El último
      // registrado queda solo como referencia (vehiculo.kilometraje / kmInvalido).
      // M1 — ¿hay un borrador sin enviar de este vehículo? → ofrecer recuperar.
      const b = await this.borradorSvc.get(this.claveBorrador());
      if (b) this.borradorPrevio.set(b.updated_at);
    } finally {
      this.hydrated = true;
      this.loadingCtx.set(false);
    }
  }

  private pickPlantilla(id: string): void {
    this.plantillaId.set(id);
    const drafts: Record<string, RespuestaDraft> = {};
    for (const it of this.plantillaSel()?.items ?? []) {
      drafts[it.id] = { respuesta: null, comentario: '', photo: null };
    }
    this.respuestas.set(drafts);
  }

  draft(itemId: string): RespuestaDraft {
    return this.respuestas()[itemId] ?? { respuesta: null, comentario: '', photo: null };
  }

  setRespuesta(itemId: string, valor: RespuestaValor): void {
    this.respuestas.update((r) => ({ ...r, [itemId]: { ...this.draft(itemId), respuesta: valor } }));
  }
  setComentario(itemId: string, comentario: string): void {
    this.respuestas.update((r) => ({ ...r, [itemId]: { ...this.draft(itemId), comentario } }));
  }
  onItemFoto(itemId: string, photo: CapturedPhoto): void {
    this.respuestas.update((r) => ({ ...r, [itemId]: { ...this.draft(itemId), photo } }));
    this.persistFoto('item:' + itemId, photo.blob);
  }
  onItemFotoCleared(itemId: string): void {
    this.respuestas.update((r) => ({ ...r, [itemId]: { ...this.draft(itemId), photo: null } }));
    this.dropFoto('item:' + itemId);
  }

  onFoto(slot: string, photo: CapturedPhoto): void {
    this.fotos.update((f) => ({ ...f, [slot]: photo }));
    this.persistFoto(slot, photo.blob);
  }
  onFotoCleared(slot: string): void {
    this.fotos.update((f) => {
      const next = { ...f };
      delete next[slot];
      return next;
    });
    this.dropFoto(slot);
  }

  next(): void {
    if (!this.canAdvance()) return;
    this.step.update((s) => Math.min(this.total, s + 1));
  }
  prev(): void {
    this.step.update((s) => Math.max(1, s - 1));
  }

  private canAdvance(): boolean {
    switch (this.step()) {
      case 1:
        if (!this.autorizadoParaVehiculo()) {
          this.toast.error(
            `No estás autorizado para vehículos ${this.clase()}. Contacta a Flota.`,
          );
          return false;
        }
        if (this.km() === null || this.km()! <= 0) {
          this.toast.error('Escribe el kilometraje de salida.');
          return false;
        }
        if (this.kmInvalido()) {
          this.toast.error(`No puede ser menor al último registrado (${this.vehiculo()?.kilometraje} km).`);
          return false;
        }
        if (!this.nivelCombustible()) {
          this.toast.error('Elige el nivel de combustible.');
          return false;
        }
        return true;
      case 2:
        if (this.respondidos() < this.totalItems()) {
          this.toast.error('Responde todos los puntos del checklist.');
          return false;
        }
        // P6 — un hallazgo CRÍTICO (bloquea el vehículo) exige explicar qué pasó.
        {
          const falta = this.itemsAplicables().find(
            (it) =>
              it.es_critico &&
              this.draft(it.id).respuesta === 'no' &&
              !this.draft(it.id).comentario.trim(),
          );
          if (falta) {
            this.toast.error(`Explica qué pasó en el punto crítico: "${falta.etiqueta}".`);
            return false;
          }
        }
        return true;
      case 3:
        if (!this.fotosCompletas()) {
          this.toast.error('Faltan fotos. Toma las 7 fotos guiadas.');
          return false;
        }
        return true;
      case 4:
        if (!this.firmaLista()) {
          this.toast.error('Firma antes de continuar.');
          return false;
        }
        return true;
      default:
        return true;
    }
  }

  async onFirmaChanged(hasSignature: boolean): Promise<void> {
    this.firmaLista.set(hasSignature);
    const blob = hasSignature ? ((await this.sig()?.toBlob()) ?? null) : null;
    this.firmaBlob.set(blob);
    // M1 — persistir/limpiar la firma en el borrador.
    if (blob) this.persistFoto('firma', blob);
    else this.dropFoto('firma');
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    const firmaBlob = this.firmaBlob();
    if (!firmaBlob) {
      this.toast.error('Falta la firma.');
      return;
    }
    this.submitting.set(true);
    try {
      const respuestas = this.itemsAplicables().map((it) => {
        const d = this.draft(it.id);
        const comentario = d.comentario.trim();
        return {
          etiqueta: it.etiqueta,
          seccion: it.seccion,
          es_critico: it.es_critico,
          respuesta: d.respuesta!,
          comentario: comentario ? comentario : null,
          orden: it.orden,
          blob: d.photo?.blob ?? null,
        };
      });

      const fotos: Record<string, Blob> = {};
      for (const f of this.fotosReq) fotos[f.slot] = this.fotos()[f.slot].blob;

      const observacion = this.observacion().trim();

      await this.checklist.enqueueChecklist({
        vehiculoId: this.vehiculoId,
        plantillaId: this.plantillaId(),
        plantilla: this.plantillaSel()?.nombre ?? '',
        placa: this.placa(),
        fecha: new Date().toISOString().slice(0, 10),
        conductorId: this.conductor()?.id ?? null,
        kilometraje: this.km(),
        nivelCombustible: this.nivelCombustible(),
        observacion: observacion ? observacion : null,
        respuestas,
        fotos,
        firma: firmaBlob,
        resultado: this.veredicto(),
      });
      // M1 — enviado: limpia el borrador (estado + fotos) para no reofrecerlo.
      void this.autosave.discard(this.claveBorrador());
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar. Intenta de nuevo.');
    } finally {
      this.submitting.set(false);
    }
  }

  async compartir(): Promise<void> {
    await this.emitirReporte('compartir');
  }
  async descargar(): Promise<void> {
    await this.emitirReporte('descargar');
  }

  private async emitirReporte(modo: 'compartir' | 'descargar'): Promise<void> {
    if (this.sharing()) return;
    this.sharing.set(true);
    try {
      const data = await this.buildReportData();
      if (modo === 'compartir') {
        const r = await this.report.compartir(data);
        if (r.fallback) this.toast.error('Se descargó el PDF. Adjúntalo manualmente al enviarlo.');
      } else {
        await this.report.descargar(data);
        this.toast.success('Reporte generado.');
      }
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo generar el reporte.');
    } finally {
      this.sharing.set(false);
    }
  }

  private async buildReportData(): Promise<PreusoReportData> {
    const c = this.conductor();
    const v = this.vehiculo();
    const mant = this.mantenimiento();
    const fotos: ReportFoto[] = [];
    for (const f of this.fotosReq) {
      const photo = this.fotos()[f.slot];
      if (photo) fotos.push({ label: f.label, dataUrl: await this.blobToDataUrl(photo.blob) });
    }
    return {
      placa: this.placa(),
      vehiculo: this.modelo(),
      tipoVehiculo: v?.tipo ?? '—',
      conductor: c?.nombre ?? '—',
      licenciaTipo: this.licenciaTipoLabel(c?.licencia_tipo ?? null),
      licenciaNumero: c?.licencia_numero ?? null,
      licenciaVencimiento: c?.licencia_vencimiento ?? null,
      fecha: new Date().toISOString(),
      km: this.km(),
      nivelCombustible: this.nivelCombustible(),
      resultado: this.veredicto(),
      estadoMantenimiento: mant?.estado ?? 'ok',
      proximoMantenimientoKm: mant?.proximo ?? null,
      faltanMantenimientoKm: mant?.faltan ?? null,
      totalItems: this.totalItems(),
      respondidos: this.respondidos(),
      hallazgos: this.hallazgos(),
      fotos,
    };
  }

  /** C1 — "01 · Motocicletas" para el código guardado, o el código tal cual. */
  private licenciaTipoLabel(codigo: string | null): string | null {
    if (!codigo) return null;
    const cat = this.categorias().find((c) => c.codigo === codigo);
    return cat ? LicenciaCategoriasService.label(cat) : codigo;
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  finish(): void {
    void this.router.navigate(['/transporte'], { replaceUrl: true });
  }

  get online(): boolean {
    return this.network.online();
  }
}
