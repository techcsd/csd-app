import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { Counter } from '../../../shared/ui/counter/counter';
import { WizardExit } from '../../../shared/ui/wizard-exit/wizard-exit';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { ObraService } from '../../../core/services/obra.service';

const MAX_FOTOS = 2;

/** AG16 FASE 1 — Registrar charla de seguridad (tema, duración, asistentes, foto, firma). */
@Component({
  selector: 'app-obra-charla',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PhotoSlot, SignaturePad, Counter, WizardExit, BigConfirm, ConfirmDialog],
  templateUrl: './charla.html',
  styleUrl: './charla.scss',
})
export class CharlaPage implements OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private obra = inject(ObraService);
  private navGuard = inject(NavGuardService);
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);
  protected network = inject(NetworkService);
  private toast = inject(ToastService);
  private location = inject(Location);

  private sig = viewChild(SignaturePad);
  readonly slots = Array.from({ length: MAX_FOTOS }, (_, i) => i);

  proyectoId = '';
  readonly hoy = new Date().toISOString().slice(0, 10);

  tema = signal('');
  duracion = signal(5);
  asistentes = signal(0);
  notas = signal('');
  fotos = signal<Record<number, CapturedPhoto>>({});
  firmando = signal(false);

  submitting = signal(false);
  done = signal(false);
  confirmSalir = signal(false);
  borradorPrevio = signal(false);
  private hydrated = false;

  puedeGuardar = computed(() => !!this.tema().trim() && Object.keys(this.fotos()).length > 0);

  private get clave(): string {
    return `obra_charla:${this.proyectoId}`;
  }

  private readonly backHandler = (): boolean => {
    if (!this.done() && this.tieneDatos()) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  constructor() {
    this.proyectoId = this.route.snapshot.paramMap.get('proyectoId') ?? '';
    void this.restoreDraft();
    this.navGuard.register(this.backHandler);
    effect(() => {
      const snap = { tema: this.tema(), duracion: this.duracion(), asistentes: this.asistentes(), notas: this.notas() };
      if (!this.hydrated || this.submitting() || this.done()) return;
      this.autosave.queue(this.clave, snap, { tipo: 'obra_charla', etiqueta: 'Charla de seguridad', ruta: this.location.path() });
    });
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }

  private async restoreDraft(): Promise<void> {
    const draft = await this.borrador.load<{ tema: string; duracion: number; asistentes: number; notas: string }>(this.clave);
    if (draft) {
      this.tema.set(draft.tema ?? '');
      this.duracion.set(draft.duracion ?? 5);
      this.asistentes.set(draft.asistentes ?? 0);
      this.notas.set(draft.notas ?? '');
      const fotos = await this.borrador.loadFotos(this.clave);
      if (fotos.length) {
        const map: Record<number, CapturedPhoto> = {};
        for (const f of fotos) {
          const idx = Number(f.slot);
          if (Number.isFinite(idx)) map[idx] = { blob: f.blob, previewUrl: URL.createObjectURL(f.blob) };
        }
        this.fotos.set(map);
      }
      this.borradorPrevio.set(true);
    }
    this.hydrated = true;
  }

  private tieneDatos(): boolean {
    return !!this.tema().trim() || this.asistentes() > 0 || Object.keys(this.fotos()).length > 0;
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

  pedirSalir(): void {
    if (!this.done() && this.tieneDatos()) this.confirmSalir.set(true);
    else this.salir();
  }
  cancelarSalir(): void {
    this.confirmSalir.set(false);
  }
  salir(): void {
    this.confirmSalir.set(false);
    this.navGuard.back('/obra/plan/' + this.proyectoId);
  }

  async guardar(): Promise<void> {
    if (this.submitting() || !this.puedeGuardar()) return;
    this.submitting.set(true);
    try {
      const firma = this.firmando() ? await this.sig()?.toBlob() : null;
      const fotosMap = this.fotos();
      const fotos = this.slots.map((i) => fotosMap[i]?.blob).filter((b): b is Blob => !!b);
      await this.obra.enqueueCharla({
        proyectoId: this.proyectoId,
        fecha: this.hoy,
        tema: this.tema().trim(),
        duracionMin: this.duracion(),
        asistentes: this.asistentes() || null,
        notas: this.notas().trim() || null,
        fotos,
        firmas: firma ? [firma] : [],
      });
      await this.autosave.discard(this.clave);
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar la charla.');
    } finally {
      this.submitting.set(false);
    }
  }

  cerrar(): void {
    this.navGuard.back('/obra/plan/' + this.proyectoId);
  }
}
