import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { UserContextService } from '../../core/services/user-context.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { MOTION_DIRECTIVES } from '../../shared/motion';

/** Admin hub (gated by the 'admin' módulo). Mobile mirror of SGC's Administración. */
@Component({
  selector: 'app-admin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './admin.html',
  styleUrl: './admin.scss',
})
export class AdminPage {
  private router = inject(Router);
  private location = inject(Location);
  private ctx = inject(UserContextService);

  /** El tile "Empleados y asignaciones" va a /rrhh/empleados (moduleGuard('rrhh'),
   *  sin bypass de admin) → solo mostrarlo si el usuario también tiene el módulo rrhh,
   *  para no llevar a un 403 (regla AU8). */
  hasModulo = this.ctx.hasModulo.bind(this.ctx);

  // CZ3/CZ7/DZ-08 — Vault: gate de ROL estricto (admin), independiente del
  // módulo 'admin' que ya gatea este hub. Espejo de sgc.puede_ver_vault().
  esAdmin = this.ctx.esAdmin;

  go(path: string): void {
    void this.router.navigate([path]);
  }
  back(): void {
    this.location.back();
  }
}
