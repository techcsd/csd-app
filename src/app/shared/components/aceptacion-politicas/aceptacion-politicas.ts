import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { PoliticasService } from '../../../core/services/politicas.service';
import { SessionService } from '../../../core/services/session.service';

/**
 * CI3 — Pantalla de aceptación de políticas (tras login, si hay versión vigente sin
 * aceptar). Resumen + enlaces a Privacidad/Términos + botón "Acepto". No se puede
 * saltar; el único escape es cerrar sesión. Vive en el shell y la controla
 * PoliticasService (hayPendientes()).
 */
@Component({
  selector: 'app-aceptacion-politicas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  templateUrl: './aceptacion-politicas.html',
  styleUrl: './aceptacion-politicas.scss',
})
export class AceptacionPoliticas {
  politicas = inject(PoliticasService);
  private session = inject(SessionService);

  procesando = signal(false);
  error = signal(false);

  async aceptar(): Promise<void> {
    if (this.procesando()) return;
    this.procesando.set(true);
    this.error.set(false);
    const ok = await this.politicas.aceptarTodas();
    this.procesando.set(false);
    if (!ok) this.error.set(true);
  }

  abrir(doc: 'privacidad' | 'terminos' | 'soporte'): void {
    void this.politicas.abrir(doc);
  }

  async cerrarSesion(): Promise<void> {
    await this.session.logout();
  }
}
