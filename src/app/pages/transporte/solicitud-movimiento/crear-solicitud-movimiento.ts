import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { SelectOption } from '../../../shared/ui/select-list/select-list';
import {
  SolicitudMovimientoService,
  PrioridadSolicitud,
  TipoCarga,
  DireccionMovimiento,
} from '../../../core/services/solicitud-movimiento.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';

const TIPOS_CARGA: Array<{ key: TipoCarga; label: string }> = [
  { key: 'materiales', label: 'Materiales' },
  { key: 'equipo', label: 'Equipo' },
  { key: 'otros', label: 'Otros' },
];
const DIRECCIONES: Array<{ key: DireccionMovimiento; label: string }> = [
  { key: 'a_obra', label: 'Llevar a la obra' },
  { key: 'de_obra', label: 'Sacar de la obra' },
];
const PRIORIDADES: Array<{ key: PrioridadSolicitud; label: string; tone: 'default' | 'success' | 'warning' | 'error' }> = [
  { key: 'baja', label: 'Baja', tone: 'success' },
  { key: 'media', label: 'Media', tone: 'default' },
  { key: 'alta', label: 'Alta', tone: 'warning' },
  { key: 'urgente', label: 'Urgente', tone: 'error' },
];

/**
 * AY11 — el INGENIERO crea una Solicitud de movimiento (offline por outbox). Pide
 * al departamento de transporte mover material/equipo entre puntos, con prioridad y
 * fecha de requerimiento. El referente la ve en su bandeja y la planifica.
 */
@Component({
  selector: 'app-crear-solicitud-movimiento',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, CollapsibleSelect, OptionButton, WizardFooter],
  templateUrl: './crear-solicitud-movimiento.html',
  styleUrl: './crear-solicitud-movimiento.scss',
})
export class CrearSolicitudMovimientoPage {
  private solicitudes = inject(SolicitudMovimientoService);
  private inventario = inject(InventarioService);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);
  private router = inject(Router);

  readonly tipos = TIPOS_CARGA;
  readonly direcciones = DIRECCIONES;
  readonly prioridades = PRIORIDADES;

  obraOpts = signal<SelectOption[]>([]);
  proyectoId = signal('');
  direccion = signal<DireccionMovimiento>('a_obra');
  otroPunto = signal('');
  queSeMueve = signal('');
  tipoCarga = signal<TipoCarga>('materiales');
  prioridad = signal<PrioridadSolicitud>('media');
  fechaReq = signal('');
  notas = signal('');
  enviando = signal(false);

  /** Etiqueta del "otro extremo" según la dirección (para el placeholder/label). */
  otroLabel = computed(() =>
    this.direccion() === 'a_obra' ? '¿De dónde sale el material?' : '¿A dónde va el material?',
  );

  puedeEnviar = computed(
    () => !!this.proyectoId() && this.queSeMueve().trim().length > 0 && !this.enviando(),
  );

  constructor() {
    void this.cargarObras();
  }

  private async cargarObras(): Promise<void> {
    try {
      const obras = await this.inventario.getObrasDestino();
      this.obraOpts.set(obras.map((o) => ({ id: o.id, label: o.nombre })));
    } catch {
      /* sin red: el selector queda vacío; el ingeniero puede reintentar */
    }
  }

  async enviar(): Promise<void> {
    if (!this.puedeEnviar()) return;
    this.enviando.set(true);
    try {
      await this.solicitudes.crear({
        proyectoId: this.proyectoId(),
        direccion: this.direccion(),
        otroPunto: this.otroPunto().trim(),
        queSeMueve: this.queSeMueve().trim(),
        tipoCarga: this.tipoCarga(),
        prioridad: this.prioridad(),
        fechaRequerimiento: this.fechaReq() || null,
        notas: this.notas().trim() || null,
      });
      this.toast.success('Solicitud enviada. Se sincroniza sola al reconectar.');
      void this.router.navigate(['/transporte/solicitudes-movimiento']);
    } catch {
      this.toast.error('No pudimos guardar la solicitud. Inténtalo de nuevo.');
    } finally {
      this.enviando.set(false);
    }
  }

  back(): void {
    this.navGuard.back('/transporte/solicitudes-movimiento');
  }
}
