import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { SelectOption } from '../../../shared/ui/select-list/select-list';
import { ApoyoService, TipoApoyo, DestinoApoyoTipo } from '../../../core/services/apoyo.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { CameraService, CapturedPhoto } from '../../../core/services/camera.service';
import { ToastService } from '../../../core/services/toast.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';

const TIPOS: Array<{ key: TipoApoyo; icon: string; label: string; glosa: string }> = [
  { key: 'movimiento_interno', icon: '🔀', label: 'Movimiento interno', glosa: 'Mover algo entre obras o al almacén.' },
  { key: 'retiro_material', icon: '📤', label: 'Retiro de material', glosa: 'Sacar material que sobra o no sirve de la obra.' },
  { key: 'bote', icon: '🗑️', label: 'Bote', glosa: 'Llevarse escombros o basura de la obra al vertedero.' },
];

/** Modo de destino para un movimiento interno (destino opcional). */
type DestinoModo = '' | 'obra' | 'almacen' | 'otro';
const DESTINO_MODOS: Array<{ key: DestinoModo; icon: string; label: string }> = [
  { key: '', icon: '🤝', label: 'Que lo decida transporte' },
  { key: 'obra', icon: '🏗️', label: 'Otra obra' },
  { key: 'almacen', icon: '🏢', label: 'Un almacén' },
  { key: 'otro', icon: '📍', label: 'Otro lugar' },
];

const MAX_FOTOS = 4;
const CLAVE_BORRADOR = 'apoyo_transporte';

/**
 * CK11/CK12 — el INGENIERO crea un "Apoyo de transporte" (offline por outbox).
 * Formulario en orden fijo: Tipo → Obra → Día → ¿Qué hay que mover? → Foto(s) →
 * Destino (solo movimiento interno) / casilla dañado (solo retiro). Una sola
 * descripción libre reemplaza el selector de artículos + tipo de carga + prioridad.
 */
@Component({
  selector: 'app-crear-apoyo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, CollapsibleSelect, OptionButton, WizardFooter, TranslatePipe],
  templateUrl: './crear-apoyo.html',
  styleUrl: './crear-apoyo.scss',
})
export class CrearApoyoPage implements OnDestroy {
  private apoyo = inject(ApoyoService);
  private inventario = inject(InventarioService);
  private camera = inject(CameraService);
  private toast = inject(ToastService);
  private ctx = inject(UserContextService);
  private navGuard = inject(NavGuardService);
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);
  private router = inject(Router);
  private location = inject(Location);
  private i18n = inject(I18nService);

  readonly tipos = TIPOS;
  readonly destinoModos = DESTINO_MODOS;
  readonly maxFotos = MAX_FOTOS;
  readonly hoy = new Date().toISOString().slice(0, 10);
  // Iconos de los selectores (en TS para no meter emojis literales en el HTML).
  readonly obraIcon = '🏗️';
  readonly almacenIcon = '🏢';

  tipo = signal<TipoApoyo>('movimiento_interno');
  obraOpts = signal<SelectOption[]>([]);
  proyectoId = signal('');
  dia = signal(this.hoy);
  descripcion = signal('');
  fotos = signal<CapturedPhoto[]>([]);
  capturing = signal(false);

  // Destino (movimiento interno).
  destinoModo = signal<DestinoModo>('');
  destinoProyectoId = signal('');
  bodegaOpts = signal<SelectOption[]>([]);
  destinoBodegaId = signal('');
  destinoTexto = signal('');
  // Retiro de material.
  esDanado = signal(false);

  enviando = signal(false);
  private hydrated = false;

  proyectoNombre = computed(() => this.obraOpts().find((o) => o.id === this.proyectoId())?.label ?? null);

  // El destino solo aplica al movimiento interno; bote/retiro lo fijan server-side.
  mostrarDestino = computed(() => this.tipo() === 'movimiento_interno');
  mostrarDanado = computed(() => this.tipo() === 'retiro_material');

  puedeEnviar = computed(() => {
    const d = this.descripcion().trim();
    return (
      !!this.proyectoId() &&
      d.length >= 3 &&
      d.length <= 1000 &&
      this.fotos().length > 0 &&
      !!this.dia() &&
      !this.enviando()
    );
  });

  private readonly backHandler = (): boolean => {
    if (this.tieneDatos() && !this.enviando()) {
      // Autosave ya guardó; salir no pierde nada. Permite el back normal.
      return false;
    }
    return false;
  };

  constructor() {
    void this.cargarCatalogos();
    void this.restoreDraft();
    this.navGuard.register(this.backHandler);
    // Autoguardado del formulario (las fotos se persisten al capturarlas).
    effect(() => {
      const snap = {
        tipo: this.tipo(),
        proyectoId: this.proyectoId(),
        dia: this.dia(),
        descripcion: this.descripcion(),
        destinoModo: this.destinoModo(),
        destinoProyectoId: this.destinoProyectoId(),
        destinoBodegaId: this.destinoBodegaId(),
        destinoTexto: this.destinoTexto(),
        esDanado: this.esDanado(),
      };
      if (!this.hydrated || this.enviando()) return;
      if (!this.tieneDatos()) return;
      this.autosave.queue(CLAVE_BORRADOR, snap, {
        tipo: 'apoyo_transporte',
        etiqueta: 'Apoyo de transporte',
        ruta: this.location.path(),
      });
    });
  }

  private async cargarCatalogos(): Promise<void> {
    try {
      const obras = await this.inventario.getObrasDestino();
      this.obraOpts.set(obras.map((o) => ({ id: o.id, label: o.nombre })));
      const obra = this.ctx.obraActiva();
      if (obra && !this.proyectoId()) this.proyectoId.set(obra.id);
    } catch {
      /* sin red: el selector queda vacío; reintentar luego */
    }
    try {
      const bodegas = await this.inventario.getBodegas();
      const ord = [...bodegas].sort(
        (a, b) => (b.es_central ? 1 : 0) - (a.es_central ? 1 : 0) || a.nombre.localeCompare(b.nombre),
      );
      this.bodegaOpts.set(ord.map((b) => ({ id: b.id, label: (b.es_central ? 'Central — ' : '') + b.nombre })));
    } catch {
      /* offline: sin almacenes; el movimiento interno puede usar texto */
    }
  }

  private async restoreDraft(): Promise<void> {
    try {
      const d = await this.borrador.load<{
        tipo: TipoApoyo;
        proyectoId: string;
        dia: string;
        descripcion: string;
        destinoModo: DestinoModo;
        destinoProyectoId: string;
        destinoBodegaId: string;
        destinoTexto: string;
        esDanado: boolean;
      }>(CLAVE_BORRADOR);
      if (d) {
        if (d.tipo) this.tipo.set(d.tipo);
        if (d.proyectoId) this.proyectoId.set(d.proyectoId);
        if (d.dia) this.dia.set(d.dia);
        this.descripcion.set(d.descripcion ?? '');
        this.destinoModo.set(d.destinoModo ?? '');
        this.destinoProyectoId.set(d.destinoProyectoId ?? '');
        this.destinoBodegaId.set(d.destinoBodegaId ?? '');
        this.destinoTexto.set(d.destinoTexto ?? '');
        this.esDanado.set(d.esDanado ?? false);
      }
      const fotos = await this.borrador.loadFotos(CLAVE_BORRADOR);
      if (fotos.length) {
        const orden = [...fotos].sort((a, b) => Number(a.slot) - Number(b.slot));
        this.fotos.set(orden.map((f) => ({ blob: f.blob, previewUrl: URL.createObjectURL(f.blob) })));
      }
    } catch {
      /* recuperar el borrador nunca debe impedir abrir la pantalla */
    } finally {
      this.hydrated = true;
    }
  }

  private async persistFotos(): Promise<void> {
    try {
      await this.borrador.clearFotos(CLAVE_BORRADOR);
      const fs = this.fotos();
      for (let i = 0; i < fs.length; i++) await this.borrador.saveFoto(CLAVE_BORRADOR, String(i), fs[i].blob);
    } catch {
      /* persistir la foto nunca debe romper la captura */
    }
  }

  pickTipo(t: TipoApoyo): void {
    this.tipo.set(t);
  }
  pickDestinoModo(m: DestinoModo): void {
    this.destinoModo.set(m);
  }

  // ── Fotos (cámara + galería; ≥1 obligatoria, hasta 4) ──────────────────────
  async addFoto(): Promise<void> {
    if (this.capturing() || this.fotos().length >= MAX_FOTOS) return;
    this.capturing.set(true);
    try {
      const photo = await this.camera.takePhoto();
      if (photo) {
        this.fotos.update((f) => [...f, photo]);
        void this.persistFotos();
      }
    } finally {
      this.capturing.set(false);
    }
  }
  async addDeGaleria(): Promise<void> {
    if (this.capturing() || this.fotos().length >= MAX_FOTOS) return;
    this.capturing.set(true);
    try {
      const faltan = MAX_FOTOS - this.fotos().length;
      const photos = await this.camera.pickFromGallery(faltan);
      if (photos.length) {
        this.fotos.update((f) => [...f, ...photos].slice(0, MAX_FOTOS));
        void this.persistFotos();
      }
    } finally {
      this.capturing.set(false);
    }
  }
  removeFoto(i: number): void {
    const f = this.fotos()[i];
    if (f) URL.revokeObjectURL(f.previewUrl);
    this.fotos.update((l) => l.filter((_, idx) => idx !== i));
    void this.persistFotos();
  }

  private tieneDatos(): boolean {
    return !!this.descripcion().trim() || this.fotos().length > 0 || !!this.proyectoId();
  }

  async enviar(): Promise<void> {
    if (!this.puedeEnviar()) return;
    this.enviando.set(true);
    try {
      const destino = this.resolverDestino();
      await this.apoyo.crear({
        tipoApoyo: this.tipo(),
        proyectoId: this.proyectoId(),
        proyectoNombre: this.proyectoNombre(),
        dia: this.dia(),
        descripcion: this.descripcion().trim(),
        destinoTipo: destino.tipo,
        destinoTexto: destino.texto,
        destinoBodegaId: destino.bodegaId,
        destinoProyectoId: destino.proyectoId,
        esDanado: this.tipo() === 'retiro_material' ? this.esDanado() : false,
        fotos: this.fotos().map((f) => f.blob),
      });
      void this.autosave.discard(CLAVE_BORRADOR);
      for (const f of this.fotos()) URL.revokeObjectURL(f.previewUrl);
      this.fotos.set([]);
      this.toast.success(this.i18n.t('Apoyo enviado. Se sincroniza solo al reconectar.'));
      void this.router.navigate(['/transporte/apoyo'], { replaceUrl: true });
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No pudimos guardar el apoyo. Inténtalo de nuevo.'));
    } finally {
      this.enviando.set(false);
    }
  }

  /** Resuelve el destino según el tipo (bote/retiro lo fijan server-side). */
  private resolverDestino(): {
    tipo: DestinoApoyoTipo | null;
    texto: string | null;
    bodegaId: string | null;
    proyectoId: string | null;
  } {
    if (this.tipo() === 'bote') return { tipo: null, texto: null, bodegaId: null, proyectoId: null };
    if (this.tipo() === 'retiro_material') {
      // Destino por defecto Almacén; el bodega elegido es opcional.
      return { tipo: 'almacen', texto: null, bodegaId: this.destinoBodegaId() || null, proyectoId: null };
    }
    // Movimiento interno.
    switch (this.destinoModo()) {
      case 'obra':
        return { tipo: 'obra', texto: null, bodegaId: null, proyectoId: this.destinoProyectoId() || null };
      case 'almacen':
        return { tipo: 'almacen', texto: null, bodegaId: this.destinoBodegaId() || null, proyectoId: null };
      case 'otro':
        return { tipo: 'otro', texto: this.destinoTexto().trim() || null, bodegaId: null, proyectoId: null };
      default:
        return { tipo: null, texto: null, bodegaId: null, proyectoId: null };
    }
  }

  back(): void {
    this.navGuard.back('/transporte/apoyo');
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
    for (const f of this.fotos()) URL.revokeObjectURL(f.previewUrl);
  }
}
