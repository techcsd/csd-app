import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { DemoTabs } from '../../../shared/components/demo-tabs/demo-tabs';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

interface DemoObra { id: string; codigo: string; nombre: string; }
interface DemoAlmacen { id: string; nombre: string; proyecto_id: string | null; }
interface DemoArticulo { id: string; codigo: string; nombre: string; unidad: string; }
interface DemoVehiculo { id: string; placa: string; marca: string; modelo: string; tipo: string; }
interface DemoChofer { id: string; nombre: string; }

interface DemoCatalogo {
  obras: DemoObra[];
  almacenes: DemoAlmacen[];
  articulos: DemoArticulo[];
  vehiculos: DemoVehiculo[];
  choferes: DemoChofer[];
}

const CATALOGO_VACIO: DemoCatalogo = { obras: [], almacenes: [], articulos: [], vehiculos: [], choferes: [] };

/**
 * DG5 — "Escenarios" (módulo Demo, app): vista de solo lectura de los datos de
 * demostración reales (OBRA DEMO y sus artículos/vehículos/choferes DEMO-*), para
 * que el usuario sepa qué hay disponible para practicar. Reutiliza la RPC
 * `sgc.demo_catalogo()` (misma del espejo web, ya desplegada en dev — SECURITY
 * DEFINER, filtra es_prueba=true explícitamente): no hace falta backend nuevo.
 */
@Component({
  selector: 'app-demo-escenarios',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, DemoTabs, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './demo-escenarios.html',
  styleUrl: './demo-escenarios.scss',
})
export class DemoEscenariosPage implements OnInit {
  private supabase = inject(SupabaseService);
  private i18n = inject(I18nService);
  private location = inject(Location);

  cargando = signal(true);
  error = signal('');
  catalogo = signal<DemoCatalogo>(CATALOGO_VACIO);

  async ngOnInit(): Promise<void> {
    try {
      const { data, error } = await this.supabase.client.rpc('demo_catalogo');
      if (error) throw new Error(error.message);
      this.catalogo.set({ ...CATALOGO_VACIO, ...(data as Partial<DemoCatalogo>) });
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : this.i18n.t('No se pudieron cargar los escenarios de demostración.'));
    } finally {
      this.cargando.set(false);
    }
  }

  nombreObra(proyectoId: string | null): string {
    if (!proyectoId) return '—';
    return this.catalogo().obras.find((o) => o.id === proyectoId)?.nombre ?? '—';
  }

  back(): void {
    this.location.back();
  }
}
