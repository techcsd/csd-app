import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BovedaService } from '../../../../core/services/boveda.service';
import { VaultSessionService } from '../../../../core/services/vault-session.service';
import { ToastService } from '../../../../core/services/toast.service';
import { I18nService } from '../../../../core/i18n/i18n.service';
import { BovedaEntrada, BovedaTipo } from '../../../../core/models/boveda.model';
import { VaultSecureDirective } from '../../../../shared/ui/vault-secure/vault-secure.directive';
import { Skeleton } from '../../../../shared/ui/skeleton/skeleton';
import { TranslatePipe } from '../../../../core/i18n/translate.pipe';
import { MOTION_DIRECTIVES } from '../../../../shared/motion';

const TIPO_LABEL: Record<BovedaTipo, string> = {
  cuenta: 'Cuenta web',
  api: 'Llave API / token',
  '2fa': 'Código 2FA',
  nota: 'Nota segura',
  archivo: 'Archivo',
};

/**
 * CZ7 — ficha de una entrada del Vault. Alcance móvil: ver metadata, revelar
 * (30 s), copiar y código 2FA (30 s, se recalcula solo). El valor NUNCA se
 * guarda en ningún storage: vive solo en estos signals de componente y se
 * borra al salir de la pantalla, pasar a segundo plano o vencer la sesión.
 */
@Component({
  selector: 'app-vault-entrada',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [VaultSecureDirective, Skeleton, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './vault-entrada.html',
  styleUrl: './vault-entrada.scss',
})
export class VaultEntradaPage implements OnDestroy {
  private boveda = inject(BovedaService);
  vaultSession = inject(VaultSessionService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  TIPO_LABEL = TIPO_LABEL;

  loading = signal(true);
  entrada = signal<BovedaEntrada | null>(null);

  revelando = signal(false);
  valorRevelado = signal<string | null>(null);
  segundosVisible = signal(0);
  private timerOcultar: ReturnType<typeof setInterval> | null = null;

  pidiendo2fa = signal(false);
  codigo2fa = signal<string | null>(null);
  segundos2fa = signal(0);
  private timer2fa: ReturnType<typeof setInterval> | null = null;

  /** La sesión del Vault venció mientras esta ficha estaba abierta. */
  bloqueado = computed(() => !(this.vaultSession.segundosRestantes() > 0));

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    if (!(await this.vaultSession.refrescarDesdeServidor())) {
      void this.router.navigate(['/admin/vault']);
      return;
    }
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      void this.router.navigate(['/admin/vault']);
      return;
    }
    this.loading.set(true);
    try {
      const lista = await this.boveda.listar();
      const e = lista.find((x) => x.id === id) ?? null;
      if (!e) {
        this.toast.error(this.i18n.t('No encontramos esta entrada.'));
        void this.router.navigate(['/admin/vault']);
        return;
      }
      this.entrada.set(e);
    } finally {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.limpiarTimers();
  }

  /** CZ7/DZ-19 — la app pasó a segundo plano: borra todo secreto en memoria. */
  alFondo(): void {
    this.limpiarSecretos();
    this.vaultSession.cerrar();
  }

  private limpiarSecretos(): void {
    this.valorRevelado.set(null);
    this.codigo2fa.set(null);
    this.limpiarTimers();
  }

  private limpiarTimers(): void {
    if (this.timerOcultar) clearInterval(this.timerOcultar);
    if (this.timer2fa) clearInterval(this.timer2fa);
    this.timerOcultar = null;
    this.timer2fa = null;
  }

  async revelar(): Promise<void> {
    const e = this.entrada();
    if (!e || !this.vaultSession.vigente()) return;
    this.revelando.set(true);
    try {
      const { valor, visible_segundos } = await this.boveda.revelar(e.id);
      this.valorRevelado.set(valor);
      this.segundosVisible.set(visible_segundos);
      if (this.timerOcultar) clearInterval(this.timerOcultar);
      this.timerOcultar = setInterval(() => {
        const n = this.segundosVisible() - 1;
        this.segundosVisible.set(n);
        if (n <= 0) {
          this.valorRevelado.set(null);
          if (this.timerOcultar) clearInterval(this.timerOcultar);
        }
      }, 1000);
    } catch (e2) {
      this.toast.error(e2 instanceof Error ? e2.message : this.i18n.t('No se pudo revelar.'));
    } finally {
      this.revelando.set(false);
    }
  }

  async pedirCodigo2fa(): Promise<void> {
    const e = this.entrada();
    if (!e || !this.vaultSession.vigente()) return;
    this.pidiendo2fa.set(true);
    try {
      const { codigo, segundos_restantes } = await this.boveda.codigo2fa(e.id);
      this.codigo2fa.set(codigo);
      this.segundos2fa.set(segundos_restantes);
      if (this.timer2fa) clearInterval(this.timer2fa);
      this.timer2fa = setInterval(() => {
        const n = this.segundos2fa() - 1;
        if (n <= 0) void this.pedirCodigo2fa();
        else this.segundos2fa.set(n);
      }, 1000);
    } catch (e2) {
      this.toast.error(e2 instanceof Error ? e2.message : this.i18n.t('No se pudo calcular el código.'));
    } finally {
      this.pidiendo2fa.set(false);
    }
  }

  /** Copia el valor (ya en memoria) y limpia el portapapeles a los 30 s (mejor esfuerzo). */
  async copiar(valor: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(valor);
      const e = this.entrada();
      if (e) void this.boveda.registrarCopia(e.id);
      this.toast.success(this.i18n.t('Copiado — se borra del portapapeles en 30 s'));
      setTimeout(() => {
        navigator.clipboard.writeText('').catch(() => undefined);
      }, 30_000);
    } catch {
      this.toast.error(this.i18n.t('No se pudo copiar.'));
    }
  }

  back(): void {
    this.limpiarSecretos();
    void this.router.navigate(['/admin/vault']);
  }
}
