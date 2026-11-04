import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { WizardExit } from '../../../shared/ui/wizard-exit/wizard-exit';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { CupoTarjetaService } from '../../../core/services/cupo-tarjeta.service';
import { ToastService } from '../../../core/services/toast.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { MotivoCupo, TarjetaConsumo } from '../../../core/models/cupo-tarjeta.model';
import { EstadoChip } from '../../../shared/ui/estado-chip/estado-chip';
import { TecTono } from '../../../shared/utils/tec-tono.util';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

/** F8 — línea de estado de cupo como chip (punto + palabra + fondo suave). */
interface LineaEstadoCupo {
  texto: string;
  tono: TecTono;
}

/** DI — opción de motivo (ícono + etiqueta + valor enviado al servidor). */
interface MotivoOpt {
  valor: MotivoCupo;
  icon: string;
  label: string;
}
const MOTIVOS: MotivoOpt[] = [
  { valor: 'llego_limite', icon: '🛑', label: 'Llegó al límite' },
  { valor: 'bomba_rechazo', icon: '⛽', label: 'La bomba la rechazó' },
  { valor: 'pocos_galones', icon: '📉', label: 'Pocos galones' },
  { valor: 'otro', icon: '✏️', label: 'Otro motivo' },
];

/**
 * DI — "Pedir más cupo" de una tarjeta de combustible. Solicitud manual +
 * cupo opcional por tarjeta (decisión de Xaviel): la app no conoce el límite
 * real de la tarjeta, solo muestra el consumo del período SI Flota anotó un
 * cupo. No pasa por el outbox (requiere conectividad, como log_combustible).
 */
@Component({
  selector: 'app-solicitar-cupo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, WizardExit, OptionButton, EstadoChip, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './solicitar-cupo.html',
  styleUrl: './solicitar-cupo.scss',
})
export class SolicitarCupoPage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private cupoTarjeta = inject(CupoTarjetaService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);

  readonly motivos = MOTIVOS;

  vehiculoId: string | null = null;
  tarjeta = signal('');
  motivo = signal<MotivoCupo | null>(null);
  galones = signal<number | null>(null);
  monto = signal<number | null>(null);
  nota = signal('');

  cargandoTarjeta = signal(false);
  tarjetaInfo = signal<TarjetaConsumo | null>(null);

  enviando = signal(false);
  enviado = signal(false);

  /**
   * F8 — "Tu tarjeta ···NNNN va en X% de su cupo" como chip (punto + palabra):
   * <80% informativo, 80-99% ámbar (cerca del límite), ≥100% rojo (lo superó).
   */
  lineasEstado = computed<LineaEstadoCupo[]>(() => {
    const t = this.tarjetaInfo();
    if (!t) return [];
    const codigo = this.ultimos4(t.codigo_tarjeta);
    const tono = (pct: number): TecTono => (pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'info');
    const lineas: LineaEstadoCupo[] = [];
    if (t.cupo_gal != null && t.pct_gal != null) {
      const pct = Math.round(t.pct_gal);
      lineas.push({ tono: tono(pct), texto: this.i18n.t('···{codigo} · {pct}% del cupo en galones', { codigo, pct }) });
    }
    if (t.cupo_monto != null && t.pct_monto != null) {
      const pct = Math.round(t.pct_monto);
      lineas.push({ tono: tono(pct), texto: this.i18n.t('···{codigo} · {pct}% del cupo en RD$', { codigo, pct }) });
    }
    return lineas;
  });

  puedeEnviar = computed(() => this.tarjeta().trim().length > 0 && this.motivo() !== null && !this.enviando());

  constructor() {
    const qp = this.route.snapshot.queryParamMap;
    this.vehiculoId = qp.get('vehiculoId');
    const tarjetaQp = qp.get('tarjeta');
    if (tarjetaQp) this.tarjeta.set(tarjetaQp);

    if (this.vehiculoId) void this.cargarTarjeta(this.vehiculoId);
  }

  private async cargarTarjeta(vehiculoId: string): Promise<void> {
    this.cargandoTarjeta.set(true);
    try {
      const info = await this.cupoTarjeta.miTarjeta(vehiculoId);
      this.tarjetaInfo.set(info);
      // Si no habíamos prellenado tarjeta por query param, usa la de la respuesta.
      if (info && !this.tarjeta().trim()) this.tarjeta.set(info.codigo_tarjeta);
    } catch {
      // Best-effort: sin esta info el chofer igual puede pedir cupo escribiendo la tarjeta a mano.
      this.tarjetaInfo.set(null);
    } finally {
      this.cargandoTarjeta.set(false);
    }
  }

  private ultimos4(codigo: string): string {
    const limpio = codigo.trim();
    return limpio.length > 4 ? limpio.slice(-4) : limpio;
  }

  elegirMotivo(m: MotivoOpt): void {
    this.motivo.set(m.valor);
  }

  async enviar(): Promise<void> {
    const motivo = this.motivo();
    const codigo = this.tarjeta().trim();
    if (!codigo || !motivo || this.enviando()) return;
    this.enviando.set(true);
    try {
      await this.cupoTarjeta.solicitar({
        codigoTarjeta: codigo,
        vehiculoId: this.vehiculoId,
        galones: this.galones(),
        monto: this.monto(),
        motivo,
        nota: this.nota().trim() || null,
      });
      this.enviado.set(true);
      this.toast.success(this.i18n.t('Solicitud enviada. Flota la va a revisar.'));
    } catch {
      this.toast.error(this.i18n.t('No se pudo enviar la solicitud. Intenta de nuevo.'));
    } finally {
      this.enviando.set(false);
    }
  }

  verMisSolicitudes(): void {
    void this.router.navigate(['/transporte/cupo/mis-solicitudes']);
  }

  salir(): void {
    this.location.back();
  }
}
