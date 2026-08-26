import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { BorradorService } from '../../../core/services/borrador.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { resetScrollOnStep } from '../../../shared/util/scroll';
import { Counter } from '../../../shared/ui/counter/counter';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { SelectOption } from '../../../shared/ui/select-list/select-list';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { VoiceNotes, VoiceNoteItem } from '../../../shared/ui/voice-notes/voice-notes';
import { CameraService, CapturedPhoto } from '../../../core/services/camera.service';
import { CronogramaService } from '../../../core/services/cronograma.service';
import { CronogramaTarea } from '../../../core/models/cronograma.model';
import { BitacoraService } from '../../../core/services/bitacora.service';
import { ProyectosService } from '../../../core/services/proyectos.service';
import { ResponsableProyecto } from '../../../core/models/proyecto.model';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { UserContextService } from '../../../core/services/user-context.service';
import {
  ACTIVIDADES,
  ActividadEntry,
  CatOrdenado,
  ESTRUCTURAS,
  MOTIVOS_SIN_ACTIVIDAD,
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
  imports: [FormsModule, StepBar, Counter, OptionButton, CollapsibleSelect, BigConfirm, ConfirmDialog, Skeleton, WizardFooter, VoiceNotes, PhotoSlot],
  templateUrl: './parte.html',
  styleUrl: './parte.scss',
})
export class PartePage implements OnDestroy {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private camera = inject(CameraService);
  private bitacora = inject(BitacoraService);
  private proyectosSvc = inject(ProyectosService);
  private cronograma = inject(CronogramaService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private ctx = inject(UserContextService);
  private borrador = inject(BorradorService);
  private navGuard = inject(NavGuardService);

  // S5 — clave de borrador por instancia (varios borradores a la vez).
  private draftKey = '';
  private hydrated = false;

  readonly minFotos = MIN_FOTOS;
  readonly motivosSinActividad = MOTIVOS_SIN_ACTIVIDAD;
  // Z4 — "No se trabajó en obra": el parte se resuelve en 3 pantallas.
  sinActividad = signal(false);
  motivoSinActividad = signal<string | null>(null);
  motivoDetalle = signal('');
  // Total de pasos efectivo: 3 en el flujo "no se trabajó", 10 en el normal.
  total = computed(() => (this.sinActividad() ? 3 : TOTAL));
  // Fallback offline; se sobreescribe con el catálogo ordenado del SGC (S2).
  estructuras = signal<CatOrdenado[]>(ESTRUCTURAS.map((v) => ({ valor: v, destacado: false })));
  actividadesCat = signal<CatOrdenado[]>(ACTIVIDADES.map((v) => ({ valor: v, destacado: false })));
  restriccionesCat = signal<readonly string[]>(RESTRICCIONES);

  step = signal(1);
  paso5 = signal<Paso5>('sujeto'); // S3/S4 — sub-paso del "¿qué se hizo hoy?"
  paso8 = signal<Paso8>('uso'); // S7 — sub-paso de equipos

  proyectos = signal<Proyecto[]>([]);
  proyectoId = signal<string>('');
  // AI14 — obra por dropdown estándar (AH10), no listado abierto.
  proyectoOpciones = computed<SelectOption[]>(() =>
    this.proyectos().map((p) => ({ id: p.id, label: p.nombre })),
  );
  pickProyecto(id: string): void {
    this.proyectoId.set(id);
    // AV3 — al cambiar de obra, recargar sus ingenieros y por defecto el principal.
    void this.loadIngenierosObra(id, true);
  }

  // R21/R22 — clima y migración (primeras preguntas tras la obra).
  llovio = signal<boolean | null>(null);
  lluviaDetalle = signal('');
  horasLluvia = signal(0); // Z5 — horas que la lluvia afectó (stepper 0..24)
  huboMigracion = signal<boolean | null>(null);
  migracionObreros = signal('');
  migracionObrerosCount = signal(0); // Z5 — cantidad de obreros (stepper)

  // R24 — partidas planeadas del proyecto (referencia de cantidades).
  partidas = signal<ProyectoPartida[]>([]);
  // Q6 — catálogo de unidades de medida (offline) para el trabajo realizado.
  unidades = signal<string[]>([]);

  // W3 — datos finales del parte (paso 9).
  ingenieroResponsable = signal('');
  horaFinTrabajo = signal('');
  // AV3 — ingenieros responsables de la obra (N:M). El principal va primero; el
  // usuario elige ENTRE ellos (chips) en vez de escribir a mano. Vacío offline →
  // el input libre sigue funcionando (fallback). El valor guardado es el NOMBRE
  // (crear_bitacora_app recibe texto → retrocompatible).
  ingenierosObra = signal<ResponsableProyecto[]>([]);

  carpinteria = signal(0);
  acero = signal(0);
  casa = signal(0);
  otroPersonal = signal('');

  // S4 — cada actividad lleva su `bloque` (sujeto). `sujetoActual` es el bloque
  // que se está llenando en este momento.
  actividades = signal<ActividadEntry[]>([]);
  sujetoActual = signal<string>('');
  // Z20 — estructuras (bloques/pisos/edificios) definidas por la obra
  // (proyecto_estructuras). Si la obra tiene, el paso 5 muestra un selector; si
  // no, cae a texto libre. `sujetoOtro` = el usuario eligió "Otro" (texto libre).
  estructurasObra = signal<string[]>([]);
  sujetoOtro = signal(false);
  // Estructura elegida dentro del sujeto actual (¿en qué parte?).
  parteActual = signal<string>('');
  // AX6 — el usuario eligió "Otros" en el elemento (columna/viga…): habilita un
  // texto libre OBLIGATORIO que se guarda tal cual en `estructura` (se reporta
  // verbatim y alimenta el catálogo de estructuras — ciclo AT11/AU12).
  parteOtro = signal(false);

  restricciones = signal<string[]>([]);
  // U12 — descripción breve obligatoria por restricción seleccionada (tipo → texto).
  restriccionDesc = signal<Record<string, string>>({});
  // Z21 — foto opcional por restricción seleccionada (tipo → foto). No se persiste
  // en el borrador (como las demás fotos, se retoma tomándola de nuevo).
  restriccionFotos = signal<Record<string, CapturedPhoto>>({});
  // AA9 — nota de voz opcional por restricción (tipo → notas). Una por restricción.
  restriccionVoces = signal<Record<string, VoiceNoteItem[]>>({});

  // W2/S7 — equipos alquilados (en uso / para retirar / dañados).
  huboEquipos = signal(false);
  hayRetirar = signal(false);
  hayDanados = signal(false);
  equiposAlquilados = signal<EquipoRow[]>([]);
  equiposSugeridos = signal<string[]>([]);
  retiroNombre = signal('');
  danoNombre = signal('');
  // Z22/AA10 — fotos (VARIAS) por equipo dañado (nombre → fotos). No se persiste
  // en el borrador (como las demás fotos, se retoman tomándolas de nuevo).
  equipoDanoFotos = signal<Record<string, CapturedPhoto[]>>({});

  comentarios = signal('');

  fotos = signal<CapturedPhoto[]>([]);

  // Y15.8 — vincular esta bitácora a una tarea del cronograma (opcional). Solo
  // aparece si el proyecto tiene tareas activas visibles para el usuario.
  tareasCronograma = signal<CronogramaTarea[]>([]);
  tareaVinculada = signal<string | null>(null);
  completarTarea = signal(false);
  /** Se puede completar la tarea desde la bitácora solo si hay ≥1 foto (evidencia). */
  puedeCompletarTarea = computed(() => !!this.tareaVinculada() && this.fotos().length > 0);
  voces = signal<VoiceNoteItem[]>([]); // Z23 — N notas de voz
  capturing = signal(false);

  // W5 — spinner de carga de obras en el paso 1.
  loadingObras = signal(true);

  submitting = signal(false);
  done = signal(false);
  confirmSalir = signal(false);

  proyectoNombre = computed(
    () => this.proyectos().find((p) => p.id === this.proyectoId())?.nombre ?? '',
  );

  // Z4 — etiqueta legible del motivo "no se trabajó" para el resumen.
  motivoSinActividadLabel = computed(
    () => MOTIVOS_SIN_ACTIVIDAD.find((m) => m.value === this.motivoSinActividad())?.label ?? '—',
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
  // Z6 — lo elegido sube a una sección "Seleccionadas" al inicio; el resto
  // mantiene el orden del catálogo (más usadas primero). Para la estructura actual.
  actividadesElegidas = computed(() =>
    this.actividadesCat().filter((ac) => this.actividadOn(ac.valor)),
  );
  // AW6 — buscador amigable de actividades (sin acentos, por palabras).
  filtroActividad = signal('');
  private normalizarTxt(s: string): string {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  actividadesDisponibles = computed(() => {
    const q = this.normalizarTxt(this.filtroActividad().trim());
    const base = this.actividadesCat().filter((ac) => !this.actividadOn(ac.valor));
    if (!q) return base;
    const tokens = q.split(/\s+/).filter(Boolean);
    return base.filter((ac) => {
      const v = this.normalizarTxt(ac.valor);
      return tokens.every((t) => v.includes(t));
    });
  });
  // AZ6 — "Otros" en el SEGUNDO nivel (actividades). Espejo del patrón AX6 del
  // primer nivel (estructura): el chip "+ Otros" habilita un texto libre que
  // entra como una actividad más del renglón (con su cantidad/unidad). El texto
  // libre alimenta el repositorio "Valores 'Otro'" por trigger de BD (membresía
  // de catálogo) → no necesita marca en el payload.
  actividadOtro = signal(false);
  actividadOtroTexto = signal('');

  /** AW1 — ¿la actividad permite "se trabajó" sin cantidad exacta (cantidad aprox.)? */
  permiteSinCantidad(actividad: string): boolean {
    return !!this.actividadesCat().find((ac) => ac.valor === actividad)?.permite_sin_cantidad;
  }
  /** AW1 — marca/desmarca una fila como cantidad APROXIMADA. */
  toggleAproximada(i: number): void {
    this.actividades.update((a) =>
      a.map((x, idx) => (idx === i ? { ...x, es_aproximada: !x.es_aproximada } : x)),
    );
  }
  // Z6 — estructuras del sujeto que ya tienen algún trabajo (marca ✓ sin reordenar).
  private estructurasConActividad = computed(
    () =>
      new Set(
        this.actividades()
          .filter((a) => (a.bloque ?? '') === this.sujetoActual())
          .map((a) => a.estructura),
      ),
  );
  estructuraTiene(valor: string): boolean {
    return this.estructurasConActividad().has(valor);
  }
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
        horasLluvia: this.horasLluvia(),
        sinActividad: this.sinActividad(),
        motivoSinActividad: this.motivoSinActividad(),
        motivoDetalle: this.motivoDetalle(),
        huboMigracion: this.huboMigracion(),
        migracionObreros: this.migracionObreros(),
        migracionObrerosCount: this.migracionObrerosCount(),
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
        tareaVinculada: this.tareaVinculada(), // Y15.8
        completarTarea: this.completarTarea(), // Y15.8
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
    sinActividad?: boolean;
    motivoSinActividad?: string | null;
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
      !!s.sinActividad ||
      !!s.motivoSinActividad ||
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
      this.horasLluvia.set(draft.horasLluvia ?? 0);
      this.sinActividad.set(draft.sinActividad ?? false);
      this.motivoSinActividad.set(draft.motivoSinActividad ?? null);
      this.motivoDetalle.set(draft.motivoDetalle ?? '');
      this.huboMigracion.set(draft.huboMigracion ?? null);
      this.migracionObreros.set(draft.migracionObreros ?? '');
      this.migracionObrerosCount.set(draft.migracionObrerosCount ?? 0);
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
      this.tareaVinculada.set(draft.tareaVinculada ?? null); // Y15.8
      this.completarTarea.set(draft.completarTarea ?? false); // Y15.8
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
      void this.loadEstructurasObra(this.proyectoId()); // Z20
      void this.loadTareasCronograma(this.proyectoId());
      this.prefillIngeniero(); // AA11
      void this.loadIngenierosObra(this.proyectoId()); // AV3
    }
    this.hydrated = true;
  }

  /** T19 — sugerencias de equipos de ESTA obra (fallback al listado global). */
  /** Y15.8 — tareas del cronograma de la obra (no completadas) para el vínculo. */
  private async loadTareasCronograma(proyectoId: string): Promise<void> {
    try {
      const d = await this.cronograma.listar(proyectoId);
      this.tareasCronograma.set(d.tareas.filter((t) => t.estado !== 'completada'));
    } catch {
      this.tareasCronograma.set([]); // sin acceso al cronograma → sin selector
    }
    // Si la tarea elegida ya no está, limpiar el vínculo.
    if (this.tareaVinculada() && !this.tareasCronograma().some((t) => t.id === this.tareaVinculada())) {
      this.tareaVinculada.set(null);
      this.completarTarea.set(false);
    }
  }

  private async loadEquiposObra(proyectoId: string): Promise<void> {
    const deObra = await this.bitacora.getEquiposDeObra(proyectoId);
    if (deObra.length) this.equiposSugeridos.set(deObra);
  }

  /** Z20 — estructuras (bloques/pisos/edificios) definidas por la obra. */
  private async loadEstructurasObra(proyectoId: string): Promise<void> {
    this.estructurasObra.set(await this.bitacora.getEstructurasObra(proyectoId));
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

  /** Z20 — elegir una estructura definida por la obra como bloque actual. */
  elegirEstructura(nombre: string): void {
    this.sujetoOtro.set(false);
    this.sujetoActual.set(nombre);
  }

  /** Z20 — "Otro" (texto libre): habilita el input y limpia la selección. */
  elegirOtroEstructura(): void {
    this.sujetoOtro.set(true);
    this.sujetoActual.set('');
  }

  /** S4 — "Sí, trabajé en otro bloque": limpia el sujeto y vuelve a elegirlo. */
  otroBloque(): void {
    this.sujetoActual.set('');
    this.parteActual.set('');
    this.paso5.set('sujeto');
  }

  /** Elige/cambia la estructura actual (¿en qué parte?). Vuelve a tocarla para cerrar. */
  toggleEstructura(e: string): void {
    this.parteOtro.set(false); // AX6 — al elegir una del catálogo, sale del modo "Otros"
    this.parteActual.update((cur) => (cur === e ? '' : e));
  }

  /** AX6 — "Otros": habilita el texto libre obligatorio y limpia la selección. */
  elegirOtraParte(): void {
    this.parteOtro.set(true);
    this.parteActual.set('');
  }

  /** AZ6 — "Otros" en actividades: revela el texto libre (arrastra lo ya buscado). */
  elegirActividadOtra(): void {
    const q = this.filtroActividad().trim();
    if (q) this.actividadOtroTexto.set(q);
    this.actividadOtro.set(true);
  }

  /**
   * AZ6 — agrega una actividad "Otros" (texto libre) como renglón del sujeto +
   * parte actual, igual que una del catálogo. `texto` opcional viene del atajo
   * del estado vacío del buscador ("Agregar como Otros: '<texto>'").
   */
  agregarActividadOtro(texto?: string): void {
    const actividad = (texto ?? this.actividadOtroTexto()).trim();
    const parte = this.parteActual().trim();
    const sujeto = this.sujetoActual();
    if (!parte) {
      this.toast.error('Primero elige en qué parte se trabajó (arriba).');
      return;
    }
    if (!actividad) {
      this.toast.error('Escribe qué se hizo (especifica el "Otros").');
      return;
    }
    const yaEsta = this.actividades().some(
      (x) => (x.bloque ?? '') === sujeto && x.estructura === parte
        && x.actividad.toLowerCase() === actividad.toLowerCase(),
    );
    if (yaEsta) {
      this.toast.show('Esa actividad ya está agregada.', 'info');
    } else {
      const unidad = this.partidaDe(parte)?.unidad ?? null;
      // AI15 — lo recién agregado va al PRINCIPIO (marca la cantidad sin scroll).
      this.actividades.update((list) => [
        { estructura: parte, actividad, cantidad: 1, unidad, bloque: sujeto, es_aproximada: false },
        ...list,
      ]);
    }
    // Sal del modo "Otros" y limpia el buscador para volver a la lista normal.
    this.actividadOtroTexto.set('');
    this.actividadOtro.set(false);
    this.filtroActividad.set('');
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
    const parte = this.parteActual().trim();
    const sujeto = this.sujetoActual();
    if (!parte) {
      // AX6 — "Otros" sin texto: exige especificar qué se trabajó.
      this.toast.error(
        this.parteOtro() ? 'Escribe qué se trabajó (especifica el "Otros").' : 'Primero elige en qué parte se trabajó (arriba).',
      );
      return;
    }
    this.actividades.update((list) => {
      const idx = list.findIndex(
        (x) => (x.bloque ?? '') === sujeto && x.estructura === parte && x.actividad === a,
      );
      if (idx >= 0) return list.filter((_, i) => i !== idx); // toca de nuevo = quitar
      const unidad = this.partidaDe(parte)?.unidad ?? null;
      // AW1 — ítems difíciles de medir (varillas, encofrado…): arrancan como
      // cantidad APROXIMADA (el ingeniero puede poner un número o dejar "se trabajó").
      const aprox = this.permiteSinCantidad(a);
      // AI15 — lo recién seleccionado va al PRINCIPIO (el usuario marca la cantidad
      // sin scrollear); mismo criterio que AF12 en ferretería.
      return [{ estructura: parte, actividad: a, cantidad: aprox ? null : 1, unidad, bloque: sujeto, es_aproximada: aprox }, ...list];
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
      // Z21 — al quitar la restricción, suelta su foto opcional.
      this.restriccionFotos.update((m) => {
        const next = { ...m };
        if (next[r]) URL.revokeObjectURL(next[r].previewUrl);
        delete next[r];
        return next;
      });
      // AA9 — y su nota de voz opcional.
      this.restriccionVoces.update((m) => {
        const next = { ...m };
        for (const n of next[r] ?? []) URL.revokeObjectURL(n.url);
        delete next[r];
        return next;
      });
    }
  }

  // Z21 — foto opcional por restricción (paso 6).
  getRestriccionFoto(r: string): CapturedPhoto | null {
    return this.restriccionFotos()[r] ?? null;
  }
  onRestriccionFoto(r: string, photo: CapturedPhoto): void {
    this.restriccionFotos.update((m) => ({ ...m, [r]: photo }));
  }
  onRestriccionFotoCleared(r: string): void {
    this.restriccionFotos.update((m) => {
      const next = { ...m };
      if (next[r]) URL.revokeObjectURL(next[r].previewUrl);
      delete next[r];
      return next;
    });
  }

  // AA9 — nota de voz opcional por restricción (paso 6). `[(notes)]` de VoiceNotes.
  getRestriccionVoces(r: string): VoiceNoteItem[] {
    return this.restriccionVoces()[r] ?? [];
  }
  setRestriccionVoces(r: string, notes: VoiceNoteItem[]): void {
    this.restriccionVoces.update((m) => ({ ...m, [r]: notes }));
  }

  // Z22/AA10 — fotos (VARIAS) por equipo dañado (paso 8c). Se llavea por nombre de
  // equipo (estable frente a la recreación del objeto fila en toggle/detalle).
  getEquipoDanoFotos(nombre: string): CapturedPhoto[] {
    return this.equipoDanoFotos()[nombre.trim()] ?? [];
  }
  addEquipoDanoFoto(nombre: string, photo: CapturedPhoto): void {
    const k = nombre.trim();
    this.equipoDanoFotos.update((m) => ({ ...m, [k]: [...(m[k] ?? []), photo] }));
  }
  removeEquipoDanoFoto(nombre: string, index: number): void {
    const k = nombre.trim();
    this.equipoDanoFotos.update((m) => {
      const list = m[k] ?? [];
      const it = list[index];
      if (it) URL.revokeObjectURL(it.previewUrl);
      return { ...m, [k]: list.filter((_, i) => i !== index) };
    });
  }
  /** Suelta TODAS las fotos de un equipo (al desmarcarlo como dañado). */
  onEquipoDanoFotoCleared(nombre: string): void {
    this.equipoDanoFotos.update((m) => {
      const next = { ...m };
      const k = nombre.trim();
      for (const p of next[k] ?? []) URL.revokeObjectURL(p.previewUrl);
      delete next[k];
      return next;
    });
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

  // Z22 — el campo "Equipo" es un selector de los equipos de la obra + "Otro"
  // (texto libre). Si la obra no tiene equipos registrados, el template cae al
  // input libre (sin fricción). '__otro__' es el centinela de la opción "Otro".
  equipoSelectValue(row: EquipoRow): string {
    if (row.otro) return '__otro__';
    if (row.equipo && this.equiposSugeridos().includes(row.equipo)) return row.equipo;
    return row.equipo ? '__otro__' : '';
  }

  esEquipoOtro(row: EquipoRow): boolean {
    return !!row.otro || (!!row.equipo && !this.equiposSugeridos().includes(row.equipo));
  }

  onEquipoSelect(row: EquipoRow, value: string): void {
    this.equiposAlquilados.update((l) =>
      l.map((e) =>
        e === row
          ? value === '__otro__'
            ? { ...e, otro: true, equipo: '' }
            : { ...e, otro: false, equipo: value }
          : e,
      ),
    );
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
      // Z22/AA10 — al descartar los dañados, suelta todas sus fotos opcionales.
      const m = this.equipoDanoFotos();
      for (const k of Object.keys(m)) for (const p of m[k]) URL.revokeObjectURL(p.previewUrl);
      this.equipoDanoFotos.set({});
      this.equiposAlquilados.update((l) =>
        l
          .filter((e) => !(e.soloRetiroDano && e.danado && !e.para_retirar))
          .map((e) => ({ ...e, danado: false, dano_detalle: '' })),
      );
    }
  }

  toggleDanado(row: EquipoRow): void {
    // Z22 — al desmarcar un equipo como dañado, suelta su foto opcional.
    if (row.danado) this.onEquipoDanoFotoCleared(row.equipo);
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
    if (s === this.total()) return this.submitting() ? 'Guardando…' : 'Enviar bitácora';
    if (s === 5 && !this.sinActividad()) {
      if (this.paso5() === 'sujeto') return 'Continuar';
      if (this.paso5() === 'otro') return 'No, eso es todo';
    }
    return 'Siguiente';
  });

  backLabel = computed(() => (this.step() > 1 || this.paso5() !== 'sujeto' ? 'Atrás' : 'Cancelar'));

  primaryDisabled = computed(() => this.step() >= this.total() && this.submitting());

  /** Z4 — alternar "No se trabajó en obra" (solo desde la pantalla de obra). */
  toggleSinActividad(): void {
    this.sinActividad.update((v) => !v);
    if (this.sinActividad()) this.step.set(1);
  }

  onPrimary(): void {
    if (this.step() >= this.total()) {
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
      // Z4 — el flujo "no se trabajó" no necesita catálogos/partidas/equipos.
      if (!this.sinActividad()) {
        void this.loadPartidas(this.proyectoId());
        void this.loadCatalogo(this.proyectoId());
        void this.loadEquiposObra(this.proyectoId());
        void this.loadEstructurasObra(this.proyectoId()); // Z20
      }
      void this.loadTareasCronograma(this.proyectoId()); // Y15.8 (aplica también a "no se trabajó")
      this.prefillIngeniero(); // AA11 — default = encargado de la obra
      void this.loadIngenierosObra(this.proyectoId()); // AV3 — picker de ingenieros
    }
    // Z4 — flujo corto "no se trabajó": obra → motivo → resumen.
    if (this.sinActividad()) {
      if (s === 2) {
        if (!this.motivoSinActividad()) {
          this.toast.error('Elige el motivo de por qué no se trabajó.');
          return;
        }
        if (this.motivoSinActividad() === 'otro' && !this.motivoDetalle().trim()) {
          this.toast.error('Describe el motivo.');
          return;
        }
      }
      this.step.set(Math.min(this.total(), s + 1));
      return;
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
    // AA11 — el ingeniero responsable es OBLIGATORIO para pasar del paso 9.
    if (s === 9 && !this.ingenieroResponsable().trim()) {
      this.toast.error('Escribe el ingeniero responsable.');
      return;
    }

    const nextStep = Math.min(this.total(), s + 1);
    if (nextStep === 5) this.paso5.set('sujeto');
    if (nextStep === 8) this.paso8.set('uso');
    this.step.set(nextStep);
  }

  /** AA11 — precarga el ingeniero con el encargado de la obra (si el campo está
   *  vacío); el usuario puede cambiarlo. Offline-safe (usa el nombre cacheado del
   *  proyecto, que es el ingeniero PRINCIPAL espejado en responsable_nombre). */
  private prefillIngeniero(): void {
    if (this.ingenieroResponsable().trim()) return;
    const p = this.proyectos().find((x) => x.id === this.proyectoId());
    const enc = p?.responsable_nombre?.trim();
    if (enc) this.ingenieroResponsable.set(enc);
  }

  /**
   * AV3 — carga los ingenieros responsables de la obra (N:M) para el picker del
   * paso 9. Best-effort/online (offline queda el input libre + el prefill). Si el
   * campo está vacío —o `forceDefault` y el nombre actual no pertenece a la obra
   * nueva— por defecto el ingeniero PRINCIPAL (es_principal), como la web.
   */
  private async loadIngenierosObra(proyectoId: string, forceDefault = false): Promise<void> {
    if (!proyectoId) {
      this.ingenierosObra.set([]);
      return;
    }
    try {
      const eng = (await this.proyectosSvc.responsablesDeProyecto(proyectoId)).filter((e) => e.activo);
      this.ingenierosObra.set(eng);
      const actual = this.ingenieroResponsable().trim();
      const enLista = eng.some((e) => e.nombre.trim() === actual);
      if (!actual || (forceDefault && !enLista)) {
        const principal = eng.find((e) => e.es_principal) ?? eng[0];
        if (principal?.nombre) this.ingenieroResponsable.set(principal.nombre);
      }
    } catch {
      /* offline / error → se conserva el input libre y el prefill del encargado */
    }
  }

  /** AV3 — elige un ingeniero de la obra desde los chips del paso 9. */
  elegirIngeniero(nombre: string): void {
    this.ingenieroResponsable.set(nombre);
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
    // Z4 — el parte "sin actividad" no exige fotos (espejo del RPC).
    if (!this.sinActividad() && this.fotos().length < MIN_FOTOS) {
      this.toast.error(`Agrega al menos ${MIN_FOTOS} fotos de la obra.`);
      this.step.set(7);
      return;
    }
    this.submitting.set(true);
    try {
      // Z5 — obreros migrados por CANTIDAD (stepper). La web lee migracion_obreros
      // como arreglo y cuenta su longitud, así que enviamos N entradas.
      const nObreros = this.huboMigracion() ? this.migracionObrerosCount() : 0;
      const obreros =
        nObreros > 0 ? Array.from({ length: nObreros }, (_, i) => `Obrero ${i + 1}`) : null;
      const sinAct = this.sinActividad();
      const bitacoraId = await this.bitacora.enqueueParteDiario({
        proyectoId: this.proyectoId(),
        personalCarpinteria: sinAct ? 0 : this.carpinteria(),
        personalAcero: sinAct ? 0 : this.acero(),
        trabajadoresCasa: sinAct ? 0 : this.casa(),
        otroPersonal: sinAct ? null : this.otroPersonal().trim() || null,
        bloqueEntrepiso: null, // S3 — el bloque ahora va por actividad
        ingenieroResponsable: sinAct ? null : this.ingenieroResponsable().trim() || null,
        horaFinTrabajo: sinAct ? null : this.horaFinTrabajo() || null,
        actividades: sinAct ? [] : this.actividades(),
        restricciones: sinAct
          ? []
          : (this.restricciones().length ? this.restricciones() : ['NINGUNA']).map((r) => ({
              tipo_restriccion: r,
              descripcion_otro: r === 'NINGUNA' ? null : this.getRestriccionDesc(r).trim() || null,
              foto: r === 'NINGUNA' ? null : (this.restriccionFotos()[r]?.blob ?? null), // Z21
              voz: r === 'NINGUNA' ? null : (this.restriccionVoces()[r]?.[0]?.blob ?? null), // AA9
            })),
        comentarios: this.comentarios().trim() || null,
        fotos: this.fotos().map((f) => f.blob),
        voces: this.voces().map((n) => n.blob),
        llovio: sinAct ? null : this.llovio(),
        lluviaDetalle: !sinAct && this.llovio() ? this.lluviaDetalle().trim() || null : null,
        horasLluvia: !sinAct && this.llovio() && this.horasLluvia() > 0 ? this.horasLluvia() : null,
        huboMigracion: sinAct ? null : this.huboMigracion(),
        migracionObreros: sinAct ? null : obreros,
        // Z4 — "no se trabajó en obra".
        sinActividad: sinAct,
        motivoSinActividad: sinAct ? this.motivoSinActividad() : null,
        motivoSinActividadDetalle:
          sinAct && this.motivoSinActividad() === 'otro' ? this.motivoDetalle().trim() || null : null,
        huboEquipos: sinAct ? false : this.huboEquipos(),
        equiposAlquilados: this.equiposAlquilados()
          .filter((e) => e.equipo.trim())
          .map((e) => ({
            equipo: e.equipo.trim(),
            uso: e.uso?.trim() || null,
            proveedor: e.proveedor?.trim() || null,
            para_retirar: !!e.para_retirar,
            danado: !!e.danado,
            dano_detalle: e.danado ? (e.dano_detalle ?? '').trim() || null : null,
            // Z22/AA10 — fotos (varias) solo para equipos dañados.
            fotos: e.danado ? (this.equipoDanoFotos()[e.equipo.trim()] ?? []).map((p) => p.blob) : [],
          })),
      });
      // Y15.8 — vincular a la tarea del cronograma (op aparte, espera a que la
      // bitácora se sincronice). Best-effort: nunca bloquea el guardado del parte.
      const tareaId = this.tareaVinculada();
      if (tareaId) {
        const completar = this.completarTarea() && this.fotos().length > 0;
        try {
          await this.cronograma.enqueueEnlazar({
            tareaId,
            bitacoraId,
            proyectoId: this.proyectoId(),
            completar,
            fotoEvidencia: completar ? this.fotos()[0].blob : null,
          });
        } catch {
          /* el vínculo no debe tumbar el parte ya encolado */
        }
      }
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
  /** Z22 — el usuario eligió "Otro" en el selector de equipo (texto libre). */
  otro?: boolean;
}

/** Forma persistida del borrador del parte (S5). */
interface ParteDraft {
  proyectoId: string;
  llovio: boolean | null;
  lluviaDetalle: string;
  horasLluvia?: number; // Z5
  huboMigracion: boolean | null;
  migracionObreros: string;
  migracionObrerosCount?: number; // Z5
  sinActividad?: boolean; // Z4
  motivoSinActividad?: string | null; // Z4
  motivoDetalle?: string; // Z4
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
  tareaVinculada?: string | null; // Y15.8
  completarTarea?: boolean; // Y15.8
  step: number;
}
