import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';

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
import { GuardedWizard } from '../../../shared/guarded-wizard';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { ConductoresService } from '../../../core/services/conductores.service';
import { ReporteSemanalService } from '../../../core/services/reporte-semanal.service';
import { SyncService } from '../../../core/sync/sync.service';
import { resetScrollOnStep } from '../../../shared/util/scroll';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  ChecklistPlantilla,
  ChecklistPlantillaItem,
  FOTOS_PREUSO,
  NIVELES_COMBUSTIBLE_PREUSO,
  RespuestaValor,
  RESPUESTA_OPCIONES,
} from '../../../core/models/checklist-preuso.model';
import { ReporteSemanalVeh } from '../../../core/models/reporte-semanal.model';
import { VehiculoDetalle, VehiculoDisponible } from '../../../core/models/transporte.model';

/** A pool vehicle plus this week's report status (V10). */
interface VehSemanal {
  vehiculo_id: string;
  placa: string;
  marca: string;
  modelo: string;
  tipo: string;
  km: number;
  foto_path: string | null;
  tiene_reporte: boolean;
  /** U8 — hay un reporte semanal de esta semana aún en la cola (sin confirmar). */
  enviando: boolean;
}

/**
 * Weekly vehicle report — S17/S26a: ahora tipo hoja (una SECCIÓN por pantalla)
 * y pide lo mismo que el pre-uso (fotos guiadas, km con estado de mantenimiento
 * EN VIVO, nivel de combustible y firma). Un selector de vehículo al inicio.
 */
@Component({
  selector: 'app-reporte-semanal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, StepBar, OptionButton, PhotoSlot, SignaturePad, KmInput, EmptyState, Skeleton, SyncBar, ConfirmDialog, VehiculoCard, WizardFooter],
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

  private sig = viewChild(SignaturePad);

  readonly opciones = RESPUESTA_OPCIONES;
  readonly niveles = NIVELES_COMBUSTIBLE_PREUSO;
  readonly fotosReq = FOTOS_PREUSO;

  loading = signal(true);
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
  km = signal<number | null>(null);
  nivelCombustible = signal<string | null>(null);
  fotos = signal<Record<string, CapturedPhoto>>({});
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

  lista = computed<VehSemanal[]>(() => {
    const status = new Map(this.semana().map((s) => [s.vehiculo_id, s]));
    const pend = this.reportesPendientes();
    const wb = this.weekBounds();
    return this.pool().map((v) => {
      const fechaPend = pend.get(v.vehiculo_id);
      // U8 — "enviando" solo si la op pendiente cae en la semana en curso.
      const enviando = !!fechaPend && (!wb || (fechaPend >= wb.inicio && fechaPend <= wb.fin));
      return {
        vehiculo_id: v.vehiculo_id,
        placa: v.placa,
        marca: v.marca,
        modelo: v.modelo,
        tipo: v.tipo,
        km: v.km,
        foto_path: v.foto_path ?? null,
        tiene_reporte: status.get(v.vehiculo_id)?.tiene_reporte ?? false,
        enviando,
      };
    });
  });

  // Un vehículo "enviando" ya no cuenta como pendiente (está resuelto en la cola).
  pendientes = computed(() => this.lista().filter((v) => !v.tiene_reporte && !v.enviando));

  fotosCompletas = computed(() => this.fotosReq.every((f) => !!this.fotos()[f.slot]));
  fotosFaltan = computed(() => this.fotosReq.filter((f) => !this.fotos()[f.slot]).length);

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
    void this.load();
    // U8 — refrescar estado del listado tras cada cambio del outbox (envío/drain),
    // como en /pendientes (P4/P5). Reconciliar servidor + ops en cola.
    effect(() => {
      this.sync.changed();
      void this.refreshEstados();
    });
  }

  /** U8 — recomputa cumplimiento del servidor + reportes en cola. */
  private async refreshEstados(): Promise<void> {
    const [semana, pend] = await Promise.all([
      this.reportes.getSemana(),
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
    if (this.vehiculo()) this.vehiculo.set(null);
    else this.location.back();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [semana, plantilla, cond, pool] = await Promise.all([
        this.reportes.getSemana(),
        this.reportes.getPlantilla(),
        this.conductores.getMiConductor(),
        this.vehiculos.getVehiculosDisponibles(),
      ]);
      this.semana.set(semana);
      this.plantilla.set(plantilla);
      this.conductorId = cond?.id ?? null;
      this.pool.set(pool);
      void this.loadFotos(pool.map((v) => v.vehiculo_id));
    } finally {
      this.loading.set(false);
    }
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
    this.step.set(1);
    this.respuestas.set({});
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
    }
  }

  setComentario(itemId: string, texto: string): void {
    this.comentarios.update((c) => ({ ...c, [itemId]: texto }));
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

  async onFirmaChanged(hasSignature: boolean): Promise<void> {
    this.firmaLista.set(hasSignature);
    this.firmaBlob.set(hasSignature ? ((await this.sig()?.toBlob()) ?? null) : null);
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
      }));
      const fotos: Record<string, Blob> = {};
      for (const f of this.fotosReq) fotos[f.slot] = this.fotos()[f.slot].blob;
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
        resultado,
      });
      this.resultadoEnviado.set(resultado);
      this.done.set(true);
      this.semana.set(await this.reportes.getSemana());
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo enviar. Intenta de nuevo.');
    } finally {
      this.submitting.set(false);
    }
  }

  finish(): void {
    this.done.set(false);
    this.vehiculo.set(null);
  }

  irAsignar(): void {
    void this.router.navigate(['/transporte/asignar']);
  }

  get online(): boolean {
    return this.network.online();
  }
}
