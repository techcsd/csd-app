import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BorradorService } from '../../../core/services/borrador.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { Counter } from '../../../shared/ui/counter/counter';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { CameraService, CapturedPhoto } from '../../../core/services/camera.service';
import { BitacoraService } from '../../../core/services/bitacora.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { UserContextService } from '../../../core/services/user-context.service';
import {
  ACTIVIDADES,
  ActividadEntry,
  ESTRUCTURAS,
  Proyecto,
  ProyectoPartida,
  RESTRICCIONES,
} from '../../../core/models/bitacora.model';

const TOTAL = 9;

/** Parte diario wizard — one section per screen, photo-first (User Flow §4). */
@Component({
  selector: 'app-parte',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, StepBar, Counter, OptionButton, BigConfirm, ConfirmDialog, Skeleton],
  templateUrl: './parte.html',
  styleUrl: './parte.scss',
})
export class PartePage implements OnDestroy {
  private router = inject(Router);
  private camera = inject(CameraService);
  private bitacora = inject(BitacoraService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private ctx = inject(UserContextService);
  private borrador = inject(BorradorService);
  private navGuard = inject(NavGuardService);

  private readonly DRAFT = 'parte_diario';
  private hydrated = false;

  readonly total = TOTAL;
  // Default to the built-in lists (works offline/instantly), then override with
  // the admin-managed catalog from the DB.
  estructuras = signal<readonly string[]>(ESTRUCTURAS);
  actividadesCat = signal<readonly string[]>(ACTIVIDADES);
  restriccionesCat = signal<readonly string[]>(RESTRICCIONES);

  step = signal(1);
  proyectos = signal<Proyecto[]>([]);
  proyectoId = signal<string>('');

  // R21/R22 — clima y migración (primeras preguntas tras la obra).
  llovio = signal<boolean | null>(null);
  lluviaDetalle = signal('');
  huboMigracion = signal<boolean | null>(null);
  migracionObreros = signal('');

  // R24 — partidas planeadas del proyecto (referencia de cantidades).
  partidas = signal<ProyectoPartida[]>([]);

  // W3 — paridad con la web (opcionales en campo).
  bloqueEntrepiso = signal('');
  ingenieroResponsable = signal('');
  horaFinTrabajo = signal('');

  carpinteria = signal(0);
  acero = signal(0);
  casa = signal(0);
  otroPersonal = signal('');

  actividades = signal<ActividadEntry[]>([]);
  selEstructuras = signal<string[]>([]);
  selActividades = signal<string[]>([]);

  restricciones = signal<string[]>([]);
  // U12 — descripción breve obligatoria por restricción seleccionada (tipo → texto).
  restriccionDesc = signal<Record<string, string>>({});

  // W2 — equipos alquilados en uso hoy (Sí/No + lista dinámica).
  huboEquipos = signal(false);
  equiposAlquilados = signal<{ equipo: string; uso: string; proveedor: string }[]>([]);
  equiposSugeridos = signal<string[]>([]);

  comentarios = signal('');

  fotos = signal<CapturedPhoto[]>([]);
  capturing = signal(false);

  // W5 — spinner de carga de obras en el paso 1.
  loadingObras = signal(true);

  submitting = signal(false);
  done = signal(false);
  confirmSalir = signal(false);

  proyectoNombre = computed(
    () => this.proyectos().find((p) => p.id === this.proyectoId())?.nombre ?? '',
  );

  private readonly backHandler = (): boolean => {
    if (this.tieneDatos()) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  constructor() {
    void this.load();
    this.navGuard.register(this.backHandler); // U4 — botón físico Android
    // Autosave the (non-photo) draft on every change so a killed app recovers.
    effect(() => {
      const snap = {
        proyectoId: this.proyectoId(),
        llovio: this.llovio(),
        lluviaDetalle: this.lluviaDetalle(),
        huboMigracion: this.huboMigracion(),
        migracionObreros: this.migracionObreros(),
        carpinteria: this.carpinteria(),
        acero: this.acero(),
        casa: this.casa(),
        otroPersonal: this.otroPersonal(),
        bloqueEntrepiso: this.bloqueEntrepiso(),
        ingenieroResponsable: this.ingenieroResponsable(),
        horaFinTrabajo: this.horaFinTrabajo(),
        actividades: this.actividades(),
        restricciones: this.restricciones(),
        restriccionDesc: this.restriccionDesc(),
        huboEquipos: this.huboEquipos(),
        equiposAlquilados: this.equiposAlquilados(),
        comentarios: this.comentarios(),
        step: this.step(),
      };
      if (!this.hydrated || this.done()) return;
      if (!this.hasContent(snap)) return;
      void this.borrador.save(this.DRAFT, snap);
    });
  }

  private hasContent(s: {
    step: number;
    llovio?: boolean | null;
    huboMigracion?: boolean | null;
    carpinteria: number;
    acero: number;
    casa: number;
    otroPersonal: string;
    actividades: ActividadEntry[];
    restricciones: string[];
    comentarios: string;
  }): boolean {
    return (
      s.step > 1 ||
      s.llovio != null ||
      s.huboMigracion != null ||
      s.carpinteria > 0 ||
      s.acero > 0 ||
      s.casa > 0 ||
      !!s.otroPersonal ||
      s.actividades.length > 0 ||
      s.restricciones.length > 0 ||
      !!s.comentarios
    );
  }

  private async load(): Promise<void> {
    this.loadingObras.set(true);
    const list = await this.bitacora.getProyectos();
    this.proyectos.set(list);
    this.loadingObras.set(false);

    // W2 — sugerencias de equipos (best-effort, no bloquea el wizard).
    void this.bitacora.getEquiposSugeridos().then((s) => this.equiposSugeridos.set(s));

    const cat = await this.bitacora.getCatalogos();
    if (cat.estructuras.length) this.estructuras.set(cat.estructuras);
    if (cat.actividades.length) this.actividadesCat.set(cat.actividades);
    if (cat.restricciones.length) this.restriccionesCat.set(cat.restricciones);

    const draft = await this.borrador.load<{
      proyectoId: string;
      llovio: boolean | null;
      lluviaDetalle: string;
      huboMigracion: boolean | null;
      migracionObreros: string;
      carpinteria: number;
      acero: number;
      casa: number;
      otroPersonal: string;
      bloqueEntrepiso?: string;
      ingenieroResponsable?: string;
      horaFinTrabajo?: string;
      actividades: ActividadEntry[];
      restricciones: string[];
      restriccionDesc?: Record<string, string>;
      huboEquipos?: boolean;
      equiposAlquilados?: { equipo: string; uso: string; proveedor: string }[];
      comentarios: string;
      step: number;
    }>(this.DRAFT);

    if (draft) {
      this.proyectoId.set(draft.proyectoId);
      this.llovio.set(draft.llovio ?? null);
      this.lluviaDetalle.set(draft.lluviaDetalle ?? '');
      this.huboMigracion.set(draft.huboMigracion ?? null);
      this.migracionObreros.set(draft.migracionObreros ?? '');
      this.carpinteria.set(draft.carpinteria);
      this.acero.set(draft.acero);
      this.casa.set(draft.casa);
      this.otroPersonal.set(draft.otroPersonal);
      this.bloqueEntrepiso.set(draft.bloqueEntrepiso ?? '');
      this.ingenieroResponsable.set(draft.ingenieroResponsable ?? '');
      this.horaFinTrabajo.set(draft.horaFinTrabajo ?? '');
      this.actividades.set(draft.actividades ?? []);
      this.restricciones.set(draft.restricciones ?? []);
      this.restriccionDesc.set(draft.restriccionDesc ?? {});
      this.huboEquipos.set(draft.huboEquipos ?? false);
      this.equiposAlquilados.set(draft.equiposAlquilados ?? []);
      this.comentarios.set(draft.comentarios ?? '');
      this.step.set(draft.step ?? 1);
      this.toast.show('Recuperamos tu bitácora a medio llenar. Las fotos hay que tomarlas de nuevo.', 'info', 4500);
    } else {
      const obra = this.ctx.obraActiva();
      if (obra) this.proyectoId.set(obra.id);
      else if (list.length === 1) this.proyectoId.set(list[0].id);
    }
    if (this.proyectoId()) void this.loadPartidas(this.proyectoId());
    this.hydrated = true;
  }

  private async loadPartidas(proyectoId: string): Promise<void> {
    this.partidas.set(await this.bitacora.getPartidas(proyectoId));
  }

  /** Planned quantity for an activity's structure, if the project defines it. */
  partidaDe(estructura: string): ProyectoPartida | undefined {
    const key = estructura.toLowerCase();
    return this.partidas().find((p) => p.nombre.toLowerCase() === key);
  }

  toggleEstructura(e: string): void {
    this.selEstructuras.update((l) => (l.includes(e) ? l.filter((x) => x !== e) : [...l, e]));
  }

  toggleActividad(a: string): void {
    this.selActividades.update((l) => (l.includes(a) ? l.filter((x) => x !== a) : [...l, a]));
  }

  /** Adds every selected estructura × actividad combination (deduped). */
  addActividad(): void {
    if (!this.selEstructuras().length || !this.selActividades().length) {
      this.toast.error('Elige al menos una estructura y una actividad.');
      return;
    }
    this.actividades.update((current) => {
      const next = [...current];
      for (const est of this.selEstructuras()) {
        for (const act of this.selActividades()) {
          if (!next.some((x) => x.estructura === est && x.actividad === act)) {
            next.push({ estructura: est, actividad: act, cantidad: 1 });
          }
        }
      }
      return next;
    });
    this.selEstructuras.set([]);
    this.selActividades.set([]);
  }

  removeActividad(i: number): void {
    this.actividades.update((a) => a.filter((_, idx) => idx !== i));
  }

  /** Set/adjust the quantity done for an activity row (R24). */
  setCantidadAct(i: number, v: number): void {
    this.actividades.update((a) =>
      a.map((x, idx) => (idx === i ? { ...x, cantidad: Math.max(0, v || 0) } : x)),
    );
  }

  ajustarCantidadAct(i: number, delta: number): void {
    this.actividades.update((a) =>
      a.map((x, idx) => (idx === i ? { ...x, cantidad: Math.max(0, (x.cantidad ?? 0) + delta) } : x)),
    );
  }

  toggleRestriccion(r: string): void {
    const willRemove = this.restricciones().includes(r);
    // APP-014: "NINGUNA" es mutuamente excluyente con los problemas reales.
    if (!willRemove && r === 'NINGUNA') {
      this.restricciones.set(['NINGUNA']);
      this.restriccionDesc.set({});
      return;
    }
    this.restricciones.update((list) => {
      const base = willRemove ? list.filter((x) => x !== r) : [...list.filter((x) => x !== 'NINGUNA'), r];
      return base;
    });
    // U12 — al quitar una restricción, descarta su descripción.
    if (willRemove) {
      this.restriccionDesc.update((m) => {
        const next = { ...m };
        delete next[r];
        return next;
      });
    }
  }

  /** U12 — ¿esta restricción exige "Describa…"? Todas menos NINGUNA. */
  requiereDescripcion(r: string): boolean {
    return this.restricciones().includes(r) && r !== 'NINGUNA';
  }

  getRestriccionDesc(r: string): string {
    return this.restriccionDesc()[r] ?? '';
  }

  setRestriccionDesc(r: string, v: string): void {
    this.restriccionDesc.update((m) => ({ ...m, [r]: v }));
  }

  // W2 — equipos alquilados.
  onHuboEquiposChange(v: boolean): void {
    this.huboEquipos.set(v);
    // Al decir "Sí" y no haber filas, arranca con una vacía para llenar.
    if (v && this.equiposAlquilados().length === 0) this.addEquipo();
  }

  addEquipo(): void {
    this.equiposAlquilados.update((l) => [...l, { equipo: '', uso: '', proveedor: '' }]);
  }

  removeEquipo(i: number): void {
    this.equiposAlquilados.update((l) => l.filter((_, idx) => idx !== i));
  }

  updateEquipo(i: number, field: 'equipo' | 'uso' | 'proveedor', value: string): void {
    this.equiposAlquilados.update((l) =>
      l.map((e, idx) => (idx === i ? { ...e, [field]: value } : e)),
    );
  }

  async addFoto(): Promise<void> {
    if (this.capturing()) return;
    this.capturing.set(true);
    try {
      const photo = await this.camera.takePhoto();
      if (photo) this.fotos.update((f) => [...f, photo]);
    } finally {
      this.capturing.set(false);
    }
  }

  /** W1 — agregar varias fotos de la galería de una sola vez (sin límite práctico). */
  async addFromGallery(): Promise<void> {
    if (this.capturing()) return;
    this.capturing.set(true);
    try {
      const photos = await this.camera.pickFromGallery();
      if (photos.length) this.fotos.update((f) => [...f, ...photos]);
    } finally {
      this.capturing.set(false);
    }
  }

  removeFoto(i: number): void {
    const f = this.fotos()[i];
    if (f) URL.revokeObjectURL(f.previewUrl);
    this.fotos.update((list) => list.filter((_, idx) => idx !== i));
  }

  next(): void {
    if (this.step() === 1) {
      if (!this.proyectoId()) {
        this.toast.error('Elige la obra.');
        return;
      }
      void this.loadPartidas(this.proyectoId());
    }
    if (this.step() === 2 && this.llovio() === null) {
      this.toast.error('Dinos si llovió o está lloviendo.');
      return;
    }
    if (this.step() === 3 && this.huboMigracion() === null) {
      this.toast.error('Dinos si hubo problemas de migración.');
      return;
    }
    // U12 — al salir del paso de restricciones, cada una (menos NINGUNA) exige descripción.
    if (this.step() === 6) {
      const faltante = this.restricciones().find(
        (r) => r !== 'NINGUNA' && !this.getRestriccionDesc(r).trim(),
      );
      if (faltante) {
        this.toast.error('Describe brevemente cada restricción seleccionada.');
        return;
      }
    }
    // W2 — al salir del paso de equipos, si hay equipos exige al menos uno con nombre y su uso.
    if (this.step() === 8 && this.huboEquipos()) {
      const conNombre = this.equiposAlquilados().filter((e) => e.equipo.trim());
      if (!conNombre.length) {
        this.toast.error('Escribe al menos un equipo o cambia a "No".');
        return;
      }
      if (conNombre.some((e) => !e.uso.trim())) {
        this.toast.error('Dinos en qué se usó cada equipo.');
        return;
      }
    }
    this.step.update((s) => Math.min(this.total, s + 1));
  }

  prev(): void {
    this.step.update((s) => Math.max(1, s - 1));
  }

  /** True when the wizard holds any half-filled data worth confirming before exit. */
  private tieneDatos(): boolean {
    return this.hasContent({
      step: this.step(),
      carpinteria: this.carpinteria(),
      acero: this.acero(),
      casa: this.casa(),
      otroPersonal: this.otroPersonal(),
      actividades: this.actividades(),
      restricciones: this.restricciones(),
      comentarios: this.comentarios(),
    });
  }

  /** Back/cancel from any step — the user must never have to close the app (R13). */
  salir(): void {
    if (this.tieneDatos()) {
      this.confirmSalir.set(true);
    } else {
      this.finish();
    }
  }

  confirmarSalir(): void {
    // The draft is autosaved, so leaving keeps it for later recovery.
    this.confirmSalir.set(false);
    this.finish();
  }

  cancelarSalir(): void {
    this.confirmSalir.set(false);
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }

  get online(): boolean {
    return this.network.online();
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.proyectoId()) {
      this.toast.error('Elige la obra.');
      return;
    }
    this.submitting.set(true);
    try {
      const obreros = this.migracionObreros()
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await this.bitacora.enqueueParteDiario({
        proyectoId: this.proyectoId(),
        personalCarpinteria: this.carpinteria(),
        personalAcero: this.acero(),
        trabajadoresCasa: this.casa(),
        otroPersonal: this.otroPersonal().trim() || null,
        bloqueEntrepiso: this.bloqueEntrepiso().trim() || null,
        ingenieroResponsable: this.ingenieroResponsable().trim() || null,
        horaFinTrabajo: this.horaFinTrabajo() || null,
        actividades: this.actividades(),
        // U12 — cada restricción con su descripción (NINGUNA sin descripción).
        restricciones: (this.restricciones().length ? this.restricciones() : ['NINGUNA']).map((r) => ({
          tipo_restriccion: r,
          descripcion_otro: r === 'NINGUNA' ? null : this.getRestriccionDesc(r).trim() || null,
        })),
        comentarios: this.comentarios().trim() || null,
        fotos: this.fotos().map((f) => f.blob),
        llovio: this.llovio(),
        lluviaDetalle: this.llovio() ? this.lluviaDetalle().trim() || null : null,
        huboMigracion: this.huboMigracion(),
        migracionObreros: this.huboMigracion() && obreros.length ? obreros : null,
        huboEquipos: this.huboEquipos(),
        equiposAlquilados: this.huboEquipos()
          ? this.equiposAlquilados()
              .filter((e) => e.equipo.trim())
              .map((e) => ({
                equipo: e.equipo.trim(),
                uso: e.uso.trim() || null,
                proveedor: e.proveedor.trim() || null,
              }))
          : [],
      });
      this.hydrated = false; // stop autosave; discard the draft
      await this.borrador.clear(this.DRAFT);
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.submitting.set(false);
    }
  }

  finish(): void {
    void this.router.navigate(['/bitacora'], { replaceUrl: true });
  }
}
