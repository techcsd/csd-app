import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ToggleSwitch } from '../toggle-switch/toggle-switch';
import { AyudanteService, AyudanteUsuario } from '../../../core/services/ayudante.service';
import { UserContextService } from '../../../core/services/user-context.service';

/**
 * AT4 — selector de AYUDANTE reutilizable para los flujos que puntúan (crear
 * ruta, conduce, inspección, reporte semanal). Un toggle "¿Vas con ayudante?"
 * y, si sí, un buscador de usuarios (buscar_usuarios → usuario_id) con la
 * sugerencia del "último ayudante" para fricción mínima. Emite el `usuario_id`
 * elegido (o null) al padre, que lo guarda en el borrador/payload y lo pasa a
 * `marcar_ayudante` tras crear la actividad. Opcional y offline-tolerante: sin
 * red no busca, pero SÍ ofrece el último ayudante (guardado localmente).
 */
@Component({
  selector: 'app-ayudante-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ToggleSwitch],
  templateUrl: './ayudante-picker.html',
  styleUrl: './ayudante-picker.scss',
})
export class AyudantePicker {
  private ayudantes = inject(AyudanteService);
  private ctx = inject(UserContextService);

  /** Texto del toggle (por defecto el estándar). */
  label = input<string>('¿Vas con ayudante?');

  /** Emite el ayudante elegido (usuario_id + nombre) o null si no lleva. */
  ayudanteChange = output<AyudanteUsuario | null>();

  activo = signal(false);
  term = signal('');
  buscando = signal(false);
  resultados = signal<AyudanteUsuario[]>([]);
  seleccionado = signal<AyudanteUsuario | null>(null);
  ultimo = signal<AyudanteUsuario | null>(null);

  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    void this.ayudantes.ultimo().then((u) => this.ultimo.set(u));
  }

  onToggle(v: boolean): void {
    this.activo.set(v);
    if (!v) {
      this.seleccionado.set(null);
      this.term.set('');
      this.resultados.set([]);
      this.ayudanteChange.emit(null);
    }
  }

  onTerm(v: string): void {
    this.term.set(v);
    if (this.debounce) clearTimeout(this.debounce);
    const t = v.trim();
    if (t.length < 2) {
      this.resultados.set([]);
      return;
    }
    this.debounce = setTimeout(() => void this.buscar(t), 300);
  }

  private async buscar(t: string): Promise<void> {
    this.buscando.set(true);
    try {
      const yo = this.ctx.profile()?.id;
      const res = await this.ayudantes.buscar(t);
      // Anti-abuso: el titular no puede ser su propio ayudante.
      this.resultados.set(res.filter((u) => u.id !== yo));
    } catch {
      this.resultados.set([]);
    } finally {
      this.buscando.set(false);
    }
  }

  elegir(u: AyudanteUsuario): void {
    this.seleccionado.set(u);
    this.resultados.set([]);
    this.term.set('');
    void this.ayudantes.recordarUltimo(u);
    this.ultimo.set(u);
    this.ayudanteChange.emit(u);
  }

  usarUltimo(): void {
    const u = this.ultimo();
    if (u) this.elegir(u);
  }

  limpiar(): void {
    this.seleccionado.set(null);
    this.ayudanteChange.emit(null);
  }
}
