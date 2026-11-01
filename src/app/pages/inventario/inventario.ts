import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { SyncBar } from '../../shared/components/sync-bar/sync-bar';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { MOTION_DIRECTIVES } from '../../shared/motion';
import { BadgesService } from '../../core/services/badges.service';
import { InventarioService } from '../../core/services/inventario.service';
import { Conduce } from '../../core/models/transporte.model';

/**
 * DE3 — Inventario hub: el número del icono del Home y lo que hay "adentro" eran
 * cosas distintas (badge = TODOS los conduces "despachado" de la empresa; aquí
 * dentro, botones sin conteo). Ahora el hub pinta el MISMO número que ya viene
 * de `badges_modulos_app()` (por usuario) junto al botón que lo origina, y una
 * tarjeta "Pendientes" con los más antiguos para que no haga falta adivinar.
 */
@Component({
  selector: 'app-inventario',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SyncBar, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './inventario.html',
  styleUrl: './inventario.scss',
})
export class InventarioPage {
  private router = inject(Router);
  private location = inject(Location);
  private badges = inject(BadgesService);
  private inventario = inject(InventarioService);

  loadingPendientes = signal(true);
  pendientes = signal<Conduce[]>([]);

  /** DE3 — mismo detalle que ya cuenta el badge del Home (fuente única). */
  private detalle = computed(() => this.badges.detalle()['inventario'] ?? {});
  porRecibir = computed(() => this.detalle()['por_recibir'] ?? 0);
  porDespachar = computed(() => this.detalle()['por_despachar'] ?? 0);
  totalPendientes = computed(() => this.porRecibir() + this.porDespachar());

  /** DE3 — los 3 conduces por recibir más antiguos (los que más esperan). */
  pendientesPreview = computed(() =>
    [...this.pendientes()]
      .sort((a, b) => (a.creado_en ?? a.fecha).localeCompare(b.creado_en ?? b.fecha))
      .slice(0, 3),
  );

  constructor() {
    void this.badges.load();
    void this.cargarPendientes();
  }

  private async cargarPendientes(): Promise<void> {
    this.loadingPendientes.set(true);
    try {
      this.pendientes.set(await this.inventario.conducesPorRecibir());
    } catch {
      /* best-effort: la tarjeta de pendientes es un atajo, no la única forma de entrar a Recibir */
    } finally {
      this.loadingPendientes.set(false);
    }
  }

  go(path: string): void {
    void this.router.navigate([path]);
  }
  back(): void {
    this.location.back();
  }
}
