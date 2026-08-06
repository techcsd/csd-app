import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { WizardExit } from '../../../shared/ui/wizard-exit/wizard-exit';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { ObraService } from '../../../core/services/obra.service';
import { ChecklistPlantilla, ChecklistItem, ChecklistRespuesta } from '../../../core/models/obra.model';

const MAX_FOTOS = 3;
type Cumple = 'si' | 'no' | 'na';

/** AG16 FASE 3 — Ejecutar checklist de calidad por actividad (hallazgo → NC). */
@Component({
  selector: 'app-obra-checklists',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PhotoSlot, OptionButton, WizardExit, BigConfirm, ConfirmDialog, Skeleton],
  templateUrl: './checklists.html',
  styleUrl: './checklists.scss',
})
export class ChecklistsPage implements OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private obra = inject(ObraService);
  private navGuard = inject(NavGuardService);
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);
  protected network = inject(NetworkService);
  private toast = inject(ToastService);
  private location = inject(Location);

  readonly slots = Array.from({ length: MAX_FOTOS }, (_, i) => i);

  proyectoId = '';
  loading = signal(true);
  plantillas = signal<ChecklistPlantilla[]>([]);
  plantillaSel = signal<ChecklistPlantilla | null>(null);
  items = signal<ChecklistItem[]>([]);

  respuestas = signal<Record<number, { cumple: Cumple; comentario: string }>>({});
  observaciones = signal('');
  fotos = signal<Record<number, CapturedPhoto>>({});

  submitting = signal(false);
  done = signal(false);
  hallazgos = signal(0);
  confirmSalir = signal(false);
  private hydrated = false;

  /** Todos los ítems respondidos (sí/no/na). */
  completo = computed(() => this.items().length > 0 && this.items().every((_, i) => !!this.respuestas()[i]));

  private get clave(): string {
    return `obra_checklist:${this.proyectoId}:${this.plantillaSel()?.id ?? ''}`;
  }

  private readonly backHandler = (): boolean => {
    if (this.plantillaSel() && !this.done()) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  constructor() {
    this.proyectoId = this.route.snapshot.paramMap.get('proyectoId') ?? '';
    void this.cargar();
    this.navGuard.register(this.backHandler);
    effect(() => {
      const snap = { respuestas: this.respuestas(), observaciones: this.observaciones() };
      if (!this.hydrated || !this.plantillaSel() || this.submitting() || this.done()) return;
      this.autosave.queue(this.clave, snap, { tipo: 'obra_checklist', etiqueta: 'Checklist de calidad', ruta: this.location.path() });
    });
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    try {
      this.plantillas.set(await this.obra.checklistPlantillas());
    } finally {
      this.loading.set(false);
    }
  }

  async elegir(p: ChecklistPlantilla): Promise<void> {
    this.plantillaSel.set(p);
    this.items.set(await this.obra.checklistItems(p.id));
    await this.restoreDraft();
  }

  private async restoreDraft(): Promise<void> {
    this.hydrated = false;
    const d = await this.borrador.load<{ respuestas: Record<number, { cumple: Cumple; comentario: string }>; observaciones: string }>(this.clave);
    if (d) {
      this.respuestas.set(d.respuestas ?? {});
      this.observaciones.set(d.observaciones ?? '');
      const fotos = await this.borrador.loadFotos(this.clave);
      const map: Record<number, CapturedPhoto> = {};
      for (const f of fotos) {
        const idx = Number(f.slot);
        if (Number.isFinite(idx)) map[idx] = { blob: f.blob, previewUrl: URL.createObjectURL(f.blob) };
      }
      this.fotos.set(map);
    } else {
      this.respuestas.set({});
      this.observaciones.set('');
      this.fotos.set({});
    }
    this.hydrated = true;
  }

  setCumple(i: number, c: Cumple): void {
    this.respuestas.update((r) => ({ ...r, [i]: { cumple: c, comentario: r[i]?.comentario ?? '' } }));
  }
  setComentario(i: number, v: string): void {
    this.respuestas.update((r) => ({ ...r, [i]: { cumple: r[i]?.cumple ?? 'na', comentario: v } }));
  }
  cumpleDe(i: number): Cumple | null {
    return this.respuestas()[i]?.cumple ?? null;
  }

  onFoto(idx: number, photo: CapturedPhoto): void {
    this.fotos.update((f) => ({ ...f, [idx]: photo }));
    void this.borrador.saveFoto(this.clave, String(idx), photo.blob);
  }
  onFotoCleared(idx: number): void {
    this.fotos.update((f) => {
      const next = { ...f };
      delete next[idx];
      return next;
    });
    void this.borrador.removeFoto(this.clave, String(idx));
  }

  volverLista(): void {
    this.confirmSalir.set(false);
    this.plantillaSel.set(null);
  }
  pedirSalir(): void {
    if (this.plantillaSel() && !this.done()) this.confirmSalir.set(true);
    else this.back();
  }
  cancelarSalir(): void {
    this.confirmSalir.set(false);
  }

  async guardar(): Promise<void> {
    if (this.submitting() || !this.completo()) return;
    this.submitting.set(true);
    try {
      const items = this.items();
      const respuestas: ChecklistRespuesta[] = items.map((it, i) => {
        const c = this.respuestas()[i]?.cumple ?? 'na';
        return {
          etiqueta: it.etiqueta,
          seccion: it.seccion,
          cumple: c === 'si' ? true : c === 'no' ? false : null,
          comentario: this.respuestas()[i]?.comentario?.trim() || null,
          orden: it.orden,
        };
      });
      const noCumple = respuestas.filter((r) => r.cumple === false).length;
      const fotosMap = this.fotos();
      const fotos = this.slots.map((i) => fotosMap[i]?.blob).filter((b): b is Blob => !!b);
      await this.obra.enqueueChecklist({
        plantillaId: this.plantillaSel()!.id,
        proyectoId: this.proyectoId,
        respuestas,
        observaciones: this.observaciones().trim() || null,
        fotos,
      });
      await this.autosave.discard(this.clave);
      this.hallazgos.set(noCumple);
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar el checklist.');
    } finally {
      this.submitting.set(false);
    }
  }

  levantarNc(): void {
    void this.router.navigate(['/obra/nc', this.proyectoId]);
  }
  cerrar(): void {
    void this.router.navigate(['/obra']);
  }
  back(): void {
    void this.router.navigate(['/obra']);
  }
}
