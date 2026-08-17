import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { CronogramaService } from '../../../core/services/cronograma.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  parseCronogramaXlsx,
  actividadToTareaRpc,
  CronogramaImportPreview,
} from '../../../core/util/cronograma-xlsx';

/**
 * AS21 — importar el cronograma de una obra desde un Excel (.xlsx) con el formato
 * CSD (# | ACTIVIDADES | RESPONSABLE | VOLUMETRÍA | FECHA INICIO | FECHA FIN | DÍAS |
 * STATUS | AVANCE REAL % | AVANCE ESPERADO % | RENDIMIENTO). Se parsea en el
 * cliente, se previsualiza el mapeo y, al confirmar, se llama `cronograma_importar`.
 * Los .mpp (MS Project, binarios) NO se soportan aún: se pide exportar a Excel.
 */
@Component({
  selector: 'app-cronograma-importar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cronograma-importar.html',
  styleUrl: './cronograma-importar.scss',
})
export class CronogramaImportarPage {
  private cronograma = inject(CronogramaService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);

  private proyectoId = this.route.snapshot.paramMap.get('id') ?? '';

  archivoNombre = signal<string | null>(null);
  preview = signal<CronogramaImportPreview | null>(null);
  reemplazar = signal(true);
  parseando = signal(false);
  importando = signal(false);
  done = signal<{ creadas: number; reemplazadas: number } | null>(null);

  grupos = computed(() => {
    const p = this.preview();
    if (!p) return [];
    return [...new Set(p.actividades.map((a) => a.grupo).filter((g): g is string => !!g))];
  });

  async onArchivo(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.archivoNombre.set(file.name);
    this.preview.set(null);
    this.done.set(null);
    if (!/\.xlsx$/i.test(file.name)) {
      if (/\.mpp$/i.test(file.name)) {
        this.toast.error('Los archivos .mpp (MS Project) aún no se pueden leer. Expórtalo a Excel (.xlsx) e impórtalo.');
      } else {
        this.toast.error('Elige un archivo Excel (.xlsx).');
      }
      return;
    }
    this.parseando.set(true);
    try {
      const buf = await file.arrayBuffer();
      const preview = parseCronogramaXlsx(buf);
      this.preview.set(preview);
      if (!preview.actividades.length) {
        this.toast.error('No se detectaron actividades en el Excel.');
      }
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo leer el Excel.');
    } finally {
      this.parseando.set(false);
      input.value = ''; // permitir re-seleccionar el mismo archivo
    }
  }

  async confirmar(): Promise<void> {
    const p = this.preview();
    if (!p || !p.actividades.length || this.importando()) return;
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para importar el cronograma.');
      return;
    }
    this.importando.set(true);
    try {
      const tareas = p.actividades.map(actividadToTareaRpc);
      const r = await this.cronograma.importar(this.proyectoId, p.faseNombre, tareas, this.reemplazar());
      this.done.set(r);
      this.toast.success(`Cronograma importado: ${r.creadas} actividad(es).`);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo importar el cronograma.');
    } finally {
      this.importando.set(false);
    }
  }

  verCronograma(): void {
    void this.router.navigate(['/proyectos', this.proyectoId, 'cronograma']);
  }

  back(): void {
    this.location.back();
  }
}
