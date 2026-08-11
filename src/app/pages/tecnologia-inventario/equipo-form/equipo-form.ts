import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { WizardExit } from '../../../shared/ui/wizard-exit/wizard-exit';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { CameraService, CapturedPhoto } from '../../../core/services/camera.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { Bodega } from '../../../core/models/inventario.model';
import { TecnologiaService } from '../../../core/services/tecnologia.service';
import { TecTipo, TecEstado, TEC_ESTADO_LABEL } from '../../../core/models/tecnologia.model';
import { ToastService } from '../../../core/services/toast.service';

interface FotoItem {
  key: string; // path (existente) o uuid (nueva)
  path?: string; // storage path (existente)
  blob?: Blob; // captura nueva
  previewUrl: string;
}

const TOTAL = 6;

/**
 * AL2 — Alta/edición de un equipo tecnológico POR HOJAS: datos → tipo → ubicación
 * → precio+moneda → multi-fotos con portada → resumen. Offline por outbox.
 */
@Component({
  selector: 'app-tec-equipo-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, StepBar, WizardFooter, WizardExit, ConfirmDialog, OptionButton, CollapsibleSelect, BigConfirm],
  templateUrl: './equipo-form.html',
  styleUrl: './equipo-form.scss',
})
export class TecEquipoFormPage implements OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private navGuard = inject(NavGuardService);
  private camera = inject(CameraService);
  private inventario = inject(InventarioService);
  private tec = inject(TecnologiaService);
  private toast = inject(ToastService);
  private location = inject(Location);

  readonly total = TOTAL;
  readonly estados = Object.entries(TEC_ESTADO_LABEL) as [TecEstado, string][];

  equipoId = signal<string | null>(null); // edición
  loading = signal(true);
  step = signal(1);
  submitting = signal(false);
  done = signal(false);
  confirmSalir = signal(false);

  // Datos
  nombre = signal('');
  marca = signal('');
  modelo = signal('');
  serie = signal('');
  estado = signal<TecEstado>('en_stock');
  // Tipo
  tipos = signal<TecTipo[]>([]);
  tipoId = signal('');
  nuevoTipo = signal('');
  agregandoTipo = signal(false);
  // Ubicación
  bodegas = signal<Bodega[]>([]);
  bodegaId = signal('');
  // Precio
  costo = signal<number | null>(null);
  moneda = signal<'DOP' | 'USD'>('DOP');
  // Notas
  notas = signal('');
  // Fotos
  fotos = signal<FotoItem[]>([]);
  portadaKey = signal<string | null>(null);

  tipoOptions = computed(() => this.tipos().map((t) => ({ id: t.id, label: t.label })));
  bodegaOptions = computed(() => this.bodegas().map((b) => ({ id: b.id, label: b.nombre })));
  tipoLabel = computed(() => this.tipos().find((t) => t.id === this.tipoId())?.label ?? '—');
  bodegaLabel = computed(() => this.bodegas().find((b) => b.id === this.bodegaId())?.nombre ?? '—');
  estadoLabel = computed(() => TEC_ESTADO_LABEL[this.estado()]);

  private readonly backHandler = (): boolean => {
    if (!this.done() && this.tieneDatos()) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  constructor() {
    this.navGuard.register(this.backHandler);
    void this.init();
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
    for (const f of this.fotos()) if (f.blob) URL.revokeObjectURL(f.previewUrl);
  }

  private async init(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    try {
      const [tipos, bodegas] = await Promise.all([
        this.tec.getTipos(),
        this.inventario.getBodegas().catch(() => [] as Bodega[]),
      ]);
      this.tipos.set(tipos);
      this.bodegas.set(bodegas);
      if (id && id !== 'nuevo') {
        this.equipoId.set(id);
        await this.hidratar(id);
      }
    } finally {
      this.loading.set(false);
    }
  }

  private async hidratar(id: string): Promise<void> {
    const e = await this.tec.getEquipo(id);
    if (!e) return;
    this.nombre.set(e.nombre);
    this.marca.set(e.marca ?? '');
    this.modelo.set(e.modelo ?? '');
    this.serie.set(e.serie ?? '');
    this.estado.set(e.estado);
    this.tipoId.set(e.tipo_id ?? '');
    this.bodegaId.set(e.bodega_id ?? '');
    this.costo.set(e.costo);
    this.moneda.set(e.moneda ?? 'DOP');
    this.notas.set(e.notas ?? '');
    const paths = (e.fotos && e.fotos.length ? e.fotos : [e.foto_portada, e.foto_path].filter((p): p is string => !!p));
    const items: FotoItem[] = [];
    for (const p of paths) {
      const url = await this.tec.fotoUrl(p);
      if (url) items.push({ key: p, path: p, previewUrl: url });
    }
    this.fotos.set(items);
    this.portadaKey.set(e.foto_portada ?? paths[0] ?? null);
  }

  private tieneDatos(): boolean {
    return !!(this.nombre().trim() || this.tipoId() || this.fotos().length || this.marca().trim() || this.serie().trim());
  }

  // ── Tipo inline ──
  async agregarTipo(): Promise<void> {
    const label = this.nuevoTipo().trim();
    if (!label || this.agregandoTipo()) return;
    this.agregandoTipo.set(true);
    try {
      const t = await this.tec.addTipo(label);
      this.tipos.update((l) => [...l, t]);
      this.tipoId.set(t.id);
      this.nuevoTipo.set('');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo agregar el tipo.');
    } finally {
      this.agregandoTipo.set(false);
    }
  }

  // ── Fotos ──
  async tomarFoto(): Promise<void> {
    const p = await this.camera.takePhoto();
    if (p) this.pushFoto(p);
  }
  async elegirFotos(): Promise<void> {
    const ps = await this.camera.pickFromGallery();
    for (const p of ps) this.pushFoto(p);
  }
  private pushFoto(p: CapturedPhoto): void {
    const key = crypto.randomUUID();
    this.fotos.update((l) => [...l, { key, blob: p.blob, previewUrl: p.previewUrl }]);
    if (!this.portadaKey()) this.portadaKey.set(key);
  }
  quitarFoto(key: string): void {
    this.fotos.update((l) => {
      const f = l.find((x) => x.key === key);
      if (f?.blob) URL.revokeObjectURL(f.previewUrl);
      return l.filter((x) => x.key !== key);
    });
    if (this.portadaKey() === key) this.portadaKey.set(this.fotos()[0]?.key ?? null);
  }
  marcarPortada(key: string): void {
    this.portadaKey.set(key);
  }
  esPortada(key: string): boolean {
    return this.portadaKey() === key;
  }

  // ── Nav ──
  next(): void {
    if (!this.pasoValido()) return;
    this.step.update((s) => Math.min(TOTAL, s + 1));
  }
  prev(): void {
    this.step.update((s) => Math.max(1, s - 1));
  }
  pasoValido(): boolean {
    switch (this.step()) {
      case 1:
        if (!this.nombre().trim()) {
          this.toast.error('Escribe el nombre del equipo.');
          return false;
        }
        return true;
      case 2:
        if (!this.tipoId()) {
          this.toast.error('Elige el tipo de equipo.');
          return false;
        }
        return true;
      default:
        return true;
    }
  }

  async guardar(): Promise<void> {
    if (this.submitting()) return;
    if (!this.nombre().trim()) {
      this.toast.error('Escribe el nombre del equipo.');
      return;
    }
    if (!this.tipoId()) {
      this.toast.error('Elige el tipo de equipo.');
      return;
    }
    this.submitting.set(true);
    try {
      await this.tec.enqueueGuardar({
        id: this.equipoId() ?? undefined,
        nombre: this.nombre().trim(),
        tipoId: this.tipoId() || null,
        bodegaId: this.bodegaId() || null,
        costo: this.costo(),
        moneda: this.moneda(),
        marca: this.marca().trim() || null,
        modelo: this.modelo().trim() || null,
        serie: this.serie().trim() || null,
        estado: this.estado(),
        notas: this.notas().trim() || null,
        fotosExistentes: this.fotos().filter((f) => f.path).map((f) => f.path as string),
        fotosNuevas: this.fotos().filter((f) => f.blob).map((f) => ({ key: f.key, blob: f.blob as Blob })),
        portadaKey: this.portadaKey(),
      });
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar el equipo.');
    } finally {
      this.submitting.set(false);
    }
  }

  finish(): void {
    void this.router.navigate(['/tecnologia-inventario'], { replaceUrl: true });
  }

  intentarSalir(): void {
    if (!this.done() && this.tieneDatos()) this.confirmSalir.set(true);
    else this.location.back();
  }
  confirmarSalir(): void {
    this.confirmSalir.set(false);
    this.location.back();
  }
  cancelarSalir(): void {
    this.confirmSalir.set(false);
  }
}
