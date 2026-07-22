import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { BorradorService } from '../../../core/services/borrador.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { resetScrollOnStep } from '../../../shared/util/scroll';
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
  CatOrdenado,
  ESTRUCTURAS,
  Proyecto,
  ProyectoPartida,
  RESTRICCIONES,
} from '../../../core/models/bitacora.model';

const TOTAL = 10;
const MIN_FOTOS = 2; // S6 — mínimo de fotos por bitácora (espejo del RPC).

/** Sub-pasos internos del paso 5 (multi-bloque) y del paso 8 (equipos). */
type Paso5 = 'sujeto' | 'actividades' | 'otro';
type Paso8 = 'uso' | 'retirar' | 'danado';

/** Parte diario wizard — one section per screen, photo-first (User Flow §4). */
@Component({
  selector: 'app-parte',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, StepBar, Counter, OptionButton, BigConfirm, ConfirmDialog, Skeleton, WizardFooter],
  templateUrl: './parte.html',
  styleUrl: './parte.scss',
})
export class PartePage implements OnDestroy {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private camera = inject(CameraService);
  private bitacora = inject(BitacoraService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private ctx = inject(UserContextService);
  private borrador = inject(BorradorService);
  private navGuard = inject(NavGuardService);

  // S5 — clave de borrador por instancia (varios borradores a la vez).
  private draftKey = '';
  private hydrated = false;

  readonly total = TOTAL;
  readonly minFotos = MIN_FOTOS;
  // Fallback offline; se sobreescribe con el catálogo ordenado del SGC (S2).
  estructuras = signal<CatOrdenado[]>(ESTRUCTURAS.map((v) => ({ valor: v, destacado: false })));
  actividadesCat = signal<CatOrdenado[]>(ACTIVIDADES.map((v) => ({ valor: v, destacado: false })));
  restriccionesCat = signal<readonly string[]>(RESTRICCIONES);

  step = signal(1);
  paso5 = signal<Paso5>('sujeto'); // S3/S4 — sub-paso del "¿qué se hizo hoy?"
  paso8 = signal<Paso8>('uso'); // S7 — sub-paso de equipos

  proyectos = signal<Proyecto[]>([]);
  proyectoId = signal<string>('');

  // R21/R22 — clima y migración (primeras preguntas tras la obra).
  llovio = signal<boolean | null>(null);
  lluviaDetalle = signal('');
  huboMigracion = signal<boolean | null>(null);
  migracionObreros = signal('');

  // R24 — partidas planeadas del proyecto (referencia de cantidades).
  partidas = signal<ProyectoPartida[]>([]);
  // Q6 — catálogo de unidades de medida (offline) para el trabajo realizado.
  unidades = signal<string[]>([]);

  // W3 — datos finales del parte (paso 9).
  ingenieroResponsable = signal('');
  horaFinTrabajo = signal('');

  carpinteria = signal(0);
  acero = signal(0);
  casa = signal(0);
  otroPersonal = signal('');

  // S4 — cada actividad lleva su `bloque` (sujeto). `sujetoActual` es el bloque
  // que se está llenando en este momento.
  actividades = signal<ActividadEntry[]>([]);
  sujetoActual = signal<string>('');
  // Estructura elegida dentro del sujeto actual (¿en qué parte?).
  parteActual = signal<string>('');

  restricciones = signal<string[]>([]);
  // U12 — descripción breve obligatoria por restricción seleccionada (tipo → texto).
  restriccionDesc = signal<Record<string, string>>({});

  // W2/S7 — equipos alquilados (en uso / para retirar / dañados).
  huboEquipos = signal(false);
  hayRetirar = signal(false);
  hayDanados = signal(false);
  equiposAlquilados = signal<EquipoRow[]>([]);
  equiposSugeridos = signal<string[]>([]);
  retiroNombre = signal('');
  danoNombre = signal('');

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

  // Resumen de problemas: "Ninguno" si solo está NINGUNA (o vacío), si no el conteo.
  problemasResumen = computed(() => {
    const r = this.restricciones().filter((x) => x !== 'NINGUNA');
    return r.length ? r.length : 'Ninguno';
  });

  // S4 — bloques ya registrados (distintos) y el resumen agrupado por bloque.
  bloques = computed(() => [
    ...new Set(this.actividades().map((a) => (a.bloque ?? '').trim()).filter(Boolean)),
  ]);
  resumenPorBloque = computed(() => {
    const grupos = new Map<string, ActividadEntry[]>();
    for (const a of this.actividades()) {
      const b = (a.bloque ?? '').trim() || 'Sin bloque';
      if (!grupos.has(b)) grupos.set(b, []);
      grupos.get(b)!.push(a);
    }
    return [...grupos.entries()].map(([bloque, items]) => ({ bloque, items }));
  });
  // Actividades del sujeto que se está llenando (con su índice absoluto).
  actividadesDelSujeto = computed(() =>
    this.actividades()
      .map((a, i) => ({ a, i }))
      .filter((x) => (x.a.bloque ?? '') === this.sujetoActual()),
  );
  // Equipos marcados para retirar / dañados (para las sub-preguntas de S7).
  equiposParaRetirar = computed(() => this.equiposAlquilados().filter((e) => e.para_retirar));
  equiposDanados = computed(() => this.equiposAlquilados().filter((e) => e.danado));

  private readonly backHandler = (): boolean => {
    if (this.tieneDatos()) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  constructor() {
    // U3/U4 — resetear scroll en cada paso y sub-paso (paso5/paso8) y en el resultado.
    resetScrollOnStep(() => this.step(), () => this.paso5(), () => this.paso8(), () => this.done());
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
        ingenieroResponsable: this.ingenieroResponsable(),
        horaFinTrabajo: this.horaFinTrabajo(),
        actividades: this.actividades(),
        restricciones: this.restricciones(),
        restriccionDesc: this.restriccionDesc(),
        huboEquipos: this.huboEquipos(),
        hayRetirar: this.hayRetirar(),
        hayDanados: this.hayDanados(),
        equiposAlquilados: this.equiposAlquilados(),
        comentarios: this.comentarios(),
        step: this.step(),
      };
      if (!this.hydrated || this.done()) return;
      if (!this.hasContent(snap)) return;
      void this.borrador.save(this.draftKey, snap, {
        tipo: 'parte',
        etiqueta: 'Bitácora del día' + (this.proyectoNombre() ? ' · ' + this.proyectoNombre() : ''),
        ruta: '/bitacora/parte',
      });
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

    // Q6 — catálogo de unidades (offline) para el selector del trabajo realizado.
    void this.bitacora.getUnidades().then((u) => this.unidades.set(u));

    // S5 — resolver la clave del borrador: retomar uno existente (?borrador=)
    // o empezar uno nuevo. Antes migramos el borrador legacy 'parte_diario'.
    await this.borrador.migrateLegacyParte();
    const claveParam = this.route.snapshot.queryParamMap.get('borrador');

    const draft = claveParam
      ? await this.borrador.load<ParteDraft>(claveParam)
      : null;
    this.draftKey = draft && claveParam ? claveParam : `parte_diario:${crypto.randomUUID()}`;

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
      this.ingenieroResponsable.set(draft.ingenieroResponsable ?? '');
      this.horaFinTrabajo.set(draft.horaFinTrabajo ?? '');
      this.actividades.set(draft.actividades ?? []);
      this.restricciones.set(draft.restricciones ?? []);
      this.restriccionDesc.set(draft.restriccionDesc ?? {});
      this.huboEquipos.set(draft.huboEquipos ?? false);
      this.hayRetirar.set(draft.hayRetirar ?? false);
      this.hayDanados.set(draft.hayDanados ?? false);
      this.equiposAlquilados.set(draft.equiposAlquilados ?? []);
      this.comentarios.set(draft.comentarios ?? '');
      this.step.set(draft.step ?? 1);
      this.toast.show('Recuperamos tu bitácora a medio llenar. Las fotos hay que tomarlas de nuevo.', 'info', 4500);
    } else {
      const obra = this.ctx.obraActiva();
      if (obra) this.proyectoId.set(obra.id);
      else if (list.length === 1) this.proyectoId.set(list[0].id);
    }
    if (this.proyectoId()) {
      void this.loadPartidas(this.proyectoId());
      void this.loadCatalogo(this.proyectoId());
      void this.loadEquiposObra(this.proyectoId());
    }
    this.hydrated = true;
  }

  /** T19 — sugerencias de equipos de ESTA obra (fallback al listado global). */
  private async loadEquiposObra(proyectoId: string): Promise<void> {
    const deObra = await this.bitacora.getEquiposDeObra(proyectoId);
    if (deObra.length) this.equiposSugeridos.set(deObra);
  }

  private async loadPartidas(proyectoId: string): Promise<void> {
    this.partidas.set(await this.bitacora.getPartidas(proyectoId));
  }

  /** S2 — estructuras/actividades ordenadas (más usadas de la obra primero). */
  private async loadCatalogo(proyectoId: string): Promise<void> {
    const cat = await this.bitacora.getCatalogoOrdenado(proyectoId);
    if (cat.estructuras.length) this.estructuras.set(cat.estructuras);
    if (cat.actividades.length) this.actividadesCat.set(cat.actividades);
    // Las restricciones siguen viniendo del catálogo plano.
    const plano = await this.bitacora.getCatalogos();
    if (plano.restricciones.length) this.restriccionesCat.set(plano.restricciones);
  }

  /** Planned quantity for an activity's structure, if the project defines it. */
  partidaDe(estructura: string): ProyectoPartida | undefined {
    const key = estructura.toLowerCase();
    return this.partidas().find((p) => p.nombre.toLowerCase() === key);
  }

  // ── Paso 5 — sujeto + actividades (S3/S4) ─────────────────────────────────

  /** Empieza a llenar el sujeto tecleado y pasa a elegir actividades. */
  continuarSujeto(): void {
    if (!this.sujetoActual().trim()) {
      this.toast.error('Escribe el bloque, piso o edificio.');
      return;
    }
    this.sujetoActual.set(this.sujetoActual().trim());
    this.parteActual.set('');
    this.paso5.set('actividades');
  }

  /** Retomar un bloque ya empezado para agregarle más actividades. */
  editarBloque(bloque: string): void {
    this.sujetoActual.set(bloque);
    this.parteActual.set('');
    this.paso5.set('actividades');
  }

  /** S4 — "Sí, trabajé en otro bloque": limpia el sujeto y vuelve a elegirlo. */
  otroBloque(): void {
    this.sujetoActual.set('');
    this.parteActual.set('');
    this.paso5.set('sujeto');
  }

  /** Elige/cambia la estructura actual (¿en qué parte?). Vuelve a tocarla para cerrar. */
  toggleEstructura(e: string): void {
    this.parteActual.update((cur) => (cur === e ? '' : e));
  }

  /** ¿La actividad ya está agregada para el sujeto + estructura actual? */
  actividadOn(a: string): boolean {
    const parte = this.parteActual();
    const sujeto = this.sujetoActual();
    return (
      !!parte &&
      this.actividades().some(
        (x) => (x.bloque ?? '') === sujeto && x.estructura === parte && x.actividad === a,
      )
    );
  }

  /** Toca una actividad → agrega (o quita) la fila {sujeto, parte, actividad}. */
  toggleActividad(a: string): void {
    const parte = this.parteActual();
    const sujeto = this.sujetoActual();
    if (!parte) {
      this.toast.error('Primero elige en qué parte se trabajó (arriba).');
      return;
    }
    this.actividades.update((list) => {
      const idx = list.findIndex(
        (x) => (x.bloque ?? '') === sujeto && x.estructura === parte && x.actividad === a,
      );
      if (idx >= 0) return list.filter((_, i) => i !== idx); // toca de nuevo = quitar
      const unidad = this.partidaDe(parte)?.unidad ?? null;
      return [...list, { estructura: parte, actividad: a, cantidad: 1, unidad, bloque: sujeto }];
    });
  }

  removeActividad(i: number): void {
    this.actividades.update((a) => a.filter((_, idx) => idx !== i));
  }

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

  setUnidadAct(i: number, unidad: string): void {
    this.actividades.update((a) =>
      a.map((x, idx) => (idx === i ? { ...x, unidad: unidad || null } : x)),
    );
  }

  // ── Restricciones ─────────────────────────────────────────────────────────

  toggleRestriccion(r: string): void {
    const willRemove = this.restricciones().includes(r);
    if (!willRemove && r === 'NINGUNA') {
      this.restricciones.set(['NINGUNA']);
      this.restriccionDesc.set({});
      return;
    }
    this.restricciones.update((list) => {
      const base = willRemove ? list.filter((x) => x !== r) : [...list.filter((x) => x !== 'NINGUNA'), r];
      return base;
    });
    if (willRemove) {
      this.restriccionDesc.update((m) => {
        const next = { ...m };
        delete next[r];
        return next;
      });
    }
  }

  requiereDescripcion(r: string): boolean {
    return this.restricciones().includes(r) && r !== 'NINGUNA';
  }

  getRestriccionDesc(r: string): string {
    return this.restriccionDesc()[r] ?? '';
  }

  setRestriccionDesc(r: string, v: string): void {
    this.restriccionDesc.update((m) => ({ ...m, [r]: v }));
  }

  // ── Paso 8 — equipos (S7) ──────────────────────────────────────────────────

  onHuboEquiposChange(v: boolean): void {
    this.huboEquipos.set(v);
    if (v && this.equiposEnUso().length === 0) this.addEquipo();
    // Al decir "No", quita las filas que solo eran de uso (conserva retirar/dañado).
    if (!v) this.equiposAlquilados.update((l) => l.filter((e) => e.para_retirar || e.danado));
  }

  /** Equipos "en uso" (los que no son solo para retirar/dañado). */
  equiposEnUso(): EquipoRow[] {
    return this.equiposAlquilados().filter((e) => !e.soloRetiroDano);
  }

  addEquipo(): void {
    this.equiposAlquilados.update((l) => [
      ...l,
      { equipo: '', uso: '', proveedor: '', para_retirar: false, danado: false, dano_detalle: '' },
    ]);
  }

  removeEquipo(row: EquipoRow): void {
    this.equiposAlquilados.update((l) => l.filter((e) => e !== row));
  }

  updateEquipo(row: EquipoRow, field: 'equipo' | 'uso' | 'proveedor', value: string): void {
    this.equiposAlquilados.update((l) => l.map((e) => (e === row ? { ...e, [field]: value } : e)));
  }

  onHayRetirarChange(v: boolean): void {
    this.hayRetirar.set(v);
    if (!v) {
      // Desmarca retiros y elimina filas que existían SOLO para retiro.
      this.equiposAlquilados.update((l) =>
        l.filter((e) => !(e.soloRetiroDano && e.para_retirar && !e.danado)).map((e) => ({ ...e, para_retirar: false })),
      );
    }
  }

  toggleRetirar(row: EquipoRow): void {
    this.equiposAlquilados.update((l) =>
      l.map((e) => (e === row ? { ...e, para_retirar: !e.para_retirar } : e)),
    );
  }

  addEquipoRetirar(): void {
    const nombre = this.retiroNombre().trim();
    if (!nombre) return;
    this.equiposAlquilados.update((l) => [
      ...l,
      { equipo: nombre, uso: '', proveedor: '', para_retirar: true, danado: false, dano_detalle: '', soloRetiroDano: true },
    ]);
    this.retiroNombre.set('');
  }

  onHayDanadosChange(v: boolean): void {
    this.hayDanados.set(v);
    if (!v) {
      this.equiposAlquilados.update((l) =>
        l
          .filter((e) => !(e.soloRetiroDano && e.danado && !e.para_retirar))
          .map((e) => ({ ...e, danado: false, dano_detalle: '' })),
      );
    }
  }

  toggleDanado(row: EquipoRow): void {
    this.equiposAlquilados.update((l) =>
      l.map((e) => (e === row ? { ...e, danado: !e.danado } : e)),
    );
  }

  setDanoDetalle(row: EquipoRow, v: string): void {
    this.equiposAlquilados.update((l) => l.map((e) => (e === row ? { ...e, dano_detalle: v } : e)));
  }

  addEquipoDanado(): void {
    const nombre = this.danoNombre().trim();
    if (!nombre) return;
    this.equiposAlquilados.update((l) => [
      ...l,
      { equipo: nombre, uso: '', proveedor: '', para_retirar: false, danado: true, dano_detalle: '', soloRetiroDano: true },
    ]);
    this.danoNombre.set('');
  }

  // ── Fotos ───────────────────────────────────────────────────────────────

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

  // ── Navegación (footer) ────────────────────────────────────────────────────

  primaryLabel = computed(() => {
    const s = this.step();
    if (s === this.total) return this.submitting() ? 'Guardando…' : 'Enviar bitácora';
    if (s === 5) {
      if (this.paso5() === 'sujeto') return 'Continuar';
      if (this.paso5() === 'otro') return 'No, eso es todo';
    }
    return 'Siguiente';
  });

  backLabel = computed(() => (this.step() > 1 || this.paso5() !== 'sujeto' ? 'Atrás' : 'Cancelar'));

  primaryDisabled = computed(() => this.step() >= this.total && this.submitting());

  onPrimary(): void {
    if (this.step() >= this.total) {
      void this.submit();
      return;
    }
    this.next();
  }

  onBack(): void {
    // Sub-pasos internos primero.
    if (this.step() === 5 && this.paso5() === 'actividades') {
      this.paso5.set('sujeto');
      return;
    }
    if (this.step() === 5 && this.paso5() === 'otro') {
      this.paso5.set('actividades');
      return;
    }
    if (this.step() === 8 && this.paso8() === 'retirar') {
      this.paso8.set('uso');
      return;
    }
    if (this.step() === 8 && this.paso8() === 'danado') {
      this.paso8.set('retirar');
      return;
    }
    if (this.step() > 1) {
      this.prev();
      return;
    }
    this.salir();
  }

  private next(): void {
    const s = this.step();
    if (s === 1) {
      if (!this.proyectoId()) {
        this.toast.error('Elige la obra.');
        return;
      }
      void this.loadPartidas(this.proyectoId());
      void this.loadCatalogo(this.proyectoId());
      void this.loadEquiposObra(this.proyectoId());
    }
    if (s === 2 && this.llovio() === null) {
      this.toast.error('Dinos si llovió o está lloviendo.');
      return;
    }
    if (s === 3 && this.huboMigracion() === null) {
      this.toast.error('Dinos si hubo problemas de migración.');
      return;
    }
    // Paso 5 — sub-máquina de sujeto/actividades/otro (S3/S4).
    if (s === 5) {
      if (this.paso5() === 'sujeto') {
        this.continuarSujeto();
        return;
      }
      if (this.paso5() === 'actividades') {
        if (!this.actividadesDelSujeto().length) {
          this.toast.error('Agrega al menos un trabajo para este bloque.');
          return;
        }
        this.paso5.set('otro');
        return;
      }
      // paso5 === 'otro' → "No, eso es todo" → paso 6.
    }
    // U12 — al salir de restricciones, cada una (menos NINGUNA) exige descripción.
    if (s === 6) {
      const faltante = this.restricciones().find(
        (r) => r !== 'NINGUNA' && !this.getRestriccionDesc(r).trim(),
      );
      if (faltante) {
        this.toast.error('Describe brevemente cada restricción seleccionada.');
        return;
      }
    }
    // S6 — mínimo 2 fotos para avanzar del paso de fotos.
    if (s === 7 && this.fotos().length < MIN_FOTOS) {
      this.toast.error(`Agrega al menos ${MIN_FOTOS} fotos de la obra.`);
      return;
    }
    // Paso 8 — sub-máquina de equipos (S7).
    if (s === 8) {
      if (this.paso8() === 'uso') {
        if (this.huboEquipos()) {
          const conNombre = this.equiposEnUso().filter((e) => e.equipo.trim());
          if (!conNombre.length) {
            this.toast.error('Escribe al menos un equipo o cambia a "No".');
            return;
          }
          if (conNombre.some((e) => !e.uso.trim())) {
            this.toast.error('Dinos en qué se usó cada equipo.');
            return;
          }
        }
        this.paso8.set('retirar');
        return;
      }
      if (this.paso8() === 'retirar') {
        if (this.hayRetirar() && !this.equiposParaRetirar().length) {
          this.toast.error('Marca o escribe el equipo a retirar, o cambia a "No".');
          return;
        }
        this.paso8.set('danado');
        return;
      }
      if (this.paso8() === 'danado') {
        if (this.hayDanados()) {
          if (!this.equiposDanados().length) {
            this.toast.error('Marca o escribe el equipo dañado, o cambia a "No".');
            return;
          }
          if (this.equiposDanados().some((e) => !(e.dano_detalle ?? '').trim())) {
            this.toast.error('Dinos qué le pasó a cada equipo dañado.');
            return;
          }
        }
        // → paso 9.
      }
    }

    const nextStep = Math.min(this.total, s + 1);
    if (nextStep === 5) this.paso5.set('sujeto');
    if (nextStep === 8) this.paso8.set('uso');
    this.step.set(nextStep);
  }

  private prev(): void {
    const prevStep = Math.max(1, this.step() - 1);
    if (prevStep === 5) this.paso5.set('otro'); // al volver a "qué se hizo", muestra el resumen
    if (prevStep === 8) this.paso8.set('danado');
    this.step.set(prevStep);
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
    if (this.fotos().length < MIN_FOTOS) {
      this.toast.error(`Agrega al menos ${MIN_FOTOS} fotos de la obra.`);
      this.step.set(7);
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
        bloqueEntrepiso: null, // S3 — el bloque ahora va por actividad
        ingenieroResponsable: this.ingenieroResponsable().trim() || null,
        horaFinTrabajo: this.horaFinTrabajo() || null,
        actividades: this.actividades(),
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
        equiposAlquilados: this.equiposAlquilados()
          .filter((e) => e.equipo.trim())
          .map((e) => ({
            equipo: e.equipo.trim(),
            uso: e.uso?.trim() || null,
            proveedor: e.proveedor?.trim() || null,
            para_retirar: !!e.para_retirar,
            danado: !!e.danado,
            dano_detalle: e.danado ? (e.dano_detalle ?? '').trim() || null : null,
          })),
      });
      this.hydrated = false; // stop autosave; discard the draft
      await this.borrador.clear(this.draftKey);
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

/** Fila de equipo en la UI (incluye flags de S7 + marca interna de origen). */
interface EquipoRow {
  equipo: string;
  uso: string;
  proveedor: string;
  para_retirar: boolean;
  danado: boolean;
  dano_detalle: string;
  /** true si la fila se creó SOLO para retirar/dañar (no estaba "en uso"). */
  soloRetiroDano?: boolean;
}

/** Forma persistida del borrador del parte (S5). */
interface ParteDraft {
  proyectoId: string;
  llovio: boolean | null;
  lluviaDetalle: string;
  huboMigracion: boolean | null;
  migracionObreros: string;
  carpinteria: number;
  acero: number;
  casa: number;
  otroPersonal: string;
  ingenieroResponsable?: string;
  horaFinTrabajo?: string;
  actividades: ActividadEntry[];
  restricciones: string[];
  restriccionDesc?: Record<string, string>;
  huboEquipos?: boolean;
  hayRetirar?: boolean;
  hayDanados?: boolean;
  equiposAlquilados?: EquipoRow[];
  comentarios: string;
  step: number;
}
