import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { WizardExit } from '../../../shared/ui/wizard-exit/wizard-exit';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { SelectList, SelectOption } from '../../../shared/ui/select-list/select-list';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { CameraService, CapturedPhoto } from '../../../core/services/camera.service';
import { ClLiberacionService } from '../../../core/services/cl-liberacion.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import {
  ClFirmaCaptura,
  ClFirmaRol,
  ClFotoCaptura,
  ClPlantilla,
  ClPlantillaItem,
  ClProyecto,
  CL_FIRMA_ROLES,
} from '../../../core/models/cl-liberacion.model';

interface ItemDraft {
  cumple: boolean | null;
  comentario: string;
}

interface SeccionGrupo {
  seccion: string;
  items: ClPlantillaItem[];
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
  imports: [FormsModule, StepBar, PhotoSlot, OptionButton, SignaturePad, SelectList, BigConfirm, ConfirmDialog, Skeleton, WizardFooter, WizardExit],
  templateUrl: './liberacion.html',
  styleUrl: './liberacion.scss',
})
export class LiberacionPage implements OnDestroy {
  private router = inject(Router);
  private service = inject(ClLiberacionService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private navGuard = inject(NavGuardService);
  private camera = inject(CameraService);

  private sig = viewChild(SignaturePad);

  readonly total = TOTAL_STEPS;
  readonly roles = CL_FIRMA_ROLES;

  step = signal(1);
  loading = signal(true);

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

  // Progreso de firmas obligatorias
  faltanObligatorias = computed(() => {
    const puestas = new Set(this.firmas().map((f) => f.rol));
    return CL_FIRMA_ROLES.filter((r) => r.obligatoria && !puestas.has(r.value)).map((r) => r.label);
  });

  // Q5 — checklist visual: cada rol con su estado (verde si firmó, gris si no).
  firmaEstados = computed(() => {
    const puestas = new Set(this.firmas().map((f) => f.rol));
    return CL_FIRMA_ROLES.map((r) => ({ ...r, firmada: puestas.has(r.value) }));
  });

  constructor() {
    void this.load();
    this.navGuard.register(this.backHandler); // U4 — botón físico Android
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
    } catch {
      this.toast.error('No se pudieron cargar obras/checklists.');
    } finally {
      this.loading.set(false);
    }
  }

  pickProyecto(id: string): void {
    this.proyectoId.set(id);
  }

  pickPlantilla(id: string): void {
    this.plantillaId.set(id);
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
    this.firmas.update((list) => [
      ...list.filter((f) => f.rol !== rol),
      { rol, nombre: this.firmaNombre().trim() || null, blob, metodo },
    ]);
    this.firmaRol.set(null);
    this.firmaNombre.set('');
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
    this.step.update((s) => Math.min(this.total, s + 1));
  }
  prev(): void {
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
        if (this.respondidos() < this.totalItems()) {
          this.toast.error('Responde todos los puntos del checklist.');
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
    void this.router.navigate(['/bitacora']);
  }

  get online(): boolean {
    return this.network.online();
  }
}
