import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { DatePipe, Location } from '@angular/common';
import { AdminService, ConteoRow } from '../../../core/services/admin.service';

/** Read-only history of physical counts / stock adjustments. */
@Component({
  selector: 'app-admin-conteos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, DatePipe],
  templateUrl: './conteos.html',
  styleUrl: '../unidades/unidades.scss',
})
export class AdminConteosPage {
  private admin = inject(AdminService);
  private location = inject(Location);

  conteos = signal<ConteoRow[]>([]);
  loading = signal(true);
  expandedId = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.conteos.set(await this.admin.getConteos());
    } finally {
      this.loading.set(false);
    }
  }

  toggle(id: string): void {
    this.expandedId.set(this.expandedId() === id ? null : id);
  }

  back(): void {
    this.location.back();
  }
}
