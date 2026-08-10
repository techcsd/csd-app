import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { ObraService } from '../../../core/services/obra.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { Subcontratista, Frente } from '../../../core/models/obra.model';

const MAX_SOPORTES = 3;

/** AG16 FASE 4 — Subcontratistas: frentes + avance + carga de cubicación. */
@Component({
  selector: 'app-obra-subcontratistas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PhotoSlot, Skeleton, EmptyState],
  templateUrl: './subcontratistas.html',
  styleUrl: './subcontratistas.scss',
})
export class SubcontratistasPage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private obra = inject(ObraService);
  protected network = inject(NetworkService);
  private toast = inject(ToastService);
  private navGuard = inject(NavGuardService);

  readonly slots = Array.from({ length: MAX_SOPORTES }, (_, i) => i);
  readonly hoy = new Date().toISOString().slice(0, 10);

  proyectoId = '';
  loading = signal(true);
  subs = signal<Subcontratista[]>([]);
  sel = signal<Subcontratista | null>(null);
  frentes = signal<Frente[]>([]);
  frenteEdit = signal<Record<string, number>>({});

  // Cubicación
  cubicando = signal(false);
  cubInicio = signal(this.hoy);
  cubFin = signal(this.hoy);
  cubDescripcion = signal('');
  cubMonto = signal(0);
  cubAvance = signal(0);
  cubFotos = signal<Record<number, CapturedPhoto>>({});
  enviando = signal(false);

  puedeCubicar = computed(() => this.cubMonto() > 0 && !!this.cubDescripcion().trim());

  constructor() {
    this.proyectoId = this.route.snapshot.paramMap.get('proyectoId') ?? '';
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    try {
      this.subs.set(await this.obra.subcontratistas());
    } finally {
      this.loading.set(false);
    }
  }

  async elegir(s: Subcontratista): Promise<void> {
    this.sel.set(s);
    this.cubicando.set(false);
    this.frentes.set(await this.obra.frentesDe(s.id, this.proyectoId));
    const edit: Record<string, number> = {};
    for (const f of this.frentes()) edit[f.id] = Number(f.avance_pct) || 0;
    this.frenteEdit.set(edit);
  }

  volver(): void {
    this.sel.set(null);
  }

  setFrenteAvance(id: string, v: number): void {
    this.frenteEdit.update((e) => ({ ...e, [id]: Math.max(0, Math.min(100, v || 0)) }));
  }

  // QA-23 — avance de cubicación acotado 0..100 (mismo criterio que los frentes).
  setCubAvance(v: number): void {
    this.cubAvance.set(Math.max(0, Math.min(100, v || 0)));
  }

  async guardarFrente(id: string): Promise<void> {
    try {
      await this.obra.actualizarFrenteAvance(id, this.frenteEdit()[id] ?? 0);
      this.toast.success('Avance del frente actualizado.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo actualizar.');
    }
  }

  onFoto(idx: number, photo: CapturedPhoto): void {
    this.cubFotos.update((f) => ({ ...f, [idx]: photo }));
  }
  onFotoCleared(idx: number): void {
    this.cubFotos.update((f) => {
      const next = { ...f };
      delete next[idx];
      return next;
    });
  }

  async enviarCubicacion(): Promise<void> {
    if (this.enviando() || !this.puedeCubicar() || !this.sel()) return;
    this.enviando.set(true);
    try {
      const fotosMap = this.cubFotos();
      const soportes = this.slots.map((i) => fotosMap[i]?.blob).filter((b): b is Blob => !!b);
      await this.obra.enqueueCubicacion({
        subcontratistaId: this.sel()!.id,
        proyectoId: this.proyectoId,
        periodoInicio: this.cubInicio(),
        periodoFin: this.cubFin(),
        descripcion: this.cubDescripcion().trim(),
        monto: this.cubMonto(),
        avancePct: this.cubAvance(),
        soportes,
      });
      this.toast.success(this.network.online() ? 'Cubicación cargada (borrador).' : 'Guardada. Se enviará cuando tengas señal.');
      this.cubicando.set(false);
      this.cubDescripcion.set('');
      this.cubMonto.set(0);
      this.cubAvance.set(0);
      this.cubFotos.set({});
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo cargar la cubicación.');
    } finally {
      this.enviando.set(false);
    }
  }

  back(): void {
    this.navGuard.back('/obra');
  }
}
