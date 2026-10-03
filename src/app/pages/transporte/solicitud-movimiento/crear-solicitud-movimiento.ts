import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { SelectOption } from '../../../shared/ui/select-list/select-list';
import {
  SolicitudMovimientoService,
  PrioridadSolicitud,
  TipoCarga,
  DireccionMovimiento,
  MovimientoItem,
} from '../../../core/services/solicitud-movimiento.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { ArticuloCat } from '../../../core/models/inventario.model';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';

const TIPOS_CARGA: Array<{ key: TipoCarga; label: string }> = [
  { key: 'materiales', label: 'Materiales' },
  { key: 'equipo', label: 'Equipo' },
  { key: 'otros', label: 'Otros' },
];
const DIRECCIONES: Array<{ key: DireccionMovimiento; label: string }> = [
  { key: 'a_obra', label: 'Llevar a la obra' },
  { key: 'de_obra', label: 'Sacar de la obra' },
];
interface RenglonUI {
  articuloId: string;       // uuid o '' (no catalogado)
  descripcion: string;
  cantidad: number | null;
  unidad: string;
  noCat: boolean;           // modo "no está en el catálogo"
}

const PRIORIDADES: Array<{ key: PrioridadSolicitud; label: string; tone: 'default' | 'success' | 'warning' | 'error' }> = [
  { key: 'baja', label: 'Baja', tone: 'success' },
  { key: 'media', label: 'Media', tone: 'default' },
  { key: 'alta', label: 'Alta', tone: 'warning' },
  { key: 'urgente', label: 'Urgente', tone: 'error' },
];

/**
 * AY11 — el INGENIERO crea una Solicitud de movimiento (offline por outbox). Pide
 * al departamento de transporte mover material/equipo entre puntos, con prioridad y
 * fecha de requerimiento. El referente la ve en su bandeja y la planifica.
 */
@Component({
  selector: 'app-crear-solicitud-movimiento',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, CollapsibleSelect, OptionButton, WizardFooter, TranslatePipe],
  templateUrl: './crear-solicitud-movimiento.html',
  styleUrl: './crear-solicitud-movimiento.scss',
})
export class CrearSolicitudMovimientoPage {
  private solicitudes = inject(SolicitudMovimientoService);
  private inventario = inject(InventarioService);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private i18n = inject(I18nService);

  readonly tipos = TIPOS_CARGA;
  readonly direcciones = DIRECCIONES;
  readonly prioridades = PRIORIDADES;

  obraOpts = signal<SelectOption[]>([]);
  proyectoId = signal('');
  direccion = signal<DireccionMovimiento>('a_obra');
  // CF5 — el "otro extremo" como ALMACÉN (Central primero) o, si no, texto libre.
  bodegaOpts = signal<SelectOption[]>([]);
  otroBodegaId = signal('');
  otroEsTexto = signal(false);
  otroPunto = signal('');
  // CF5 — renglones del catálogo (cacheado offline) o "no catalogado".
  articulos = signal<ArticuloCat[]>([]);
  renglones = signal<RenglonUI[]>([{ articuloId: '', descripcion: '', cantidad: null, unidad: '', noCat: false }]);
  tipoCarga = signal<TipoCarga>('materiales');
  prioridad = signal<PrioridadSolicitud>('media');
  fechaReq = signal('');
  notas = signal('');
  enviando = signal(false);

  // Opciones del picker de artículos (nombre + código).
  articuloOpts = computed<SelectOption[]>(() =>
    this.articulos().map((a) => ({ id: a.id, label: a.codigo ? `${a.nombre} (${a.codigo})` : a.nombre })),
  );

  // Renglones válidos (con artículo o con descripción escrita).
  renglonesValidos = computed(() =>
    this.renglones().filter((r) => r.articuloId || r.descripcion.trim()),
  );

  agregarRenglon(): void {
    this.renglones.update((r) => [...r, { articuloId: '', descripcion: '', cantidad: null, unidad: '', noCat: false }]);
  }
  quitarRenglon(i: number): void {
    this.renglones.update((r) => (r.length > 1 ? r.filter((_, idx) => idx !== i) : r));
  }
  pickArticulo(i: number, id: string): void {
    const art = this.articulos().find((a) => a.id === id);
    this.renglones.update((r) => r.map((it, idx) => idx === i
      ? { ...it, articuloId: id, descripcion: art?.nombre ?? it.descripcion, unidad: art?.unidad ?? it.unidad }
      : it));
  }
  toggleNoCat(i: number): void {
    this.renglones.update((r) => r.map((it, idx) => idx === i
      ? { ...it, noCat: !it.noCat, articuloId: '' } : it));
  }
  setRenglon(i: number, campo: 'descripcion' | 'unidad', v: string): void {
    this.renglones.update((r) => r.map((it, idx) => idx === i ? { ...it, [campo]: v } : it));
  }
  setCantidad(i: number, v: string): void {
    const n = v === '' ? null : Number(v);
    this.renglones.update((r) => r.map((it, idx) => idx === i ? { ...it, cantidad: Number.isFinite(n as number) ? n : null } : it));
  }

  /** Etiqueta del "otro extremo" según la dirección (para el placeholder/label). */
  otroLabel = computed(() =>
    this.direccion() === 'a_obra' ? this.i18n.t('¿De dónde sale el material?') : this.i18n.t('¿A dónde va el material?'),
  );

  puedeEnviar = computed(
    () => !!this.proyectoId() && this.renglonesValidos().length > 0 && !this.enviando(),
  );

  constructor() {
    void this.cargarCatalogos();
  }

  private async cargarCatalogos(): Promise<void> {
    try {
      const obras = await this.inventario.getObrasDestino();
      this.obraOpts.set(obras.map((o) => ({ id: o.id, label: o.nombre })));
    } catch { /* sin red: el selector queda vacío; reintentar luego */ }
    try {
      // CF5 — almacenes con el Central primero (luego por nombre).
      const bodegas = await this.inventario.getBodegas();
      const ord = [...bodegas].sort((a, b) =>
        (b.es_central ? 1 : 0) - (a.es_central ? 1 : 0) || a.nombre.localeCompare(b.nombre));
      this.bodegaOpts.set(ord.map((b) => ({ id: b.id, label: (b.es_central ? 'Central — ' : '') + b.nombre })));
    } catch { /* offline: sin almacenes; usa texto libre */ }
    try {
      this.articulos.set(await this.inventario.getArticulos());
    } catch { /* offline sin caché: renglón "no catalogado" por texto */ }
  }

  /** CF5 — resumen legible de los renglones (fallback de que_se_mueve). */
  private resumenItems(items: MovimientoItem[]): string {
    return items
      .map((r) => [r.cantidad ?? '', r.unidad ?? '', r.descripcion].filter(Boolean).join(' ').trim())
      .filter(Boolean)
      .join(', ');
  }

  async enviar(): Promise<void> {
    if (!this.puedeEnviar()) return;
    this.enviando.set(true);
    try {
      const items: MovimientoItem[] = this.renglonesValidos().map((r) => ({
        articulo_id: r.noCat ? null : (r.articuloId || null),
        descripcion: r.descripcion.trim(),
        cantidad: r.cantidad,
        unidad: r.unidad.trim() || null,
      }));
      await this.solicitudes.crear({
        proyectoId: this.proyectoId(),
        direccion: this.direccion(),
        otroPunto: this.otroEsTexto() ? this.otroPunto().trim() : '',
        otroBodegaId: this.otroEsTexto() ? null : (this.otroBodegaId() || null),
        items,
        queSeMueve: this.resumenItems(items),
        tipoCarga: this.tipoCarga(),
        prioridad: this.prioridad(),
        fechaRequerimiento: this.fechaReq() || null,
        notas: this.notas().trim() || null,
      });
      this.toast.success(this.i18n.t('Solicitud enviada. Se sincroniza sola al reconectar.'));
      void this.router.navigate(['/transporte/solicitudes-movimiento']);
    } catch {
      this.toast.error(this.i18n.t('No pudimos guardar la solicitud. Inténtalo de nuevo.'));
    } finally {
      this.enviando.set(false);
    }
  }

  back(): void {
    this.navGuard.back('/transporte/solicitudes-movimiento');
  }
}
