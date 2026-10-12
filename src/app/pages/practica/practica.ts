import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Location, UpperCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { PracticaService } from '../../core/practica/practica.service';
import { PracticaMision } from '../../core/practica/practica.models';
import { MotionService } from '../../core/services/motion.service';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { MOTION_DIRECTIVES } from '../../shared/motion';

/** CM7 — un trozo de confeti para la celebración del resultado (aprobado). */
interface Confeti {
  col: string;
  dx: string;
  dy: string;
  delay: string;
}

/**
 * CM7 (PROMPT-95 F6a) — modo práctica: una sola pantalla con 3 estados (inicio →
 * misión → resultado), copia del mock `CM7-demo-app`. Simulador 100% local: banda
 * "PRÁCTICA · nada de esto es real", cronómetro, objetivos que se marcan en vivo,
 * error con temblor y penalización, y resultado con anillo/estrellas/confeti (solo si
 * aprueba) + lista ✓/✗ con consejo. Guarda la nota con `practica_guardar_intento`.
 */
@Component({
  selector: 'app-practica',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, UpperCasePipe, RouterLink, ...MOTION_DIRECTIVES],
  templateUrl: './practica.html',
  styleUrl: './practica.scss',
})
export class PracticaPage {
  private practica = inject(PracticaService);
  private location = inject(Location);
  private motion = inject(MotionService);

  // Estado del motor (re-expuesto a la plantilla).
  readonly mision = this.practica.mision;
  readonly resultado = this.practica.resultado;
  readonly segundos = this.practica.segundos;
  readonly corrigiendo = this.practica.corrigiendo;
  readonly pasoActual = this.practica.pasoActual;
  readonly temblorAt = this.practica.temblorAt;

  /** Pantalla actual derivada del estado del motor. */
  readonly pantalla = computed<'inicio' | 'mision' | 'resultado'>(() => {
    if (this.resultado()) return 'resultado';
    if (this.mision()) return 'mision';
    return 'inicio';
  });

  /** Misiones que el usuario puede practicar (según su rol). */
  readonly misiones = computed<PracticaMision[]>(() => this.practica.misionesPara(this.practica.misRoles()));

  /** Pasos "de formulario" (sin el confirmar final) para pintar los campos. */
  readonly camposPasos = computed(() => (this.mision()?.pasos ?? []).filter((p) => p.tipo !== 'confirmar'));

  /** Confeti de la celebración (solo si aprobó). */
  readonly confeti = signal<Confeti[]>([]);

  constructor() {
    // Al terminar: si aprobó y hay movimiento, vibra + arma el confeti.
    effect(() => {
      const r = this.resultado();
      if (r?.aprobada && !this.motion.reducido()) {
        this.confeti.set(this.armarConfeti());
        void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
      } else {
        this.confeti.set([]);
      }
    });
  }

  // ── Inicio ──────────────────────────────────────────────────────────────────
  iniciar(m: PracticaMision): void {
    this.practica.iniciar(m);
  }

  // ── Misión ──────────────────────────────────────────────────────────────────
  avanzar(): void {
    this.practica.avanzar();
  }
  salir(): void {
    this.practica.salir();
  }

  valorDe(objetivo: string): string {
    return this.practica.valorDe(objetivo);
  }
  fotoHecha(objetivo: string): boolean {
    return this.practica.fotoHecha(objetivo);
  }
  objetivoHecho(id: string): boolean {
    return this.practica.objetivoHecho(id);
  }
  /** ¿Es el paso actual el que está mostrando un error (km trampa)? */
  get mostrandoError(): boolean {
    return this.corrigiendo() && this.pasoActual()?.tipo === 'valor';
  }

  // ── Resultado ────────────────────────────────────────────────────────────────
  repetir(): void {
    this.practica.reiniciar();
  }
  siguiente(): void {
    this.practica.salir(); // vuelve al inicio (lista de misiones)
  }

  /** mm:ss del cronómetro. */
  reloj(): string {
    const s = this.segundos();
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  back(): void {
    if (this.mision()) {
      this.practica.salir();
      return;
    }
    this.location.back();
  }

  private armarConfeti(): Confeti[] {
    const cols = ['#f97316', '#1e3a5f', '#fdba74', '#9cc0ec'];
    return Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * Math.PI * 2;
      return {
        col: cols[i % 4],
        dx: `${Math.round(Math.cos(a) * 150)}px`,
        dy: `${Math.round(Math.sin(a) * 150 - 40)}px`,
        delay: `${(i % 4) * 40}ms`,
      };
    });
  }
}
