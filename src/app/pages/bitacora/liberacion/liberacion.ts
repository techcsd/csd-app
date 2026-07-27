import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { WizardExit } from '../../../shared/ui/wizard-exit/wizard-exit';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { SelectList, SelectOption } from '../../../shared/ui/select-list/select-list';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { resetScrollOnStep } from '../../../shared/util/scroll';
import { CameraService, CapturedPhoto } from '../../../core/services/camera.service';
import { ClLiberacionService } from '../../../core/services/cl-liberacion.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { BorradorService } from '../../../core/services/borrador.service';
import {
  ClFirmaCaptura,
  ClFirmaRol,
  ClFotoCaptura,
  ClPlantilla,
  ClPlantillaItem,
  ClProyecto,
  ClResponsable,
  CL_FIRMA_ROLES,
  CL_ROLES_LIBERAN,
} from '../../../core/models/cl-liberacion.model';

interface ItemDraft {
  cumple: boolean | null;
  comentario: string;
}

interface SeccionGrupo {
  seccion: string;
  items: ClPlantillaItem[];
}

/** Z1 — borrador persistido del checklist (sin medios: fotos/firmas se recapturan). */
interface ClDraft {
  proyectoId: string;
  plantillaId: string;
  respuestas: Record<string, ItemDraft>;
  bloque: string;
  eje: string;
  observacion: string;
  step: number;
  seccionIdx: number;
}

const TOTAL_STEPS = 5;

/**
 * CSD-OPE-01 §6.8/§9 — Checklist de Liberación (CL-01..07) de campo.
 * Elige obra + tipo de CL, verifica cada punto (Sí/No + comentario), mapea el
 * plano y fotos (correcto/incorrecto) y captura el ciclo de firmas. Se guarda
 * offline por el outbox (registrar_cl_app). La liberación del vaciado se habilita
 * cuando firman Residente + Responsable + Cliente.
 */
@Component({
  selector: 'app-liberacion',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, StepBar, PhotoSlot, OptionButton, SignaturePad, SelectList, ConfirmDialog, Skeleton, WizardFooter, WizardExit],
  templateUrl: './liberacion.html',
  styleUrl: './liberacion.scss',
})
export class LiberacionPage implements OnDestroy {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private service = inject(ClLiberacionService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private navGuard = inject(NavGuardService);
  private camera = inject(CameraService);
  private borrador = inject(BorradorService);

  private sig = viewChild(SignaturePad);

  readonly total = TOTAL_STEPS;
  readonly roles = CL_FIRMA_ROLES;

  step = signal(1);
  // Z1 — el checklist (paso 2) se recorre UNA SECCIÓN POR PANTALLA (patrón hoja).
  seccionIdx = signal(0);
  loading = signal(true);

  // Z1 — borrador recuperable (aparece en "Documentación en proceso").
  private draftKey = '';
  private hydrated = false;

  proyectos = signal<ClProyecto[]>([]);
  plantillas = signal<ClPlantilla[]>([]);
  proyectoId = signal('');
  plantillaId = signal('');

  respuestas = signal<Record<string, ItemDraft>>({});
  bloque = signal('');
  eje = signal('');
  observacion = signal('');

  // Plano
  plano = signal<CapturedPhoto | null>(null);

  // Fotos (correcto/incorrecto) — se agregan de a una. Q4: cámara directa + grid.
  fotoActual = signal<CapturedPhoto | null>(null);
  fotoCorrecto = signal(true);
  fotoDesc = signal('');
  fotos = signal<ClFotoCaptura[]>([]);
  capturando = signal(false);

  // Firmas — ciclo del procedimiento, se agregan de a una
  firmaRol = signal<ClFirmaRol | null>(null);
  firmaNombre = signal('');
  firmaLista = signal(false);
  firmas = signal<ClFirmaCaptura[]>([]);
  // Q5 — firma del cliente por FOTO (alternativa al trazo).
  firmaFoto = signal<CapturedPhoto | null>(null);
  // Z2/Z3 — responsables/residentes del proyecto (usuarios reales) para preseleccionar.
  responsables = signal<ClResponsable[]>([]);
  firmaUsuarioId = signal<string | null>(null);
  firmaSustituyeA = signal<ClResponsable | null>(null);

  submitting = signal(false);
  done = signal(false);
  confirmSalir = signal(false);
  // Q5 — solicitar firma (aviso a los ingenieros) tras guardar.
  private clId = signal('');
  solicitando = signal(false);
  solicitado = signal(false);

  private readonly backHandler = (): boolean => {
    if (this.tieneDatos()) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  proyectoOpciones = computed<SelectOption[]>(() =>
    this.proyectos().map((p) => ({ id: p.id, label: p.nombre })),
  );
  plantillaOpciones = computed<SelectOption[]>(() =>
    this.plantillas().map((p) => ({ id: p.id, label: `${p.codigo} — ${p.nombre}` })),
  );

  proyectoSel = computed(() => this.proyectos().find((p) => p.id === this.proyectoId()) ?? null);
  plantillaSel = computed<ClPlantilla | null>(
    () => this.plantillas().find((p) => p.id === this.plantillaId()) ?? null,
  );

  grupos = computed<SeccionGrupo[]>(() => {
    const items = this.plantillaSel()?.items ?? [];
    const grupos: SeccionGrupo[] = [];
    for (const it of items) {
      const key = it.seccion || 'General';
      let g = grupos.find((x) => x.seccion === key);
      if (!g) {
        g = { seccion: key, items: [] };
        grupos.push(g);
      }
      g.items.push(it);
    }
    return grupos;
  });

  totalItems = computed(() => this.plantillaSel()?.items.length ?? 0);
  respondidos = computed(
    () => Object.values(this.respuestas()).filter((r) => r.cumple !== null).length,
  );

  // Z1 — sección visible del checklist (una por pantalla).
  totalSecciones = computed(() => this.grupos().length);
  seccionActual = computed<SeccionGrupo | null>(() => this.grupos()[this.seccionIdx()] ?? null);
  private seccionRespondida(g: SeccionGrupo | null): boolean {
    if (!g) return true;
    return g.items.every((it) => this.draft(it.id).cumple !== null);
  }

  // Z3 — la liberación exige RESIDENTE **o** RESPONSABLE (una de las dos basta).
  faltanObligatorias = computed(() => {
    const puestas = new Set(this.firmas().map((f) => f.rol));
    const liberado = CL_ROLES_LIBERAN.some((r) => puestas.has(r));
    return liberado ? [] : ['Ing. Residente o Ing. Responsable'];
  });

  // Z2 — responsables del proyecto para el rol que se está firmando ahora.
  responsablesDelRol = computed<ClResponsable[]>(() => {
    const rol = this.firmaRol();
    if (rol !== 'residente' && rol !== 'responsable') return [];
    return this.responsables().filter((r) => r.tipo_responsabilidad === rol);
  });
  // Z3 — a quién se puede sustituir (cualquier responsable/residente ligado).
  sustituibles = computed<ClResponsable[]>(() => this.responsables());

  // Q5 — checklist visual: cada rol con su estado (verde si firmó, gris si no).
  firmaEstados = computed(() => {
    const puestas = new Set(this.firmas().map((f) => f.rol));
    return CL_FIRMA_ROLES.map((r) => ({ ...r, firmada: puestas.has(r.value) }));
  });

  constructor() {
    // Z1 — resetear scroll en cada paso y en cada sección del checklist (hoja).
    resetScrollOnStep(() => this.step(), () => this.seccionIdx(), () => this.done());
    void this.load();
    this.navGuard.register(this.backHandler); // U4 — botón físico Android
    // Z1 — autosave del borrador (sin fotos/firmas) para recuperar tras un cierre.
    effect(() => {
      const snap = {
        proyectoId: this.proyectoId(),
        plantillaId: this.plantillaId(),
        respuestas: this.respuestas(),
        bloque: this.bloque(),
        eje: this.eje(),
        observacion: this.observacion(),
        step: this.step(),
        seccionIdx: this.seccionIdx(),
      };
      if (!this.hydrated || this.done()) return;
      if (!this.hasContent()) return;
      void this.borrador.save(this.draftKey, snap, {
        tipo: 'cl_liberacion',
        etiqueta: 'Checklist de liberación' + (this.proyectoSel()?.nombre ? ' · ' + this.proyectoSel()!.nombre : ''),
        ruta: '/bitacora/liberacion',
      });
    });
  }

  /** ¿Hay algo que valga la pena guardar como borrador? */
  private hasContent(): boolean {
    return (
      this.step() > 1 ||
      !!this.proyectoId() ||
      !!this.plantillaId() ||
      this.respondidos() > 0 ||
      !!this.bloque() ||
      !!this.eje() ||
      !!this.observacion()
    );
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
    // Q4/P10 — liberar object-URLs (el padre es dueño con [foto]).
    for (const f of this.fotos()) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    const act = this.fotoActual();
    if (act) URL.revokeObjectURL(act.previewUrl);
    const pl = this.plano();
    if (pl) URL.revokeObjectURL(pl.previewUrl);
  }

  /** ¿Hay algo capturado que se perdería al salir? */
  private tieneDatos(): boolean {
    return (
      this.done() === false &&
      (!!this.proyectoId() ||
        !!this.plantillaId() ||
        this.respondidos() > 0 ||
        this.fotos().length > 0 ||
        this.firmas().length > 0 ||
        !!this.plano())
    );
  }

  /** Salir con confirmación si hay datos (no callejón sin salida — APP-004/005). */
  intentarSalir(): void {
    if (this.tieneDatos()) this.confirmSalir.set(true);
    else this.back();
  }
  confirmarSalir(): void {
    this.confirmSalir.set(false);
    this.back();
  }
  cancelarSalir(): void {
    this.confirmSalir.set(false);
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [proyectos, plantillas] = await Promise.all([
        this.service.getProyectos(),
        this.service.getPlantillas(),
      ]);
      this.proyectos.set(proyectos);
      this.plantillas.set(plantillas);

      // Z1 — retomar un borrador (?borrador=) o empezar uno nuevo.
      const claveParam = this.route.snapshot.queryParamMap.get('borrador');
      const draft = claveParam ? await this.borrador.load<ClDraft>(claveParam) : null;
      this.draftKey = draft && claveParam ? claveParam : `cl_liberacion:${crypto.randomUUID()}`;
      if (draft) {
        this.proyectoId.set(draft.proyectoId ?? '');
        this.plantillaId.set(draft.plantillaId ?? '');
        // Las respuestas se re-mapean por item.id (mismo catálogo de la plantilla).
        this.respuestas.set(draft.respuestas ?? {});
        this.bloque.set(draft.bloque ?? '');
        this.eje.set(draft.eje ?? '');
        this.observacion.set(draft.observacion ?? '');
        this.seccionIdx.set(draft.seccionIdx ?? 0);
        this.step.set(draft.step ?? 1);
        // Z2 — al retomar, recargar los responsables del proyecto para la preselección.
        if (draft.proyectoId) {
          void this.service.getResponsables(draft.proyectoId).then((r) => this.responsables.set(r)).catch(() => {});
        }
        this.toast.show('Recuperamos tu checklist a medio llenar. Las fotos y firmas hay que capturarlas de nuevo.', 'info', 4500);
      }
    } catch {
      this.toast.error('No se pudieron cargar obras/checklists.');
    } finally {
      this.loading.set(false);
      this.hydrated = true; // a partir de aquí el autosave puede correr
    }
  }

  pickProyecto(id: string): void {
    this.proyectoId.set(id);
    // Z2 — precargar los responsables/residentes del proyecto (best-effort, online;
    // cacheado para offline). Alimenta la preselección de firmantes del paso 4.
    if (id) {
      void this.service
        .getResponsables(id)
        .then((r) => this.responsables.set(r))
        .catch(() => this.responsables.set([]));
    } else {
      this.responsables.set([]);
    }
  }

  pickPlantilla(id: string): void {
    this.plantillaId.set(id);
    this.seccionIdx.set(0);
    const drafts: Record<string, ItemDraft> = {};
    for (const it of this.plantillaSel()?.items ?? []) {
      drafts[it.id] = { cumple: null, comentario: '' };
    }
    this.respuestas.set(drafts);
  }

  draft(itemId: string): ItemDraft {
    return this.respuestas()[itemId] ?? { cumple: null, comentario: '' };
  }

  setCumple(itemId: string, cumple: boolean): void {
    this.respuestas.update((r) => ({ ...r, [itemId]: { ...this.draft(itemId), cumple } }));
  }
  setComentario(itemId: string, comentario: string): void {
    this.respuestas.update((r) => ({ ...r, [itemId]: { ...this.draft(itemId), comentario } }));
  }

  // ── Plano / fotos ──────────────────────────────────────────
  onPlano(photo: CapturedPhoto): void {
    this.plano.set(photo);
  }
  onPlanoCleared(): void {
    this.plano.set(null);
  }

  /** Q4 — tomar/repetir la foto en curso (cámara directa, sin PhotoSlot). */
  async tomarFoto(): Promise<void> {
    if (this.capturando()) return;
    this.capturando.set(true);
    try {
      const photo = await this.camera.takePhoto();
      if (photo) {
        // Si estábamos repitiendo, liberar la URL de la foto en curso anterior.
        const prev = this.fotoActual();
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        this.fotoActual.set(photo);
      }
    } finally {
      this.capturando.set(false);
    }
  }

  /** Q4 — agrega la foto en curso al grid (con su correcto/descripción) y deja
   *  todo listo para tomar OTRA. Conserva la previewUrl para la miniatura. */
  agregarFoto(): void {
    const p = this.fotoActual();
    if (!p) {
      this.toast.error('Toma la foto primero.');
      return;
    }
    this.fotos.update((list) => [
      ...list,
      { blob: p.blob, correcto: this.fotoCorrecto(), descripcion: this.fotoDesc().trim() || null, previewUrl: p.previewUrl },
    ]);
    this.fotoActual.set(null); // no revocar: la URL vive ahora en el item del grid
    this.fotoDesc.set('');
    this.fotoCorrecto.set(true);
  }

  /** Q4 — descartar la foto en curso sin agregarla. */
  descartarFotoActual(): void {
    const p = this.fotoActual();
    if (p) URL.revokeObjectURL(p.previewUrl);
    this.fotoActual.set(null);
  }

  quitarFoto(idx: number): void {
    const f = this.fotos()[idx];
    if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl);
    this.fotos.update((list) => list.filter((_, i) => i !== idx));
  }

  // ── Firmas ─────────────────────────────────────────────────
  pickRol(rol: ClFirmaRol): void {
    this.firmaRol.set(rol);
    // Al cambiar de rol, reinicia el firmante ligado / sustitución.
    this.firmaUsuarioId.set(null);
    this.firmaSustituyeA.set(null);
    // Z2 — si hay UN solo responsable ligado para ese rol, preselecciónalo.
    const delRol = this.responsablesDelRol();
    if (delRol.length === 1) this.pickResponsable(delRol[0]);
  }

  /** Z2 — elegir un responsable/residente ligado: fija nombre + usuario_id. */
  pickResponsable(r: ClResponsable): void {
    this.firmaNombre.set(r.nombre);
    this.firmaUsuarioId.set(r.usuario_id);
  }

  /** Z3 — firmar EN SUSTITUCIÓN de otro responsable (o quitar la sustitución). */
  pickSustituto(r: ClResponsable | null): void {
    this.firmaSustituyeA.set(r);
  }

  /** Q5 — el cliente puede firmar subiendo una FOTO de la firma en papel. */
  async subirFirmaFoto(desdeGaleria: boolean): Promise<void> {
    const photo = desdeGaleria
      ? (await this.camera.pickFromGallery())[0] ?? null
      : await this.camera.takePhoto();
    if (photo) {
      const prev = this.firmaFoto();
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      this.firmaFoto.set(photo);
    }
  }
  quitarFirmaFoto(): void {
    const p = this.firmaFoto();
    if (p) URL.revokeObjectURL(p.previewUrl);
    this.firmaFoto.set(null);
  }

  async agregarFirma(): Promise<void> {
    const rol = this.firmaRol();
    if (!rol) {
      this.toast.error('Elige el rol que firma.');
      return;
    }
    // Q5 — el cliente puede haber subido una foto de la firma en vez de trazarla.
    const foto = this.firmaFoto();
    let blob: Blob | null | undefined;
    let metodo: 'pad' | 'foto' = 'pad';
    if (rol === 'cliente' && foto) {
      blob = foto.blob;
      metodo = 'foto';
    } else {
      blob = await this.sig()?.toBlob();
    }
    if (!blob) {
      this.toast.error(rol === 'cliente' ? 'Captura la firma o sube su foto.' : 'Captura la firma primero.');
      return;
    }
    const sust = this.firmaSustituyeA();
    this.firmas.update((list) => [
      ...list.filter((f) => f.rol !== rol),
      {
        rol,
        nombre: this.firmaNombre().trim() || null,
        blob,
        metodo,
        // Z2/Z3 — usuario ligado + firma en sustitución.
        usuarioId: this.firmaUsuarioId(),
        enSustitucionDe: sust?.usuario_id ?? null,
        enSustitucionDeNombre: sust?.nombre ?? null,
      },
    ]);
    this.firmaRol.set(null);
    this.firmaNombre.set('');
    this.firmaUsuarioId.set(null);
    this.firmaSustituyeA.set(null);
    this.firmaLista.set(false);
    this.sig()?.clear();
    this.quitarFirmaFoto();
    this.toast.success('Firma agregada.');
  }
  quitarFirma(rol: ClFirmaRol): void {
    this.firmas.update((list) => list.filter((f) => f.rol !== rol));
  }
  rolLabel(rol: string): string {
    return CL_FIRMA_ROLES.find((r) => r.value === rol)?.label ?? rol;
  }

  // ── Navegación ─────────────────────────────────────────────
  next(): void {
    if (!this.canAdvance()) return;
    // Z1 — dentro del paso 2, avanzar SECCIÓN por SECCIÓN antes de saltar al paso 3.
    if (this.step() === 2 && this.seccionIdx() < this.totalSecciones() - 1) {
      this.seccionIdx.update((i) => i + 1);
      return;
    }
    // Al entrar al paso 2, empezar en la primera sección.
    if (this.step() === 1) this.seccionIdx.set(0);
    this.step.update((s) => Math.min(this.total, s + 1));
  }
  prev(): void {
    // Z1 — dentro del paso 2, retroceder de sección en sección.
    if (this.step() === 2 && this.seccionIdx() > 0) {
      this.seccionIdx.update((i) => i - 1);
      return;
    }
    // Volver del paso 3 al paso 2 aterriza en la ÚLTIMA sección (back sano — S31).
    if (this.step() === 3) {
      this.step.set(2);
      this.seccionIdx.set(Math.max(0, this.totalSecciones() - 1));
      return;
    }
    this.step.update((s) => Math.max(1, s - 1));
  }

  canAdvance(): boolean {
    switch (this.step()) {
      case 1:
        if (!this.proyectoId()) {
          this.toast.error('Elige la obra.');
          return false;
        }
        if (!this.plantillaId()) {
          this.toast.error('Elige el tipo de checklist (CL).');
          return false;
        }
        return true;
      case 2:
        // Z1 — valida SOLO la sección visible; así se avanza hoja por hoja.
        if (!this.seccionRespondida(this.seccionActual())) {
          this.toast.error('Responde todos los puntos de esta sección.');
          return false;
        }
        return true;
      default:
        return true;
    }
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    // Q5 — se puede guardar SIN firmas (queda borrador); luego se solicitan.
    this.submitting.set(true);
    try {
      const items = (this.plantillaSel()?.items ?? []).map((it) => {
        const d = this.draft(it.id);
        return {
          etiqueta: it.etiqueta,
          seccion: it.seccion,
          cumple: d.cumple,
          comentario: d.comentario.trim() || null,
          orden: it.orden ?? 0,
        };
      });

      const clId = await this.service.enqueueCl({
        proyectoId: this.proyectoId(),
        proyecto: this.proyectoSel()?.nombre ?? '',
        plantillaId: this.plantillaId(),
        plantilla: this.plantillaSel()?.nombre ?? '',
        bloque: this.bloque().trim() || null,
        eje: this.eje().trim() || null,
        observaciones: this.observacion().trim() || null,
        items,
        plano: this.plano()?.blob ?? null,
        fotos: this.fotos(),
        firmas: this.firmas(),
      });
      this.clId.set(clId);
      this.hydrated = false; // evita que el autosave re-cree el borrador ya enviado
      await this.borrador.clear(this.draftKey);
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar. Intenta de nuevo.');
    } finally {
      this.submitting.set(false);
    }
  }

  /** Q5 — solicitar las firmas faltantes (aviso a ingenieros). Online-only. */
  async solicitarFirmaCl(): Promise<void> {
    if (this.solicitando() || this.solicitado()) return;
    if (!this.online) {
      this.toast.error('Necesitas conexión para solicitar la firma.');
      return;
    }
    this.solicitando.set(true);
    try {
      await this.service.solicitarFirma(this.clId(), this.proyectoSel()?.nombre ?? 'la obra', this.faltanObligatorias());
      this.solicitado.set(true);
      this.toast.success('Aviso enviado. Los ingenieros verán el CL pendiente de firma.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo enviar el aviso.');
    } finally {
      this.solicitando.set(false);
    }
  }

  finish(): void {
    void this.router.navigate(['/bitacora'], { replaceUrl: true });
  }
  back(): void {
    // S31 — location.back() vuelve al hub que ya está en la pila SIN duplicarlo
    // (navigate a /bitacora, aun con replaceUrl, dejaba dos entradas y "atrás"
    // se quedaba en el hub en vez de llegar a home). Mismo criterio que incidente.
    this.location.back();
  }

  get online(): boolean {
    return this.network.online();
  }
}
