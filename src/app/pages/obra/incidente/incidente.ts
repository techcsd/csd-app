import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
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
import { IncidenteTipo, Severidad, SEVERIDAD_META } from '../../../core/models/obra.model';

const MAX_FOTOS = 3;
const TIPOS: { key: IncidenteTipo; label: string; icon: string }[] = [
  { key: 'casi_accidente', label: 'Casi-accidente', icon: '⚡' },
  { key: 'incidente', label: 'Incidente', icon: '🚧' },
  { key: 'accidente', label: 'Accidente', icon: '🚨' },
];

/** AG16 FASE 2 — Registrar incidente / casi-accidente de obra. */
@Component({
  selector: 'app-obra-incidente',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PhotoSlot, OptionButton, Counter, WizardExit, BigConfirm, ConfirmDialog],
  templateUrl: './incidente.html',
  styleUrl: './incidente.scss',
})
export class IncidentePage implements OnDestroy {
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
  readonly tipos = TIPOS;
  readonly gravedades = (Object.keys(SEVERIDAD_META) as Severidad[]).map((k) => ({ key: k, ...SEVERIDAD_META[k] }));

  proyectoId = '';
  tipo = signal<IncidenteTipo | null>(null);
  descripcion = signal('');
  gravedad = signal<Severidad>('media');
  lesionados = signal(0);
  ubicacion = signal('');
  investigacion = signal('');
  fotos = signal<Record<number, CapturedPhoto>>({});

  submitting = signal(false);
  done = signal(false);
  confirmSalir = signal(false);
  borradorPrevio = signal(false);
  private hydrated = false;

  puedeGuardar = computed(() => !!this.tipo() && !!this.descripcion().trim());

  private get clave(): string {
    return `obra_incidente:${this.proyectoId}`;
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
      const snap = {
        tipo: this.tipo(), descripcion: this.descripcion(), gravedad: this.gravedad(),
        lesionados: this.lesionados(), ubicacion: this.ubicacion(), investigacion: this.investigacion(),
      };
      if (!this.hydrated || this.submitting() || this.done()) return;
      this.autosave.queue(this.clave, snap, { tipo: 'obra_incidente', etiqueta: 'Incidente de obra', ruta: this.location.path() });
    });
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }

  private async restoreDraft(): Promise<void> {
    const d = await this.borrador.load<{
      tipo: IncidenteTipo | null; descripcion: string; gravedad: Severidad; lesionados: number; ubicacion: string; investigacion: string;
    }>(this.clave);
    if (d) {
      this.tipo.set(d.tipo ?? null);
      this.descripcion.set(d.descripcion ?? '');
      this.gravedad.set(d.gravedad ?? 'media');
      this.lesionados.set(d.lesionados ?? 0);
      this.ubicacion.set(d.ubicacion ?? '');
      this.investigacion.set(d.investigacion ?? '');
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
    return !!this.tipo() || !!this.descripcion().trim() || this.lesionados() > 0 || Object.keys(this.fotos()).length > 0;
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
    this.navGuard.back('/obra');
  }

  async guardar(): Promise<void> {
    if (this.submitting() || !this.puedeGuardar()) return;
    this.submitting.set(true);
    try {
      const fotosMap = this.fotos();
      const fotos = this.slots.map((i) => fotosMap[i]?.blob).filter((b): b is Blob => !!b);
      await this.obra.enqueueIncidente({
        proyectoId: this.proyectoId,
        tipo: this.tipo()!,
        descripcion: this.descripcion().trim(),
        gravedad: this.gravedad(),
        lesionados: this.lesionados(),
        ubicacion: this.ubicacion().trim() || null,
        investigacion: this.investigacion().trim() || null,
        fotos,
      });
      await this.autosave.discard(this.clave);
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo registrar el incidente.');
    } finally {
      this.submitting.set(false);
    }
  }

  cerrar(): void {
    this.navGuard.back('/obra');
  }
}
