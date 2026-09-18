import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { UserContextService } from '../../core/services/user-context.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** Admin hub (gated by the 'admin' módulo). Mobile mirror of SGC's Administración. */
@Component({
  selector: 'app-admin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
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

  go(path: string): void {
    void this.router.navigate([path]);
  }
  back(): void {
    this.location.back();
  }
}
