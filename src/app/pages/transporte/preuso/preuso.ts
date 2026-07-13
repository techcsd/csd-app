import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { SelectList, SelectOption } from '../../../shared/ui/select-list/select-list';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { ChecklistPreusoService } from '../../../core/services/checklist-preuso.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  ChecklistPlantilla,
  ChecklistPlantillaItem,
  RESPUESTA_OPCIONES,
  RespuestaValor,
} from '../../../core/models/checklist-preuso.model';

interface RespuestaDraft {
  respuesta: RespuestaValor | null;
  comentario: string;
  photo: CapturedPhoto | null;
}

interface SeccionGrupo {
  seccion: string;
  items: ChecklistPlantillaItem[];
}

const TOTAL_STEPS = 5;

/**
 * Vehicle pre-use checklist (checklist de pre-uso vehicular). Pick a template,
 * answer OK/Falla/N-A per item, note km + observations, sign, confirm. Saved
 * offline via the outbox. Mirrors the entrega checklist wizard.
 */
@Component({
  selector: 'app-preuso',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, StepBar, PhotoSlot, OptionButton, SignaturePad, SelectList, BigConfirm],
  templateUrl: './preuso.html',
  styleUrl: './preuso.scss',
})
export class PreusoPage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private vehiculos = inject(VehiculosService);
  private checklist = inject(ChecklistPreusoService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);

  private sig = viewChild(SignaturePad);

  readonly total = TOTAL_STEPS;
  readonly opciones = RESPUESTA_OPCIONES;

  vehiculoId = '';
  placa = signal('');
  modelo = signal('');

  step = signal(1);
  plantillas = signal<ChecklistPlantilla[]>([]);
  loadingPlantillas = signal(true);
  plantillaId = signal('');
  respuestas = signal<Record<string, RespuestaDraft>>({});
  km = signal<number | null>(null);
  observacion = signal('');
  firmaLista = signal(false);
  // Capturamos la firma en cuanto se dibuja: el pad vive en un paso anterior al
  // de envío, así que al llegar al resumen ya no está montado (viewChild = null).
  firmaBlob = signal<Blob | null>(null);

  submitting = signal(false);
  done = signal(false);

  plantillaOpciones = computed<SelectOption[]>(() =>
    this.plantillas().map((p) => ({ id: p.id, label: p.nombre })),
  );

  plantillaSel = computed<ChecklistPlantilla | null>(
    () => this.plantillas().find((p) => p.id === this.plantillaId()) ?? null,
  );

  /** Items of the selected template grouped by section, preserving order. */
  grupos = computed<SeccionGrupo[]>(() => {
    const items = this.plantillaSel()?.items ?? [];
    const grupos: SeccionGrupo[] = [];
    for (const it of items) {
      let g = grupos.find((x) => x.seccion === it.seccion);
      if (!g) {
        g = { seccion: it.seccion, items: [] };
        grupos.push(g);
      }
      g.items.push(it);
    }
    return grupos;
  });

  totalItems = computed(() => this.plantillaSel()?.items.length ?? 0);
  respondidos = computed(
    () => Object.values(this.respuestas()).filter((r) => r.respuesta !== null).length,
  );

  constructor() {
    this.vehiculoId = this.route.snapshot.paramMap.get('vehiculoId') ?? '';
    void this.loadVehiculo();
    void this.loadPlantillas();
  }

  private async loadVehiculo(): Promise<void> {
    const v = await this.vehiculos.getVehiculo(this.vehiculoId);
    if (v) {
      this.placa.set(v.placa);
      this.modelo.set(`${v.marca} ${v.modelo}`);
    }
  }

  private async loadPlantillas(): Promise<void> {
    this.loadingPlantillas.set(true);
    try {
      const list = await this.checklist.getPlantillas();
      this.plantillas.set(list);
      if (list.length && !this.plantillaId()) this.pickPlantilla(list[0].id);
    } finally {
      this.loadingPlantillas.set(false);
    }
  }

  pickPlantilla(id: string): void {
    this.plantillaId.set(id);
    // Seed a blank draft for every item of the chosen template.
    const drafts: Record<string, RespuestaDraft> = {};
    for (const it of this.plantillaSel()?.items ?? []) {
      drafts[it.id] = { respuesta: null, comentario: '', photo: null };
    }
    this.respuestas.set(drafts);
  }

  draft(itemId: string): RespuestaDraft {
    return this.respuestas()[itemId] ?? { respuesta: null, comentario: '', photo: null };
  }

  setRespuesta(itemId: string, valor: RespuestaValor): void {
    this.respuestas.update((r) => ({
      ...r,
      [itemId]: { ...this.draft(itemId), respuesta: valor },
    }));
  }

  setComentario(itemId: string, comentario: string): void {
    this.respuestas.update((r) => ({
      ...r,
      [itemId]: { ...this.draft(itemId), comentario },
    }));
  }

  onItemFoto(itemId: string, photo: CapturedPhoto): void {
    this.respuestas.update((r) => ({
      ...r,
      [itemId]: { ...this.draft(itemId), photo },
    }));
  }

  onItemFotoCleared(itemId: string): void {
    this.respuestas.update((r) => ({
      ...r,
      [itemId]: { ...this.draft(itemId), photo: null },
    }));
  }

  next(): void {
    if (!this.canAdvance()) return;
    this.step.update((s) => Math.min(this.total, s + 1));
  }

  prev(): void {
    this.step.update((s) => Math.max(1, s - 1));
  }

  /** Per-step gate so the user can't skip required answers. */
  canAdvance(): boolean {
    switch (this.step()) {
      case 1:
        if (!this.plantillaId()) {
          this.toast.error('Elige un checklist.');
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
      const items = this.plantillaSel()?.items ?? [];
      const respuestas = items.map((it) => {
        const d = this.draft(it.id);
        const comentario = d.comentario.trim();
        return {
          etiqueta: it.etiqueta,
          seccion: it.seccion,
          es_critico: it.es_critico,
          respuesta: d.respuesta!,
          comentario: comentario ? comentario : null,
          orden: it.orden,
          blob: d.photo?.blob ?? null,
        };
      });

      const observacion = this.observacion().trim();

      await this.checklist.enqueueChecklist({
        vehiculoId: this.vehiculoId,
        plantillaId: this.plantillaId(),
        plantilla: this.plantillaSel()?.nombre ?? '',
        placa: this.placa(),
        fecha: new Date().toISOString().slice(0, 10),
        kilometraje: this.km(),
        observacion: observacion ? observacion : null,
        respuestas,
        firma: firmaBlob,
      });
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
