import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
import { GuardedWizard } from '../../../shared/guarded-wizard';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { ChecklistPreusoService } from '../../../core/services/checklist-preuso.service';
import { ConductoresService } from '../../../core/services/conductores.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
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
import { VehiculoDetalle } from '../../../core/models/transporte.model';
import { Conductor, diasHasta, estadoLicencia } from '../../../core/models/conductor.model';

interface RespuestaDraft {
  respuesta: RespuestaValor | null;
  comentario: string;
  photo: CapturedPhoto | null;
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
  imports: [FormsModule, DecimalPipe, StepBar, PhotoSlot, OptionButton, SignaturePad, ConfirmDialog],
  templateUrl: './preuso.html',
  styleUrl: './preuso.scss',
})
export class PreusoPage extends GuardedWizard {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private vehiculos = inject(VehiculosService);
  private checklist = inject(ChecklistPreusoService);
  private conductores = inject(ConductoresService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private report = inject(PreusoReportService);

  private sig = viewChild(SignaturePad);

  readonly total = TOTAL_STEPS;
  readonly opciones = RESPUESTA_OPCIONES;
  readonly niveles = NIVELES_COMBUSTIBLE_PREUSO;
  readonly fotosReq = FOTOS_PREUSO;

  vehiculoId = '';
  vehiculo = signal<VehiculoDetalle | null>(null);
  conductor = signal<Conductor | null>(null);
  loadingCtx = signal(true);

  step = signal(1);
  plantillas = signal<ChecklistPlantilla[]>([]);
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

  licenciaEstado = computed(() => estadoLicencia(this.conductor()?.licencia_vencimiento ?? null));
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

  kmInvalido = computed(() => {
    const km = this.km();
    const odo = this.vehiculo()?.kilometraje;
    return km != null && odo != null && km < odo;
  });

  constructor() {
    super();
    this.registerBackGuard();
    this.vehiculoId = this.route.snapshot.paramMap.get('vehiculoId') ?? '';
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
      const [v, c, list, cfg] = await Promise.all([
        this.vehiculos.getVehiculoDetalle(this.vehiculoId),
        this.conductores.getMiConductor(),
        this.checklist.getPlantillas(),
        this.conductores.getFlotaConfig(),
      ]);
      this.vehiculo.set(v);
      this.conductor.set(c);
      this.plantillas.set(list);
      this.precitaKm.set(cfg.precitaKm);
      if (list.length) this.pickPlantilla(list[0].id);
      if (v && this.km() === null) this.km.set(v.kilometraje || null);
    } finally {
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
  }
  onItemFotoCleared(itemId: string): void {
    this.respuestas.update((r) => ({ ...r, [itemId]: { ...this.draft(itemId), photo: null } }));
  }

  onFoto(slot: string, photo: CapturedPhoto): void {
    this.fotos.update((f) => ({ ...f, [slot]: photo }));
  }
  onFotoCleared(slot: string): void {
    this.fotos.update((f) => {
      const next = { ...f };
      delete next[slot];
      return next;
    });
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
    this.firmaBlob.set(hasSignature ? ((await this.sig()?.toBlob()) ?? null) : null);
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
      licenciaTipo: c?.licencia_tipo ?? null,
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
