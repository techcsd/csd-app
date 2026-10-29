import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BovedaService } from '../../../core/services/boveda.service';
import { VaultSessionService } from '../../../core/services/vault-session.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { BovedaEntrada, BovedaTipo, estadoRotacionDe } from '../../../core/models/boveda.model';
import { VaultSecureDirective } from '../../../shared/ui/vault-secure/vault-secure.directive';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

type FiltroTipo = 'all' | BovedaTipo;

const TIPO_LABEL: Record<BovedaTipo, string> = {
  cuenta: 'Cuenta web',
  api: 'Llave API / token',
  '2fa': 'Código 2FA',
  nota: 'Nota segura',
  archivo: 'Archivo',
};
/**
 * CZ3/CZ7 — Vault de Administración, en la app. Alcance móvil (DZ-19): buscar,
 * ver, revelar, copiar, código 2FA y generador. Crear/editar/eliminar/importar/
 * exportar: solo web. Doble puerta: `roleAnyGuard(['admin'])` en la ruta +
 * reautenticación con contraseña (esta pantalla, sesión de 2 min).
 */
@Component({
  selector: 'app-vault',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, VaultSecureDirective, EmptyState, Skeleton, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './vault.html',
  styleUrl: './vault.scss',
})
export class VaultPage {
  private boveda = inject(BovedaService);
  vaultSession = inject(VaultSessionService);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private router = inject(Router);

  TIPO_LABEL = TIPO_LABEL;
  estadoRotacionDe = estadoRotacionDe;

  comprobandoSesion = signal(true);
  password = signal('');
  desbloqueando = signal(false);
  errorDesbloqueo = signal('');

  loading = signal(false);
  entradas = signal<BovedaEntrada[]>([]);
  query = signal('');
  filtroTipo = signal<FiltroTipo>('all');
  soloPorRotar = signal(false);

  vigente = computed(() => this.vaultSession.segundosRestantes() > 0);

  entradasFiltradas = computed(() => {
    const q = this.query().trim().toLowerCase();
    const t = this.filtroTipo();
    const porRotar = this.soloPorRotar();
    return this.entradas().filter((e) => {
      if (t !== 'all' && e.tipo !== t) return false;
      if (porRotar && !['por_rotar', 'vencida'].includes(estadoRotacionDe(e))) return false;
      if (!q) return true;
      return (
        e.nombre.toLowerCase().includes(q) ||
        (e.sitio_url ?? '').toLowerCase().includes(q) ||
        (e.usuario_texto ?? '').toLowerCase().includes(q)
      );
    });
  });

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    this.comprobandoSesion.set(true);
    try {
      if (await this.vaultSession.refrescarDesdeServidor()) await this.cargar();
    } finally {
      this.comprobandoSesion.set(false);
    }
  }

  async desbloquear(): Promise<void> {
    const pwd = this.password();
    if (!pwd) return;
    this.desbloqueando.set(true);
    this.errorDesbloqueo.set('');
    try {
      await this.vaultSession.abrir(pwd);
      this.password.set('');
      await this.cargar();
    } catch (e) {
      this.errorDesbloqueo.set(e instanceof Error ? e.message : this.i18n.t('No se pudo entrar.'));
    } finally {
      this.desbloqueando.set(false);
    }
  }

  private async cargar(): Promise<void> {
    this.loading.set(true);
    try {
      this.entradas.set(await this.boveda.listar());
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo cargar el Vault.'));
    } finally {
      this.loading.set(false);
    }
  }

  /** CZ7/DZ-19 — la app pasó a segundo plano: cierra la sesión del Vault. */
  alFondo(): void {
    this.vaultSession.cerrar();
  }

  abrir(e: BovedaEntrada): void {
    void this.router.navigate(['/admin/vault', e.id]);
  }

  abrirGenerador(): void {
    void this.router.navigate(['/admin/vault/generador']);
  }

  back(): void {
    this.navGuard.back('/admin');
  }
}
