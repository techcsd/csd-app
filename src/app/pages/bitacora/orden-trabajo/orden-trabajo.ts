import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { SelectOption } from '../../../shared/ui/select-list/select-list';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { resetScrollOnStep } from '../../../shared/util/scroll';
import { BitacoraService } from '../../../core/services/bitacora.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { fechaLocalISO } from '../../../core/util/fecha';
import { Proyecto } from '../../../core/models/bitacora.model';

const TOTAL = 6;

/**
 * BN1 — Orden de trabajo (bitácora tipo orden_trabajo): trabajo pedido por el
 * cliente, con descripción/ubicación/monto y DOS firmas capturadas en el mismo
 * dispositivo (ingeniero + cliente). Offline-first: la captura va al outbox y el
 * handler llama crear_orden_trabajo al sincronizar. Las dos firmas son
 * obligatorias (el servidor también lo valida). El monto es sólo registro (§G-2).
 */
@Component({
  selector: 'app-orden-trabajo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, StepBar, WizardFooter, CollapsibleSelect, BigConfirm, ConfirmDialog, SignaturePad, Skeleton],
  templateUrl: './orden-trabajo.html',
  styleUrl: './orden-trabajo.scss',
})
export class OrdenTrabajoPage implements OnDestroy {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private bitacora = inject(BitacoraService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private ctx = inject(UserContextService);
  private navGuard = inject(NavGuardService);
  private borrador = inject(BorradorService);

  private sig = viewChild(SignaturePad);

  readonly total = TOTAL;
  readonly hoy = fechaLocalISO();

  private draftKey = '';
  private hydrated = false;

  step = signal(1);
  loading = signal(true);
  proyectos = signal<Proyecto[]>([]);
  unidades = signal<string[]>([]);

  // Paso 1 — obra + fecha
  proyectoId = signal('');
  fecha = signal<string>(fechaLocalISO());
  esFechaPasada = computed(() => !!this.fecha() && this.fecha() < this.hoy);
  proyectoOpciones = computed<SelectOption[]>(() => this.proyectos().map((p) => ({ id: p.id, label: p.nombre })));
  proyectoNombre = computed(() => this.proyectos().find((p) => p.id === this.proyectoId())?.nombre ?? '');

  // Paso 2 — trabajo
  descripcion = signal('');
  ubicacion = signal('');

  // Paso 3 — detalles (opcionales)
  cantidad = signal<number | null>(null);
  unidad = signal('');
  montoEstimado = signal<number | null>(null);
  solicitadoPor = signal('');
  comentarios = signal('');

  // Paso 4 — firma del ingeniero (nombre precargado con el usuario actual)
  ingNombre = signal<string>(this.ctx.nombre());
  ingCedula = signal('');
  ingRolDesc = signal('Ingeniero');
  private ingBlob = signal<Blob | null>(null);
  ingFirmada = computed(() => !!this.ingBlob());

  // Paso 5 — firma del cliente
  cliNombre = signal('');
  cliCedula = signal('');
  cliRolDesc = signal('Cliente');
  private cliBlob = signal<Blob | null>(null);
  cliFirmada = computed(() => !!this.cliBlob());

  // Señal viva para habilitar el botón "Agregar/refrescar" del pad visible.
  padTieneTrazo = signal(false);

  submitting = signal(false);
  done = signal(false);
  confirmSalir = signal(false);

  private readonly backHandler = (): boolean => {
    if (this.tieneDatos()) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  constructor() {
    resetScrollOnStep(() => this.step(), () => this.done());
    void this.load();
    this.navGuard.register(this.backHandler);
    // Autosave del borrador (SIN firmas: los PNG se recapturan, como en el resto
    // de la app). El texto se recupera desde "Documentación en proceso".
    effect(() => {
      const snap: OrdenTrabajoDraft = {
        proyectoId: this.proyectoId(),
        fecha: this.fecha(),
        descripcion: this.descripcion(),
        ubicacion: this.ubicacion(),
        cantidad: this.cantidad(),
        unidad: this.unidad(),
        montoEstimado: this.montoEstimado(),
        solicitadoPor: this.solicitadoPor(),
        comentarios: this.comentarios(),
        ingNombre: this.ingNombre(),
        ingCedula: this.ingCedula(),
        ingRolDesc: this.ingRolDesc(),
        cliNombre: this.cliNombre(),
        cliCedula: this.cliCedula(),
        cliRolDesc: this.cliRolDesc(),
        step: this.step(),
      };
      if (!this.hydrated || this.done()) return;
      if (!this.tieneDatos()) return;
      void this.borrador.save(this.draftKey, snap, {
        tipo: 'orden_trabajo',
        etiqueta: 'Orden de trabajo' + (this.proyectoNombre() ? ' · ' + this.proyectoNombre() : ''),
        ruta: '/bitacora/orden-trabajo',
      });
    });
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [proyectos, unidades] = await Promise.all([
        this.bitacora.getProyectos(),
        this.bitacora.getUnidades().catch(() => [] as string[]),
      ]);
      this.proyectos.set(proyectos);
      this.unidades.set(unidades);

      const claveParam = this.route.snapshot.queryParamMap.get('borrador');
      const draft = claveParam ? await this.borrador.load<OrdenTrabajoDraft>(claveParam) : null;
      this.draftKey = draft && claveParam ? claveParam : `orden_trabajo:${crypto.randomUUID()}`;
      if (draft) {
        this.proyectoId.set(draft.proyectoId ?? '');
        this.fecha.set(draft.fecha || this.hoy);
        this.descripcion.set(draft.descripcion ?? '');
        this.ubicacion.set(draft.ubicacion ?? '');
        this.cantidad.set(draft.cantidad ?? null);
        this.unidad.set(draft.unidad ?? '');
        this.montoEstimado.set(draft.montoEstimado ?? null);
        this.solicitadoPor.set(draft.solicitadoPor ?? '');
        this.comentarios.set(draft.comentarios ?? '');
        this.ingNombre.set(draft.ingNombre || this.ctx.nombre());
        this.ingCedula.set(draft.ingCedula ?? '');
        this.ingRolDesc.set(draft.ingRolDesc ?? 'Ingeniero');
        this.cliNombre.set(draft.cliNombre ?? '');
        this.cliCedula.set(draft.cliCedula ?? '');
        this.cliRolDesc.set(draft.cliRolDesc ?? 'Cliente');
        this.step.set(draft.step ?? 1);
        this.toast.show('Recuperamos tu orden a medio llenar. Las firmas hay que capturarlas de nuevo.', 'info', 4500);
      } else {
        const obra = this.ctx.obraActiva();
        if (obra) this.proyectoId.set(obra.id);
        else if (proyectos.length === 1) this.proyectoId.set(proyectos[0].id);
      }
    } catch {
      this.toast.error('No se pudieron cargar las obras.');
    } finally {
      this.loading.set(false);
      this.hydrated = true;
    }
  }

  pickProyecto(id: string): void {
    this.proyectoId.set(id);
  }

  // ── Firma ──────────────────────────────────────────────────────────────────

  /** Captura el trazo del pad visible en el paso actual (si dibujó algo) hacia el
   *  blob del rol correspondiente. Se llama al AVANZAR de un paso de firma. */
  private async capturarFirmaPaso(): Promise<void> {
    const pad = this.sig();
    if (!pad) return;
    const blob = await pad.toBlob(); // null si el pad está vacío
    if (!blob) return; // sin trazo nuevo: se conserva lo que hubiera
    if (this.step() === 4) this.ingBlob.set(blob);
    else if (this.step() === 5) this.cliBlob.set(blob);
  }

  limpiarFirmaActual(): void {
    this.sig()?.clear();
    if (this.step() === 4) this.ingBlob.set(null);
    else if (this.step() === 5) this.cliBlob.set(null);
    this.padTieneTrazo.set(false);
  }

  // ── Navegación ─────────────────────────────────────────────────────────────

  primaryLabel = computed(() =>
    this.step() >= this.total ? (this.submitting() ? 'Guardando…' : 'Enviar orden') : 'Siguiente',
  );
  backLabel = computed(() => (this.step() > 1 ? 'Atrás' : 'Cancelar'));
  primaryDisabled = computed(() => this.step() >= this.total && this.submitting());

  onPrimary(): void {
    void this.avanzar();
  }

  private async avanzar(): Promise<void> {
    const s = this.step();
    // Validaciones por paso.
    if (s === 1 && !this.proyectoId()) {
      this.toast.error('Elige la obra.');
      return;
    }
    if (s === 2 && !this.descripcion().trim()) {
      this.toast.error('Describe el trabajo que se pidió.');
      return;
    }
    if (s === 4) {
      await this.capturarFirmaPaso();
      if (!this.ingFirmada()) {
        this.toast.error('Falta la firma del ingeniero.');
        return;
      }
      if (!this.ingNombre().trim()) {
        this.toast.error('Escribe el nombre del ingeniero.');
        return;
      }
    }
    if (s === 5) {
      await this.capturarFirmaPaso();
      if (!this.cliFirmada()) {
        this.toast.error('Falta la firma del cliente.');
        return;
      }
      if (!this.cliNombre().trim()) {
        this.toast.error('Escribe el nombre del cliente.');
        return;
      }
    }
    if (s >= this.total) {
      void this.submit();
      return;
    }
    this.padTieneTrazo.set(false);
    this.step.update((x) => Math.min(this.total, x + 1));
  }

  onBack(): void {
    void this.retroceder();
  }

  private async retroceder(): Promise<void> {
    // Al salir de un paso de firma hacia atrás, conserva el trazo ya hecho.
    if (this.step() === 4 || this.step() === 5) await this.capturarFirmaPaso();
    if (this.step() > 1) {
      this.padTieneTrazo.set(false);
      this.step.update((s) => s - 1);
    } else {
      this.salir();
    }
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.proyectoId() || !this.descripcion().trim()) {
      this.toast.error('Faltan datos de la orden.');
      return;
    }
    if (!this.ingFirmada() || !this.cliFirmada()) {
      this.toast.error('Faltan las firmas. Ambas son obligatorias.');
      this.step.set(this.ingFirmada() ? 5 : 4);
      return;
    }
    this.submitting.set(true);
    try {
      await this.bitacora.enqueueOrdenTrabajo({
        proyectoId: this.proyectoId(),
        fecha: this.fecha() || this.hoy,
        descripcion: this.descripcion().trim(),
        ubicacion: this.ubicacion().trim() || null,
        cantidad: this.cantidad(),
        unidad: this.unidad().trim() || null,
        montoEstimado: this.montoEstimado(),
        solicitadoPor: this.solicitadoPor().trim() || null,
        notas: null,
        comentarios: this.comentarios().trim() || null,
        firmaIngNombre: this.ingNombre().trim() || 'Ingeniero',
        firmaIngCedula: this.ingCedula().trim() || null,
        firmaIngRolDesc: this.ingRolDesc().trim() || null,
        firmaIngBlob: this.ingBlob(),
        firmaCliNombre: this.cliNombre().trim() || 'Cliente',
        firmaCliCedula: this.cliCedula().trim() || null,
        firmaCliRolDesc: this.cliRolDesc().trim() || null,
        firmaCliBlob: this.cliBlob(),
        esPrueba: false, // el trigger trg_heredar_es_prueba lo coalescea desde la obra
      });
      this.hydrated = false;
      await this.borrador.clear(this.draftKey);
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar la orden.');
    } finally {
      this.submitting.set(false);
    }
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }

  private tieneDatos(): boolean {
    return (
      !this.done() &&
      (this.step() > 1 ||
        !!this.proyectoId() ||
        !!this.descripcion().trim() ||
        !!this.ubicacion().trim() ||
        this.cantidad() !== null ||
        this.montoEstimado() !== null ||
        !!this.solicitadoPor().trim() ||
        !!this.comentarios().trim() ||
        this.ingFirmada() ||
        this.cliFirmada())
    );
  }

  salir(): void {
    if (this.tieneDatos()) this.confirmSalir.set(true);
    else this.finish();
  }
  confirmarSalir(): void {
    this.confirmSalir.set(false);
    this.finish();
  }
  cancelarSalir(): void {
    this.confirmSalir.set(false);
  }

  finish(): void {
    void this.router.navigate(['/bitacora'], { replaceUrl: true });
  }

  get online(): boolean {
    return this.network.online();
  }
}

/** Forma persistida del borrador (sin firmas: los PNG se recapturan). */
interface OrdenTrabajoDraft {
  proyectoId: string;
  fecha: string;
  descripcion: string;
  ubicacion: string;
  cantidad: number | null;
  unidad: string;
  montoEstimado: number | null;
  solicitadoPor: string;
  comentarios: string;
  ingNombre: string;
  ingCedula: string;
  ingRolDesc: string;
  cliNombre: string;
  cliCedula: string;
  cliRolDesc: string;
  step: number;
}
