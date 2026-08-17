import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { LocationPicker, UbicacionSeleccionada } from '../../../shared/ui/location-picker/location-picker';
import { InventarioService } from '../../../core/services/inventario.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { BodegaAdmin, BodegaUbicacion } from '../../../core/models/inventario.model';
import { homologarTexto } from '../../../core/util/texto';

type ModoUbic = 'obra' | 'propia';

/**
 * Gestión de almacenes desde la app (R12) — paridad con la web. CRUD directo
 * (RLS exige módulo inventario, igual que la web). Es pantalla de configuración,
 * por eso requiere conexión. La homologación del nombre la garantiza el trigger
 * de BD; aquí se previsualiza en el form (R18).
 */
@Component({
  selector: 'app-almacenes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, ConfirmDialog, CollapsibleSelect, LocationPicker],
  templateUrl: './almacenes.html',
  styleUrl: './almacenes.scss',
})
export class AlmacenesPage {
  private inventario = inject(InventarioService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private location = inject(Location);
  private router = inject(Router);

  /** AP2 — abre el inventario (artículos + kardex) de este almacén. */
  verInventario(b: BodegaAdmin): void {
    void this.router.navigate(['/inventario/almacen', b.id]);
  }

  loading = signal(true);
  bodegas = signal<BodegaAdmin[]>([]);

  // Form state.
  formOpen = signal(false);
  editId = signal<string | null>(null);
  nombre = signal('');
  ubicacion = signal('');
  descripcion = signal('');
  saving = signal(false);

  // AS12 — ubicación del almacén: vinculada a una obra o propia (mapa/coordenadas).
  modoUbic = signal<ModoUbic>('obra');
  obras = signal<{ id: string; nombre: string; latitud: number | null; longitud: number | null }[]>([]);
  obraId = signal('');
  latSel = signal<number | null>(null);
  lngSel = signal<number | null>(null);
  direccionSel = signal<string | null>(null);
  obraOpciones = () => this.obras().map((o) => ({ id: o.id, label: o.nombre }));

  // Deactivate confirm.
  confirmId = signal<string | null>(null);

  constructor() {
    void this.load();
    void this.inventario
      .getProyectosConUbicacion()
      .then((os) => this.obras.set(os))
      .catch(() => {});
  }

  // ── AS12 — ubicación ────────────────────────────────────────────────────────
  setModoUbic(m: ModoUbic): void {
    this.modoUbic.set(m);
  }

  onObraElegida(id: string): void {
    this.obraId.set(id);
    const o = this.obras().find((x) => x.id === id);
    // Hereda la ubicación de la obra (si la tiene) para el mapa.
    this.latSel.set(o?.latitud ?? null);
    this.lngSel.set(o?.longitud ?? null);
    this.direccionSel.set(o?.nombre ?? null);
  }

  onUbicacion(u: UbicacionSeleccionada): void {
    this.latSel.set(u.latitud);
    this.lngSel.set(u.longitud);
    this.direccionSel.set(u.direccion);
  }

  /** AS12 — arma el payload de ubicación según el modo elegido. */
  private ubicacionPayload(): BodegaUbicacion {
    if (this.modoUbic() === 'obra') {
      return {
        proyecto_id: this.obraId() || null,
        latitud: this.latSel(),
        longitud: this.lngSel(),
        direccion_geo: this.direccionSel(),
        ubicacion_hereda_proyecto: !!this.obraId(),
        ubicacion_metodo: 'obra',
      };
    }
    return {
      proyecto_id: null,
      latitud: this.latSel(),
      longitud: this.lngSel(),
      direccion_geo: this.direccionSel(),
      ubicacion_hereda_proyecto: false,
      ubicacion_metodo: 'mapa',
    };
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.bodegas.set(await this.inventario.getBodegasAdmin());
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudieron cargar los almacenes.');
    } finally {
      this.loading.set(false);
    }
  }

  nuevo(): void {
    if (!this.online) {
      this.toast.error('Necesitas conexión para gestionar almacenes.');
      return;
    }
    this.editId.set(null);
    this.nombre.set('');
    this.ubicacion.set('');
    this.descripcion.set('');
    this.modoUbic.set('obra');
    this.obraId.set('');
    this.latSel.set(null);
    this.lngSel.set(null);
    this.direccionSel.set(null);
    this.formOpen.set(true);
  }

  editar(b: BodegaAdmin): void {
    if (!this.online) {
      this.toast.error('Necesitas conexión para gestionar almacenes.');
      return;
    }
    this.editId.set(b.id);
    this.nombre.set(b.nombre);
    this.ubicacion.set(b.ubicacion ?? '');
    this.descripcion.set(b.descripcion ?? '');
    // AS12 — sembrar el editor de ubicación.
    this.modoUbic.set(b.proyecto_id ? 'obra' : 'propia');
    this.obraId.set(b.proyecto_id ?? '');
    this.latSel.set(b.latitud ?? null);
    this.lngSel.set(b.longitud ?? null);
    this.direccionSel.set(b.direccion_geo ?? null);
    this.formOpen.set(true);
  }

  cancelar(): void {
    this.formOpen.set(false);
  }

  /** Live preview of the server-side homologation (first letter uppercase). */
  onNombre(v: string): void {
    this.nombre.set(v);
  }

  get nombrePreview(): string {
    return homologarTexto(this.nombre());
  }

  async guardar(): Promise<void> {
    if (this.saving()) return;
    const nombre = homologarTexto(this.nombre());
    if (!nombre) {
      this.toast.error('Escribe el nombre del almacén.');
      return;
    }
    this.saving.set(true);
    try {
      const payload = {
        nombre,
        ubicacion: this.ubicacion().trim() || null,
        descripcion: this.descripcion().trim() || null,
        location: this.ubicacionPayload(), // AS12
      };
      if (this.editId()) {
        await this.inventario.actualizarBodega(this.editId()!, payload);
        this.toast.success('Almacén actualizado.');
      } else {
        await this.inventario.crearBodega(payload);
        this.toast.success('Almacén creado.');
      }
      this.formOpen.set(false);
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  pedirDesactivar(b: BodegaAdmin): void {
    if (!this.online) {
      this.toast.error('Necesitas conexión para gestionar almacenes.');
      return;
    }
    this.confirmId.set(b.id);
  }

  async toggleActivo(b: BodegaAdmin): Promise<void> {
    this.confirmId.set(null);
    if (!this.online) {
      this.toast.error('Necesitas conexión para gestionar almacenes.');
      return;
    }
    try {
      await this.inventario.setBodegaActivo(b.id, !b.activo);
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo actualizar.');
    }
  }

  cancelarConfirm(): void {
    this.confirmId.set(null);
  }

  back(): void {
    this.location.back();
  }

  get online(): boolean {
    return this.network.online();
  }
}
