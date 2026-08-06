import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { DatePipe } from '@angular/common';
import { ObraService } from '../../../core/services/obra.service';
import { EntradaProgramada } from '../../../core/models/obra.model';

const MAX_FOTOS = 2;
const TIPOS: { key: string; label: string }[] = [
  { key: 'slump', label: 'Slump' },
  { key: 'probeta', label: 'Probeta' },
  { key: 'compactacion', label: 'Compactación' },
  { key: 'otro', label: 'Otro' },
];

/** AG16 FASE 5 — Logística: registrar prueba de campo + ver pruebas recientes. */
@Component({
  selector: 'app-obra-logistica',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, PhotoSlot, OptionButton, Skeleton],
  templateUrl: './logistica.html',
  styleUrl: './logistica.scss',
})
export class LogisticaPage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private obra = inject(ObraService);
  protected network = inject(NetworkService);
  private toast = inject(ToastService);

  readonly slots = Array.from({ length: MAX_FOTOS }, (_, i) => i);
  readonly tipos = TIPOS;
  readonly hoy = new Date().toISOString().slice(0, 10);

  proyectoId = '';
  tab = signal<'entradas' | 'pruebas'>('entradas');
  loading = signal(true);
  entradas = signal<EntradaProgramada[]>([]);
  pruebas = signal<Record<string, unknown>[]>([]);

  // Nueva prueba
  registrando = signal(false);
  tipo = signal<string | null>(null);
  resultado = signal('');
  notas = signal('');
  fotos = signal<Record<number, CapturedPhoto>>({});
  enviando = signal(false);

  puedeGuardar = computed(() => !!this.tipo());

  constructor() {
    this.proyectoId = this.route.snapshot.paramMap.get('proyectoId') ?? '';
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    try {
      const [entradas, pruebas] = await Promise.all([
        this.obra.entradasProgramadas(this.proyectoId),
        this.obra.pruebasDe(this.proyectoId),
      ]);
      this.entradas.set(entradas);
      this.pruebas.set(pruebas);
    } finally {
      this.loading.set(false);
    }
  }

  onFoto(idx: number, photo: CapturedPhoto): void {
    this.fotos.update((f) => ({ ...f, [idx]: photo }));
  }
  onFotoCleared(idx: number): void {
    this.fotos.update((f) => {
      const next = { ...f };
      delete next[idx];
      return next;
    });
  }

  async guardar(): Promise<void> {
    if (this.enviando() || !this.puedeGuardar()) return;
    this.enviando.set(true);
    try {
      const fotosMap = this.fotos();
      const fotos = this.slots.map((i) => fotosMap[i]?.blob).filter((b): b is Blob => !!b);
      await this.obra.enqueuePruebaCampo({
        proyectoId: this.proyectoId,
        tipo: this.tipo()!,
        fecha: this.hoy,
        resultado: this.resultado().trim() || null,
        notas: this.notas().trim() || null,
        fotos,
      });
      this.toast.success(this.network.online() ? 'Prueba registrada.' : 'Guardada. Se enviará cuando tengas señal.');
      this.registrando.set(false);
      this.tipo.set(null);
      this.resultado.set('');
      this.notas.set('');
      this.fotos.set({});
      void this.cargar();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo registrar la prueba.');
    } finally {
      this.enviando.set(false);
    }
  }

  back(): void {
    void this.router.navigate(['/obra']);
  }
}
