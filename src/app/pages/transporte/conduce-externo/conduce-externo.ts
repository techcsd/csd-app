import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { LugarPicker, LugarSel } from '../../../shared/ui/lugar-picker/lugar-picker';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { ConducesService, ProveedorTransporte, ConduceExternoLugar } from '../../../core/services/conduces.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { humanizeError } from '../../../shared/util/friendly-error.util';

/** Proveedor elegido: del catálogo (id) o texto libre «Otro» (sin registrar aún). */
interface ProveedorElegido {
  id: string | null;
  texto: string | null;
  nombre: string;
}

/** BT4 — forma persistida del borrador (las fotos van aparte en `borrador_fotos`). */
interface ConduceExternoBorrador {
  prov: ProveedorElegido | null;
  materialDesc: string;
  origen: LugarSel | null;
  destino: LugarSel | null;
}

/**
 * BA/Transporte v3 (FASE 1) — Conduce externo: un PROVEEDOR transporta (manda su
 * camión). Formulario corto de obra: quién transporta, foto(s) de placa + carga
 * (obligatoria la placa), qué mueve, origen→destino («Otros» incluido). Offline-safe
 * vía outbox; el viaje al proveedor lo registra el servidor al emitir.
 *
 * BT4 — autoguarda un BORRADOR (formulario + fotos ya tomadas) en cada cambio y al
 * ocultar/descargar la pestaña. Si la app se cierra (Safari mata la pestaña por
 * memoria, Android recrea la Activity al volver de la cámara) NADA se pierde: al
 * reabrir aparece el aviso "Tienes un borrador sin enviar — Continuar / Descartar".
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
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);

  /** Una sola captura activa a la vez → clave fija. */
  private readonly clave = 'conduce_externo';

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

  // BT4 — recuperación de borrador.
  borradorPrevio = signal(false);
  private hydrated = false;

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
    void this.restoreDraft();
    // BT4 — autoguardado del formulario (las fotos se guardan al capturarlas).
    effect(() => {
      const snap: ConduceExternoBorrador = {
        prov: this.proveedorSel(),
        materialDesc: this.materialDesc(),
        origen: this.origen(),
        destino: this.destino(),
      };
      if (!this.hydrated || this.guardando() || this.exito()) return;
      // Solo guarda si hay algo que valga la pena recuperar.
      if (!this.tieneDatos()) return;
      this.autosave.queue(this.clave, snap, {
        tipo: 'conduce_externo',
        etiqueta: 'Conduce externo',
        ruta: this.location.path(),
      });
    });
  }

  private async cargarProveedores(): Promise<void> {
    try {
      this.proveedores.set(await this.conduces.proveedoresTransporte());
    } catch {
      /* offline: el catálogo cae vacío; el usuario usa «Otro» */
    }
  }

  /** BT4 — recupera el borrador (formulario + fotos) tras un cierre/kill. */
  private async restoreDraft(): Promise<void> {
    try {
      const d = await this.borrador.load<ConduceExternoBorrador>(this.clave);
      if (d) {
        this.proveedorSel.set(d.prov ?? null);
        this.materialDesc.set(d.materialDesc ?? '');
        this.origen.set(d.origen ?? null);
        this.destino.set(d.destino ?? null);
      }
      // BT4 — las fotos se cargan SIEMPRE (aunque no haya fila de datos): el usuario
      // pudo tomar solo una foto y cerrar la app antes de tocar el formulario.
      const fotos = await this.borrador.loadFotos(this.clave);
      for (const f of fotos) {
        const foto: CapturedPhoto = { blob: f.blob, previewUrl: URL.createObjectURL(f.blob) };
        if (f.slot === 'placa') this.placaFoto.set(foto);
        else if (f.slot === 'carga') this.cargaFoto.set(foto);
      }
      if (this.tieneDatos()) this.borradorPrevio.set(true);
    } catch {
      /* recuperar el borrador nunca debe impedir abrir la pantalla */
    } finally {
      this.hydrated = true;
    }
  }

  /** BT4 — asegura que exista fila de borrador (aunque el formulario esté vacío) al
   *  tomar una foto, para que "Documentación en proceso" lo liste y se recupere. */
  private tocarBorrador(): void {
    this.autosave.queue(
      this.clave,
      { prov: this.proveedorSel(), materialDesc: this.materialDesc(), origen: this.origen(), destino: this.destino() },
      { tipo: 'conduce_externo', etiqueta: 'Conduce externo', ruta: this.location.path() },
    );
  }

  private tieneDatos(): boolean {
    return (
      !!this.proveedorSel() ||
      !!this.placaFoto() ||
      !!this.cargaFoto() ||
      !!this.materialDesc().trim() ||
      !!this.origen() ||
      !!this.destino()
    );
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

  // ── Fotos (BT4/BT5: persisten al instante; se libera la URL anterior) ────────

  onPlaca(foto: CapturedPhoto): void {
    this.revoke(this.placaFoto());
    this.placaFoto.set(foto);
    void this.borrador.saveFoto(this.clave, 'placa', foto.blob);
    this.tocarBorrador();
  }
  quitarPlaca(): void {
    this.revoke(this.placaFoto());
    this.placaFoto.set(null);
    void this.borrador.removeFoto(this.clave, 'placa');
  }
  onCarga(foto: CapturedPhoto): void {
    this.revoke(this.cargaFoto());
    this.cargaFoto.set(foto);
    void this.borrador.saveFoto(this.clave, 'carga', foto.blob);
    this.tocarBorrador();
  }
  quitarCarga(): void {
    this.revoke(this.cargaFoto());
    this.cargaFoto.set(null);
    void this.borrador.removeFoto(this.clave, 'carga');
  }

  onOrigen(l: LugarSel | null): void {
    this.origen.set(l);
  }
  onDestino(l: LugarSel | null): void {
    this.destino.set(l);
  }

  // ── Borrador: banner ─────────────────────────────────────────────────────────

  continuarBorrador(): void {
    this.borradorPrevio.set(false);
  }

  descartarBorrador(): void {
    // Confirmación simple (evita borrar por accidente lo capturado).
    this.toast.withAction('¿Descartar el borrador sin enviar?', {
      label: 'Descartar',
      run: () => {
        this.revoke(this.placaFoto());
        this.revoke(this.cargaFoto());
        void this.autosave.discard(this.clave);
        this.resetCampos();
        this.borradorPrevio.set(false);
        this.toast.show('Borrador descartado.', 'info');
      },
    });
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

  /**
   * BT7 — ¿el proveedor del catálogo sigue vigente? Se pudo borrar/fusionar desde
   * que se cacheó (esa era la causa del error crudo de FK en el conduce). Refresca
   * el catálogo (read-through) y comprueba el id. Offline / sin poder verificar →
   * devuelve true (no bloquea; el servidor valida y, si no, se muestra "Revisar
   * dato" en Pendientes con el mensaje amable del servidor).
   */
  private async proveedorVigente(id: string): Promise<boolean> {
    try {
      const lista = await this.conduces.proveedoresTransporte();
      if (!lista.length) return true; // sin catálogo (offline): no bloquear
      return lista.some((p) => p.id === id);
    } catch {
      return true;
    }
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
      let provId = prov.id;
      let provTexto = prov.texto;
      // BT7 — si eligió un proveedor del catálogo pero ya no existe, lo enviamos como
      // TEXTO (su nombre) para que el conduce NO muera por un id colgado. Se avisa.
      if (provId && !(await this.proveedorVigente(provId))) {
        provId = null;
        provTexto = prov.nombre;
        this.toast.show('Ese proveedor ya no está en la lista; se envía por su nombre.', 'info', 4000);
      }
      await this.conduces.crearConduceExterno({
        transportaProveedorId: provId,
        transportaTexto: provTexto,
        placaFoto: placa.blob,
        cargaFoto: this.cargaFoto()?.blob ?? null,
        materialDescripcion: this.materialDesc().trim() || null,
        items: null,
        origen: this.aLugar(this.origen()),
        destino: this.aLugar(this.destino()),
      });
      await this.autosave.discard(this.clave); // limpia formulario + fotos del borrador
      this.borradorPrevio.set(false);
      this.exito.set(prov.nombre);
    } catch (e) {
      this.error.set(e instanceof Error ? humanizeError(e).mensaje : 'No se pudo emitir el conduce externo.');
    } finally {
      this.guardando.set(false);
    }
  }

  private resetCampos(): void {
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
  }

  nuevo(): void {
    // Éxito → limpiar todo (el borrador ya se descartó al emitir).
    this.revoke(this.placaFoto());
    this.revoke(this.cargaFoto());
    this.resetCampos();
    this.exito.set(null);
  }

  private revoke(f: CapturedPhoto | null): void {
    if (f?.previewUrl) {
      try {
        URL.revokeObjectURL(f.previewUrl);
      } catch {
        /* ignore */
      }
    }
  }

  back(): void {
    // El borrador sigue guardado (autosave); asegura el flush antes de salir.
    void this.autosave.flushAll();
    this.location.back();
  }

  irAlHub(): void {
    void this.router.navigate(['/transporte/conduces-hub']);
  }
}
