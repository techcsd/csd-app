import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { ClaudeConectorService } from '../../../core/services/claude-conector.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { MOTION_DIRECTIVES } from '../../../shared/motion';
import { ClaudeBorrador, ClaudeConectorConfig, ClaudeMiConexion } from '../../../core/models/claude-conector.model';
import { formatFechaRelativa } from '../../../core/util/fecha';

/**
 * CR1 (PROMPT-105 F1) — Perfil › Claude. La app SOLO muestra el estado de la
 * conexión de Claude Desktop y deja desconectar/revisar borradores pendientes —
 * conectar (OAuth) es solo-web (mock `Perfil-claude-app`, 390px). Contrato del
 * padre en `SGC/PARIDAD.md` § CR1, verificado vivo en sgc-dev antes de esta ronda.
 */
@Component({
  selector: 'app-perfil-claude',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, ConfirmDialog, ...MOTION_DIRECTIVES],
  templateUrl: './claude.html',
  styleUrl: './claude.scss',
})
export class PerfilClaudePage {
  private claude = inject(ClaudeConectorService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private router = inject(Router);
  private location = inject(Location);

  online = this.network.online;
  loading = signal(true);
  /** null = aún no cargó o la consulta falló (distinto de "nunca se conectó"). */
  conexion = signal<ClaudeMiConexion | null>(null);
  config = signal<ClaudeConectorConfig | null>(null);
  /** null = aún no cargó / falló (distinto de "sin pendientes" = []). */
  borradores = signal<ClaudeBorrador[] | null>(null);
  cargaFallida = signal(false);
  desconectando = signal(false);
  confirmDesconectar = signal(false);

  /** `claude_conector_activo=false` apaga el conector para todos — se avisa en claro. */
  conectorApagado = computed(() => this.config()?.activo === false);
  fmtRelativa = formatFechaRelativa;

  constructor() {
    void this.cargar();
  }

  private async cargar(): Promise<void> {
    this.loading.set(true);
    this.cargaFallida.set(false);
    if (!this.online()) {
      this.loading.set(false);
      return;
    }
    try {
      const [conexion, config, borradores] = await Promise.all([
        this.claude.miConexion(),
        this.claude.config(),
        this.claude.borradoresPendientes(),
      ]);
      this.conexion.set(conexion);
      this.config.set(config);
      this.borradores.set(borradores);
    } catch {
      this.cargaFallida.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  recargar(): void {
    void this.cargar();
  }

  /** Cuánto falta para que caduque un borrador (CR1 §B3: 24h desde que se creó). */
  caducaEn(expiraEn: string): string {
    const ms = new Date(expiraEn).getTime() - Date.now();
    if (ms <= 0) return this.i18n.t('ya caducó');
    const horas = Math.round(ms / 3_600_000);
    if (horas < 1) return this.i18n.t('caduca en menos de 1 h');
    return `${this.i18n.t('caduca en')} ${horas} h`;
  }

  abrirBorrador(id: string): void {
    void this.router.navigate(['/borrador', id]);
  }

  pedirDesconectar(): void {
    this.confirmDesconectar.set(true);
  }
  cancelarDesconectar(): void {
    this.confirmDesconectar.set(false);
  }

  async desconectar(): Promise<void> {
    this.confirmDesconectar.set(false);
    if (this.desconectando()) return;
    this.desconectando.set(true);
    try {
      await this.claude.desconectar();
      this.toast.success(this.i18n.t('Claude quedó desconectado de tu cuenta.'));
      await this.cargar();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo desconectar. Inténtalo de nuevo.'));
    } finally {
      this.desconectando.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
