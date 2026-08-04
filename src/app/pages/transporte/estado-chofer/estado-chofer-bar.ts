import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BottomSheet } from '../../../shared/ui/bottom-sheet/bottom-sheet';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import {
  ChoferEstadoService,
  EstadoChofer,
  ESTADOS_MANUALES,
  estadoMeta,
} from '../../../core/services/chofer-estado.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * AF28 — barra compacta de estado del chofer para el hub de Transporte. Muestra el
 * estado actual (chip de color) + countdown de almuerzo, y abre una hoja para
 * cambiarlo. "En ruta" lo fija el sistema (no aparece como botón). Alimenta el
 * Seguimiento del jefe de flota (AF27).
 */
@Component({
  selector: 'app-estado-chofer-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, BottomSheet, OptionButton],
  templateUrl: './estado-chofer-bar.html',
  styleUrl: './estado-chofer-bar.scss',
})
export class EstadoChoferBar {
  private svc = inject(ChoferEstadoService);
  private toast = inject(ToastService);

  readonly opciones = ESTADOS_MANUALES;
  estado = this.svc.estado;
  meta = computed(() => estadoMeta(this.estado()));
  otrosTexto = this.svc.otrosTexto;
  countdown = this.svc.almuerzoRestanteLabel;

  sheetOpen = signal(false);
  pidiendoOtros = signal(false);
  otrosInput = signal('');

  constructor() {
    void this.svc.load().then(() => this.maybePromptMorning());
  }

  /** AF28 — al iniciar el día (estado Inactivo), invita a marcarse Disponible. */
  private maybePromptMorning(): void {
    if (this.svc.estado() !== 'inactivo') return;
    this.toast.withAction(
      'Buenos días. ¿Empiezas tu jornada?',
      { label: 'Estoy disponible', run: () => void this.svc.set('disponible') },
      'info',
      9000,
    );
  }

  abrir(): void {
    this.pidiendoOtros.set(false);
    this.otrosInput.set('');
    this.sheetOpen.set(true);
  }

  cerrar(): void {
    this.sheetOpen.set(false);
  }

  async elegir(e: EstadoChofer): Promise<void> {
    if (e === 'otros') {
      this.pidiendoOtros.set(true);
      return;
    }
    await this.svc.set(e);
    this.sheetOpen.set(false);
    this.avisoEstado(e);
  }

  async confirmarOtros(): Promise<void> {
    const t = this.otrosInput().trim();
    if (!t) {
      this.toast.error('Escribe qué estás haciendo.');
      return;
    }
    await this.svc.set('otros', t);
    this.sheetOpen.set(false);
    this.pidiendoOtros.set(false);
  }

  private avisoEstado(e: EstadoChofer): void {
    if (e === 'almuerzo') this.toast.success('Buen provecho — tienes 1 hora.');
    else if (e === 'inactivo') this.toast.success('Marcaste salida. ¡Hasta mañana!');
    else this.toast.success(`Estado: ${estadoMeta(e).label}`);
  }

  metaOf = estadoMeta;
}
