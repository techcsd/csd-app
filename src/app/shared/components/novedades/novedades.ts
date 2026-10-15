import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, signal } from '@angular/core';
import { NovedadesService } from '../../../core/services/novedades.service';
import { VersionService, VersionHistorial, CAMBIO_LABEL } from '../../../core/services/version.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { etiquetaDiaChat } from '../../../core/util/fecha';
import { MOTION_DIRECTIVES } from '../../motion';

/**
 * CO2 — "Novedades" a pantalla completa (mock `Novedades-app`). Aparece tras el
 * logo (CM2) y la bienvenida (CL3), nunca encima de un formulario/wizard. "Lo que
 * reportaste ya está arreglado" primero (si aplica), luego versiones recientes con
 * chips NUEVO/ARREGLO/MEJORA. "Entendido" marca vista; Esc/atrás cuentan igual.
 */
@Component({
  selector: 'app-novedades',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './novedades.html',
  styleUrl: './novedades.scss',
})
export class Novedades {
  private novedades = inject(NovedadesService);
  private version = inject(VersionService);
  private ctx = inject(UserContextService);
  private navGuard = inject(NavGuardService);

  mostrar = this.novedades.mostrar;
  datos = this.novedades.datos;
  verTodo = this.novedades.verTodoElHistorial;

  cargandoTodo = signal(false);
  todoElHistorial = signal<VersionHistorial[]>([]);

  nombre = computed(() => this.ctx.nombre().split(' ')[0] || '');
  local = this.version.local;

  chipLabel = (t: string): string => CAMBIO_LABEL[t] ?? t;

  private backHandler = (): boolean => {
    void this.entendido();
    return true;
  };

  constructor() {
    effect(() => {
      if (this.mostrar()) this.navGuard.registerOverlay(this.backHandler);
      else this.navGuard.clearOverlay(this.backHandler);
    });
  }

  /** "hoy"/"ayer"/"13 oct" (mock). */
  fechaLabel(f: string | null): string {
    if (!f) return '';
    const l = etiquetaDiaChat(f);
    return l === 'Hoy' ? 'hoy' : l === 'Ayer' ? 'ayer' : l;
  }

  async verHistorial(): Promise<void> {
    if (this.verTodo()) {
      this.verTodo.set(false);
      return;
    }
    this.verTodo.set(true);
    if (this.todoElHistorial().length) return;
    this.cargandoTodo.set(true);
    try {
      const h = await this.version.historial();
      this.todoElHistorial.set(h.filter((v) => v.plataforma === 'movil'));
    } catch {
      /* best-effort: el botón simplemente no trae nada */
    } finally {
      this.cargandoTodo.set(false);
    }
  }

  async entendido(): Promise<void> {
    await this.novedades.entendido();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.mostrar()) void this.entendido();
  }
}
