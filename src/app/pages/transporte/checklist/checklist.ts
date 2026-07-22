import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { DraftBanner } from '../../../shared/ui/draft-banner/draft-banner';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { WizardExit } from '../../../shared/ui/wizard-exit/wizard-exit';
import { KmInput } from '../../../shared/ui/km-input/km-input';
import { resetScrollOnStep } from '../../../shared/util/scroll';
import { UbicacionLabelService } from '../../../core/services/ubicacion-label.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { VehiculoDetalle } from '../../../core/models/transporte.model';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { UserContextService } from '../../../core/services/user-context.service';
import {
  CombustibleNivel,
  EntregaTipo,
  FOTOS_REQUERIDAS,
  NIVELES_COMBUSTIBLE,
  ZONAS_DANO,
} from '../../../core/models/transporte.model';

interface DanoDraft {
  zona: string;
  descripcion: string;
  photo: CapturedPhoto | null;
}

/** Estado autoguardable del checklist (sin fotos: se re-toman al continuar). */
interface ChecklistDraft {
  step: number;
  km: number | null;
  combustible: CombustibleNivel | null;
  tieneDanos: boolean | null;
  danos: { zona: string; descripcion: string }[];
}

const TOTAL_STEPS = 6;

/**
 * The vehicle responsibility checklist (recepción / devolución). One question
 * per screen, photo-first, huge targets. Nothing can be confirmed without the
 * 6 guided photos + a signature. Saved offline via the outbox.
 */
@Component({
  selector: 'app-checklist',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, StepBar, PhotoSlot, OptionButton, SignaturePad, BigConfirm, Skeleton, WizardFooter, DraftBanner, ConfirmDialog, WizardExit, KmInput],
  templateUrl: './checklist.html',
  styleUrl: './checklist.scss',
})
export class ChecklistPage implements OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private vehiculos = inject(VehiculosService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private permissions = inject(PermissionsService);
  private ubicacionLabel = inject(UbicacionLabelService);
  private autosave = inject(AutosaveService);
  private navGuard = inject(NavGuardService);
  private borradorSvc = inject(BorradorService);
  private ctx = inject(UserContextService);
  private location = inject(Location);

  private sig = viewChild(SignaturePad);

  borradorPrevio = signal<number | null>(null);
  private hydrated = false;

  readonly total = TOTAL_STEPS;
  readonly fotosReq = FOTOS_REQUERIDAS;
  readonly niveles = NIVELES_COMBUSTIBLE;
  readonly zonas = ZONAS_DANO;

  tipo: EntregaTipo = 'recepcion';
  vehiculoId = '';
  placa = signal('');
  modelo = signal('');

  step = signal(1);
  fotos = signal<Record<string, CapturedPhoto>>({});
  loading = signal(true); // APP-038 — skeleton mientras carga el vehículo
  km = signal<number | null>(null);
  odometro = signal<number | null>(null);
  vehDetalle = signal<VehiculoDetalle | null>(null); // S19 — km_ultimo + intervalo
  kmInvalido = computed(() => {
    const km = this.km();
    const odo = this.odometro();
    return km != null && odo != null && km < odo;
  });
  /** S19 — estado de mantenimiento EN VIVO (para el aviso del resumen, paso 6). */
  mantenimiento = computed(() => {
    const v = this.vehDetalle();
    const km = this.km();
    if (!v || v.km_ultimo_mantenimiento == null || km == null || km <= 0) return null;
    const proximo = v.km_ultimo_mantenimiento + (v.intervalo_mantenimiento_km ?? 5000);
    const faltan = proximo - km;
    const estado: 'ok' | 'pre_cita' | 'vencido' = faltan <= 0 ? 'vencido' : faltan <= 500 ? 'pre_cita' : 'ok';
    return { estado, faltan, proximo };
  });
  combustible = signal<CombustibleNivel | null>(null);
  tieneDanos = signal<boolean | null>(null);
  danos = signal<DanoDraft[]>([]);
  firmaLista = signal(false);
  // Capturamos la firma al dibujarla; el pad vive en un paso anterior al de envío.
  firmaBlob = signal<Blob | null>(null);
  private gps: { lat: number; lng: number } | null = null;
  /** X2 — estado de la captura de GPS para avisar al usuario (no bloquea). */
  gpsEstado = signal<'capturando' | 'ok' | 'sin-ubicacion'>('capturando');
  /** U13 — etiqueta legible de la ubicación (Proyecto/Almacén/dirección corta). */
  ubicacionTexto = signal<string | null>(null);
  /** P2 — el permiso quedó denegado permanente: reintentar no reabre el diálogo. */
  gpsBloqueado = signal(false);
  /** S28 — motivo del fallo de GPS, para un mensaje específico. */
  gpsRazon = signal<'denied' | 'denied-permanent' | 'timeout' | 'gps-off' | 'unavailable' | null>(null);
  gpsMensaje = computed(() => {
    switch (this.gpsRazon()) {
      case 'gps-off':
        return 'La ubicación del teléfono está apagada. Actívala (desliza desde arriba → Ubicación) y reintenta.';
      case 'denied-permanent':
        return 'La app no tiene permiso de ubicación. Ábrelo en ajustes y reintenta.';
      case 'denied':
        return 'Necesitamos permiso de ubicación. Reintenta y acéptalo.';
      case 'timeout':
        return 'No se pudo fijar el GPS a tiempo. Sal a cielo abierto y reintenta. Puedes enviar sin ubicación.';
      default:
        return 'No pudimos obtener el GPS (sin señal). Puedes enviar igual: se registrará sin ubicación.';
    }
  });

  submitting = signal(false);
  done = signal(false);
  confirmSalir = signal(false); // Q7 — salir con confirmación

  titulo = computed(() => (this.tipo === 'recepcion' ? 'Recibir vehículo' : 'Devolver vehículo'));

  private readonly backHandler = (): boolean => {
    if (!this.done() && this.tieneDatos()) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  fotosCompletas = computed(() =>
    this.fotosReq.every((f) => !!this.fotos()[f.slot]),
  );

  constructor() {
    resetScrollOnStep(() => this.step(), () => this.done()); // U3/U4
    this.tipo = (this.route.snapshot.data['tipo'] as EntregaTipo) ?? 'recepcion';
    this.vehiculoId = this.route.snapshot.paramMap.get('vehiculoId') ?? '';
    void this.loadVehiculo().then(() => this.checkDraft());
    void this.captureGps();
    // Autosave del estado (sin fotos) con debounce + flush al ocultar (Fase 2).
    effect(() => {
      const snap: ChecklistDraft = {
        step: this.step(),
        km: this.km(),
        combustible: this.combustible(),
        tieneDanos: this.tieneDanos(),
        danos: this.danos().map((d) => ({ zona: d.zona, descripcion: d.descripcion })),
      };
      if (!this.hydrated || this.done() || this.submitting()) return;
      const hayAlgo =
        snap.km != null || !!snap.combustible || snap.tieneDanos != null || snap.step > 1 || snap.danos.length > 0;
      if (!hayAlgo) return;
      this.autosave.queue(this.clave(), snap, {
        tipo: 'checklist',
        etiqueta: `${this.tipo === 'recepcion' ? 'Recibir' : 'Devolver'} · ${this.placa() || 'vehículo'}`,
        ruta: `/transporte/${this.tipo === 'recepcion' ? 'recibir' : 'devolver'}/${this.vehiculoId}`,
      });
    });
    this.navGuard.register(this.backHandler); // Q7 — botón físico Android
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }

  /** Q7 — ¿hay algo capturado? (el estado se autoguarda como borrador). */
  private tieneDatos(): boolean {
    return (
      this.km() != null ||
      !!this.combustible() ||
      this.tieneDanos() != null ||
      this.danos().length > 0 ||
      Object.keys(this.fotos()).length > 0 ||
      !!this.firmaBlob()
    );
  }

  /** Q7 — salir del wizard (con confirmación si hay datos). El estado ya queda
   *  guardado como borrador vía autosave, así que se puede retomar luego. */
  intentarSalir(): void {
    if (!this.done() && this.tieneDatos()) this.confirmSalir.set(true);
    else this.salir();
  }
  confirmarSalir(): void {
    this.confirmSalir.set(false);
    this.salir();
  }
  cancelarSalir(): void {
    this.confirmSalir.set(false);
  }
  private salir(): void {
    // S31 — location.back() vuelve al hub existente SIN duplicarlo (así
    // transporte → recibir → atrás → atrás = HOME). navigate dejaba una entrada
    // extra de transporte y "atrás" se quedaba en el hub.
    this.location.back();
  }

  private clave(): string {
    const uid = this.ctx.profile()?.id ?? 'anon';
    return `checklist-${this.tipo}:${this.vehiculoId}:${uid}`;
  }

  private async checkDraft(): Promise<void> {
    const b = await this.borradorSvc.get(this.clave());
    if (b) this.borradorPrevio.set(b.updated_at);
    this.hydrated = true;
  }

  continuarBorrador(): void {
    void this.borradorSvc.load<ChecklistDraft>(this.clave()).then((d) => {
      if (d) {
        this.step.set(d.step ?? 1);
        this.km.set(d.km ?? null);
        this.combustible.set(d.combustible ?? null);
        this.tieneDanos.set(d.tieneDanos ?? null);
        this.danos.set((d.danos ?? []).map((x) => ({ zona: x.zona, descripcion: x.descripcion, photo: null })));
      }
      this.borradorPrevio.set(null);
    });
  }
  descartarBorrador(): void {
    void this.autosave.discard(this.clave());
    this.borradorPrevio.set(null);
  }

  private async loadVehiculo(): Promise<void> {
    try {
      // S29 — pre-check: si estamos online y el vehículo ya no existe/está
      // inactivo, no dejar llenar 6 pasos para nada; avisar y refrescar el pool.
      if (this.network.online()) {
        const activo = await this.vehiculos.estaActivo(this.vehiculoId);
        if (activo === false) {
          this.toast.error('Este vehículo ya no está disponible. Actualizamos tu lista.');
          await this.vehiculos.invalidatePendientes();
          void this.router.navigate(['/transporte'], { replaceUrl: true });
          return;
        }
      }
      const v = await this.vehiculos.getVehiculo(this.vehiculoId);
      if (v) {
        this.placa.set(v.placa);
        this.modelo.set(`${v.marca} ${v.modelo}`);
        this.odometro.set(v.kilometraje ?? null); // APP-011 — base de coherencia de km
      }
      // S19 — detalle (km_ultimo_mantenimiento + intervalo) para el aviso en vivo.
      // U1 — getVehiculoDetalle devuelve el km EFECTIVO (servidor + outbox); usarlo
      // como base de coherencia para no mostrar un km viejo tras recibir/echar.
      void this.vehiculos.getVehiculoDetalle(this.vehiculoId).then((d) => {
        this.vehDetalle.set(d);
        if (d?.kilometraje != null) this.odometro.set(d.kilometraje);
      });
    } finally {
      this.loading.set(false); // APP-038
    }
  }

  private async captureGps(): Promise<void> {
    this.gpsEstado.set('capturando');
    // P2 — recibir vehículo toma la ubicación automáticamente: pedimos el
    // permiso on-demand (getPosition abre el diálogo si hace falta). GPS es
    // best-effort (VEH-06 / X2): si falla, se registra "sin ubicación" y nunca
    // bloquea el flujo; avisamos en el resumen y ofrecemos reintentar/ajustes.
    // S28 — timeout amplio + fix reciente aceptado + watchPosition (en el service).
    const r = await this.permissions.getPosition({ highAccuracy: true, timeout: 25000, maximumAge: 60000 });
    if (r.ok) {
      this.gps = { lat: r.lat, lng: r.lng };
      this.gpsEstado.set('ok');
      this.gpsBloqueado.set(false);
      this.gpsRazon.set(null);
      // U13 — resolver una etiqueta legible (Proyecto/Almacén/dirección corta).
      this.ubicacionTexto.set(null);
      void this.ubicacionLabel.describir(r.lat, r.lng).then((t) => this.ubicacionTexto.set(t));
    } else {
      this.gps = null;
      this.gpsEstado.set('sin-ubicacion');
      this.ubicacionTexto.set(null);
      this.gpsBloqueado.set(r.reason === 'denied-permanent');
      this.gpsRazon.set(r.reason);
    }
  }

  /** X2 — permite reintentar la ubicación desde el resumen (permiso/señal). */
  reintentarGps(): void {
    // Si el permiso quedó bloqueado, reintentar no reabre el diálogo del SO:
    // hay que ir a ajustes. Ofrecemos el atajo.
    if (this.gpsBloqueado() && this.permissions.isNative) {
      this.toast.withAction('Ubicación bloqueada para esta app.', {
        label: 'Abrir ajustes',
        run: () => void this.permissions.openAppSettings(),
      });
      return;
    }
    void this.captureGps();
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

  setDanos(value: boolean): void {
    this.tieneDanos.set(value);
    if (value && this.danos().length === 0) this.addDano();
    if (!value) this.danos.set([]);
  }

  addDano(): void {
    this.danos.update((d) => [...d, { zona: 'frente', descripcion: '', photo: null }]);
  }

  setDanoZona(i: number, zona: string): void {
    this.danos.update((d) => d.map((x, idx) => (idx === i ? { ...x, zona } : x)));
  }

  setDanoDesc(i: number, descripcion: string): void {
    this.danos.update((d) => d.map((x, idx) => (idx === i ? { ...x, descripcion } : x)));
  }

  onDanoFoto(i: number, photo: CapturedPhoto): void {
    this.danos.update((d) => d.map((x, idx) => (idx === i ? { ...x, photo } : x)));
  }

  removeDano(i: number): void {
    this.danos.update((d) => d.filter((_, idx) => idx !== i));
  }

  next(): void {
    if (!this.canAdvance()) return;
    this.step.update((s) => Math.min(this.total, s + 1));
  }

  prev(): void {
    this.step.update((s) => Math.max(1, s - 1));
  }

  /** Per-step gate so the user can't skip required evidence. */
  canAdvance(): boolean {
    switch (this.step()) {
      case 2:
        if (!this.fotosCompletas()) {
          this.toast.error('Faltan fotos. Toma las 6 fotos del vehículo.');
          return false;
        }
        return true;
      case 3:
        if (this.km() === null || this.km()! < 0) {
          this.toast.error('Escribe el kilometraje.');
          return false;
        }
        if (this.kmInvalido()) {
          this.toast.error(`El kilometraje no puede ser menor al último registrado (${this.odometro()} km).`);
          return false;
        }
        if (!this.combustible()) {
          this.toast.error('Elige el nivel de combustible.');
          return false;
        }
        return true;
      case 4:
        if (this.tieneDanos() === null) {
          this.toast.error('Dinos si viste algún daño.');
          return false;
        }
        if (this.tieneDanos() && this.danos().some((d) => !d.photo)) {
          this.toast.error('Toma la foto de cada daño.');
          return false;
        }
        return true;
      default:
        return true;
    }
  }

  /** Store the signature blob while the pad is still mounted (its step is live). */
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
      // S29 — re-verificar antes de encolar (online): si el vehículo se desactivó
      // mientras se llenaba, evitar un envío que fallará y refrescar el pool.
      if (this.network.online()) {
        const activo = await this.vehiculos.estaActivo(this.vehiculoId);
        if (activo === false) {
          this.toast.error('Este vehículo ya no está disponible. No se pudo enviar.');
          await this.vehiculos.invalidatePendientes();
          this.submitting.set(false);
          void this.router.navigate(['/transporte'], { replaceUrl: true });
          return;
        }
      }
      const fotos: Record<string, Blob> = {};
      for (const f of this.fotosReq) fotos[f.slot] = this.fotos()[f.slot].blob;

      await this.vehiculos.enqueueEntrega({
        vehiculoId: this.vehiculoId,
        tipo: this.tipo,
        km: this.km()!,
        combustible: this.combustible()!,
        observacion: null,
        gps: this.gps,
        fotos,
        firma: firmaBlob,
        danos: this.danos().map((d) => ({
          zona: d.zona,
          descripcion: d.descripcion,
          blob: d.photo!.blob,
        })),
        placa: this.placa(),
      });
      void this.autosave.discard(this.clave());
      // S29 — refrescar el pool para que el vehículo recibido salga de "por recibir".
      void this.vehiculos.invalidatePendientes();
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar. Intenta de nuevo.');
    } finally {
      this.submitting.set(false);
    }
  }

  finish(): void {
    void this.router.navigate(['/transporte'], { replaceUrl: true });
  }

  get online(): boolean {
    return this.network.online();
  }
}
