import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { SelectList, SelectOption } from '../../../shared/ui/select-list/select-list';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { ClLiberacionService } from '../../../core/services/cl-liberacion.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
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
  imports: [FormsModule, StepBar, PhotoSlot, OptionButton, SignaturePad, SelectList, BigConfirm, Skeleton],
  templateUrl: './liberacion.html',
  styleUrl: './liberacion.scss',
})
export class LiberacionPage {
  private router = inject(Router);
  private service = inject(ClLiberacionService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);

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

  // Fotos (correcto/incorrecto) — se agregan de a una
  fotoActual = signal<CapturedPhoto | null>(null);
  fotoCorrecto = signal(true);
  fotoDesc = signal('');
  fotos = signal<ClFotoCaptura[]>([]);

  // Firmas — ciclo del procedimiento, se agregan de a una
  firmaRol = signal<ClFirmaRol | null>(null);
  firmaNombre = signal('');
  firmaLista = signal(false);
  firmas = signal<ClFirmaCaptura[]>([]);

  submitting = signal(false);
  done = signal(false);

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

  constructor() {
    void this.load();
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

  onFoto(photo: CapturedPhoto): void {
    this.fotoActual.set(photo);
  }
  onFotoCleared(): void {
    this.fotoActual.set(null);
  }
  agregarFoto(): void {
    const p = this.fotoActual();
    if (!p) {
      this.toast.error('Toma la foto primero.');
      return;
    }
    this.fotos.update((list) => [
      ...list,
      { blob: p.blob, correcto: this.fotoCorrecto(), descripcion: this.fotoDesc().trim() || null },
    ]);
    this.fotoActual.set(null);
    this.fotoDesc.set('');
    this.fotoCorrecto.set(true);
  }
  quitarFoto(idx: number): void {
    this.fotos.update((list) => list.filter((_, i) => i !== idx));
  }

  // ── Firmas ─────────────────────────────────────────────────
  pickRol(rol: ClFirmaRol): void {
    this.firmaRol.set(rol);
  }

  async agregarFirma(): Promise<void> {
    const rol = this.firmaRol();
    if (!rol) {
      this.toast.error('Elige el rol que firma.');
      return;
    }
    const blob = await this.sig()?.toBlob();
    if (!blob) {
      this.toast.error('Captura la firma primero.');
      return;
    }
    this.firmas.update((list) => [
      ...list.filter((f) => f.rol !== rol),
      { rol, nombre: this.firmaNombre().trim() || null, blob },
    ]);
    this.firmaRol.set(null);
    this.firmaNombre.set('');
    this.firmaLista.set(false);
    this.sig()?.clear();
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
    if (this.firmas().length === 0) {
      this.toast.error('Agrega al menos una firma.');
      return;
    }
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

      await this.service.enqueueCl({
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
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar. Intenta de nuevo.');
    } finally {
      this.submitting.set(false);
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
