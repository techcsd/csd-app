import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { AdminService, Parametro } from '../../../core/services/admin.service';
import { ToastService } from '../../../core/services/toast.service';

/** AL2 — Administración › Parámetros: edición del valor de cada parámetro del
 *  sistema (sgc.parametros). Escritura directa (RLS is_admin). */
@Component({
  selector: 'app-admin-parametros',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState],
  templateUrl: './parametros.html',
  styleUrl: './parametros.scss',
})
export class AdminParametrosPage {
  private admin = inject(AdminService);
  private toast = inject(ToastService);
  private location = inject(Location);

  loading = signal(true);
  parametros = signal<Parametro[]>([]);
  busqueda = signal('');
  valores = signal<Record<string, string>>({});
  guardando = signal('');

  filtrados = computed(() => {
    const q = this.busqueda().trim().toLowerCase();
    if (!q) return this.parametros();
    return this.parametros().filter((p) => `${p.clave} ${p.descripcion ?? ''}`.toLowerCase().includes(q));
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const ps = await this.admin.getParametros();
      this.parametros.set(ps);
      const v: Record<string, string> = {};
      for (const p of ps) v[p.clave] = p.valor ?? '';
      this.valores.set(v);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No pudimos cargar los parámetros.');
    } finally {
      this.loading.set(false);
    }
  }

  setValor(clave: string, valor: string): void {
    this.valores.update((m) => ({ ...m, [clave]: valor }));
  }
  cambiado(p: Parametro): boolean {
    return (this.valores()[p.clave] ?? '') !== (p.valor ?? '');
  }

  async guardar(p: Parametro): Promise<void> {
    if (this.guardando()) return;
    this.guardando.set(p.clave);
    try {
      await this.admin.updateParametro(p.clave, this.valores()[p.clave] ?? '');
      this.parametros.update((list) => list.map((x) => (x.clave === p.clave ? { ...x, valor: this.valores()[p.clave] } : x)));
      this.toast.success('Parámetro guardado.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.guardando.set('');
    }
  }

  back(): void {
    this.location.back();
  }
}
