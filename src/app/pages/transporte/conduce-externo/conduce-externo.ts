import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { LugarPicker, LugarSel } from '../../../shared/ui/lugar-picker/lugar-picker';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { ConducesService, ProveedorTransporte, ConduceExternoLugar } from '../../../core/services/conduces.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { CapturedPhoto } from '../../../core/services/camera.service';

/** Proveedor elegido: del catálogo (id) o texto libre «Otro» (sin registrar aún). */
interface ProveedorElegido {
  id: string | null;
  texto: string | null;
  nombre: string;
}

/**
 * BA/Transporte v3 (FASE 1) — Conduce externo: un PROVEEDOR transporta (manda su
 * camión). Formulario corto de obra: quién transporta, foto(s) de placa + carga
 * (obligatoria la placa), qué mueve, origen→destino («Otros» incluido). Offline-safe
 * vía outbox; el viaje al proveedor lo registra el servidor al emitir.
 */
@Component({
  selector: 'app-conduce-externo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PhotoSlot, LugarPicker, SyncBar],
  templateUrl: './conduce-externo.html',
  styleUrl: './conduce-externo.scss',
})
export class ConduceExternoPage {
  private conduces = inject(ConducesService);
  private net = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);

  // Proveedores
  proveedores = signal<ProveedorTransporte[]>([]);
  busquedaProv = signal('');
  proveedorSel = signal<ProveedorElegido | null>(null);
  modoOtroProv = signal(false);
  nombreOtro = signal('');
  telOtro = signal('');
  creandoProv = signal(false);

  // Fotos
  placaFoto = signal<CapturedPhoto | null>(null);
  cargaFoto = signal<CapturedPhoto | null>(null);

  // Material (descripción libre; los items del catálogo son un follow-up)
  materialDesc = signal('');

  // Origen / destino
  origen = signal<LugarSel | null>(null);
  destino = signal<LugarSel | null>(null);

  guardando = signal(false);
  error = signal('');
  exito = signal<string | null>(null);

  get online(): boolean {
    return this.net.online();
  }

  proveedoresFiltrados = computed(() => {
    const q = this.busquedaProv().trim().toLowerCase();
    const base = this.proveedores();
    if (!q) return base.slice(0, 12);
    return base.filter((p) => p.nombre.toLowerCase().includes(q)).slice(0, 12);
  });

  puedeEmitir = computed(() => !!this.proveedorSel() && !!this.placaFoto() && !this.guardando());

  constructor() {
    void this.cargarProveedores();
  }

  private async cargarProveedores(): Promise<void> {
    try {
      this.proveedores.set(await this.conduces.proveedoresTransporte());
    } catch {
      /* offline: el catálogo cae vacío; el usuario usa «Otro» */
    }
  }

  elegirProveedor(p: ProveedorTransporte): void {
    this.proveedorSel.set({ id: p.id, texto: null, nombre: p.nombre });
    this.modoOtroProv.set(false);
  }

  quitarProveedor(): void {
    this.proveedorSel.set(null);
  }

  abrirOtroProv(): void {
    this.modoOtroProv.set(true);
    if (this.busquedaProv().trim() && !this.nombreOtro().trim()) this.nombreOtro.set(this.busquedaProv().trim());
  }

  /** «Otro» sin registrar: viaja como texto (Raykler lo formaliza/absorbe luego). */
  usarOtroTexto(): void {
    const nombre = this.nombreOtro().trim();
    if (!nombre) return;
    this.proveedorSel.set({ id: null, texto: nombre, nombre });
    this.modoOtroProv.set(false);
  }

  /** Alta al vuelo (online): crea el proveedor formal (sin ratificar) y lo elige. */
  async crearProveedor(): Promise<void> {
    const nombre = this.nombreOtro().trim();
    if (!nombre) return;
    if (!this.online) {
      this.toast.error('Sin conexión: se usará el nombre como texto. Raykler lo registrará luego.');
      this.usarOtroTexto();
      return;
    }
    this.creandoProv.set(true);
    try {
      const id = await this.conduces.crearProveedorTransporte(nombre, this.telOtro());
      this.proveedorSel.set({ id, texto: null, nombre });
      this.modoOtroProv.set(false);
      this.nombreOtro.set('');
      this.telOtro.set('');
      void this.cargarProveedores();
    } catch {
      // Falla el alta → no trancar: usa el texto y sigue.
      this.toast.error('No se pudo registrar el proveedor; se usará como texto.');
      this.usarOtroTexto();
    } finally {
      this.creandoProv.set(false);
    }
  }

  onOrigen(l: LugarSel | null): void {
    this.origen.set(l);
  }
  onDestino(l: LugarSel | null): void {
    this.destino.set(l);
  }

  private aLugar(l: LugarSel | null): ConduceExternoLugar | null {
    if (!l) return null;
    return {
      nombre: l.nombre,
      lat: l.lat ?? null,
      lng: l.lng ?? null,
      proyecto_id: l.proyecto_id ?? null,
      bodega_id: l.bodega_id ?? null,
    };
  }

  async emitir(): Promise<void> {
    const prov = this.proveedorSel();
    const placa = this.placaFoto();
    if (!prov || !placa) {
      this.error.set('Indica quién transporta y toma la foto de la placa.');
      return;
    }
    this.guardando.set(true);
    this.error.set('');
    try {
      await this.conduces.crearConduceExterno({
        transportaProveedorId: prov.id,
        transportaTexto: prov.texto,
        placaFoto: placa.blob,
        cargaFoto: this.cargaFoto()?.blob ?? null,
        materialDescripcion: this.materialDesc().trim() || null,
        items: null,
        origen: this.aLugar(this.origen()),
        destino: this.aLugar(this.destino()),
      });
      this.exito.set(prov.nombre);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo emitir el conduce externo.');
    } finally {
      this.guardando.set(false);
    }
  }

  nuevo(): void {
    this.proveedorSel.set(null);
    this.busquedaProv.set('');
    this.nombreOtro.set('');
    this.telOtro.set('');
    this.placaFoto.set(null);
    this.cargaFoto.set(null);
    this.materialDesc.set('');
    this.origen.set(null);
    this.destino.set(null);
    this.error.set('');
    this.exito.set(null);
  }

  back(): void {
    this.location.back();
  }

  irAlHub(): void {
    void this.router.navigate(['/transporte/conduces-hub']);
  }
}
