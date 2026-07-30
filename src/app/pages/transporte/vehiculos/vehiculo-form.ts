import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { DraftBanner } from '../../../shared/ui/draft-banner/draft-banner';
import { SelectList, SelectOption } from '../../../shared/ui/select-list/select-list';
import { ToggleSwitch } from '../../../shared/ui/toggle-switch/toggle-switch';
import { VEHICULO_TIPOS } from '../../../core/models/vehiculo-tipos.model';
import { VehiculosService, VehiculoEditable } from '../../../core/services/vehiculos.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { CapturedPhoto } from '../../../core/services/camera.service';

const ESTADOS = [
  { v: 'activo', label: 'Activo' },
  { v: 'no_disponible', label: 'No disponible' },
  { v: 'baja', label: 'Baja' },
];

interface VehiculoDraft {
  placa: string;
  marca: string;
  modelo: string;
  anio: number | null;
  tipo: string;
  estado: string;
  kilometraje: number | null;
  vencMatricula: string;
  vencSeguro: string;
  kmUltMant: number | null;
  intervaloMant: number | null;
  rendimientoEsperado: number | null;
  notas: string;
  vin: string;
  numeroMatricula: string;
  numeroSeguro: string;
  aseguradora: string;
  color: string;
  medidaUso: 'km' | 'horas';
  uso: 'obra' | 'oficina';
  esPrueba: boolean;
}

// AA18 — colores comunes (select + "Otro" → input libre).
const COLORES = ['Blanco', 'Negro', 'Gris', 'Plateado', 'Rojo', 'Azul', 'Verde', 'Amarillo', 'Naranja', 'Marrón'];
// AA18 — aseguradora habitual preseleccionada + "Otro".
const ASEGURADORAS = ['Seguros Universal', 'Seguros Reservas', 'Mapfre BHD', 'La Colonial', 'Humano Seguros'];

/** Alta/edición de vehículo (admin; RLS vehiculos:write = is_admin). */
@Component({
  selector: 'app-vehiculo-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, OptionButton, PhotoSlot, WizardFooter, Skeleton, DraftBanner, SelectList, ToggleSwitch],
  templateUrl: './vehiculo-form.html',
  styleUrl: './vehiculo-form.scss',
})
export class VehiculoFormPage {
  private vehiculos = inject(VehiculosService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private toast = inject(ToastService);
  private network = inject(NetworkService);
  private autosave = inject(AutosaveService);
  private borradorSvc = inject(BorradorService);
  private ctx = inject(UserContextService);

  readonly estados = ESTADOS;

  // P4 — tipos de vehículo (paridad SGC). Si el vehículo trae un tipo legacy no
  // presente en el catálogo, se añade como opción para no perderlo al editar.
  tipoOpts = computed<SelectOption[]>(() => {
    const opts: SelectOption[] = VEHICULO_TIPOS.map((t) => ({ id: t.value, label: t.label }));
    const actual = this.tipo();
    if (actual && !opts.some((o) => o.id === actual)) opts.push({ id: actual, label: actual });
    return opts;
  });

  vehiculoId = signal<string>('');
  esEdicion = computed(() => !!this.vehiculoId());
  loading = signal(false);
  submitting = signal(false);
  borradorPrevio = signal<number | null>(null);
  private hydrated = false;

  placa = signal('');
  marca = signal('');
  modelo = signal('');
  anio = signal<number | null>(null);
  tipo = signal('');
  estado = signal('activo');
  kilometraje = signal<number | null>(null);
  vencMatricula = signal('');
  vencSeguro = signal('');
  kmUltMant = signal<number | null>(null);
  intervaloMant = signal<number | null>(5000);
  rendimientoEsperado = signal<number | null>(null); // S20 — km/gal esperado (paridad web)
  notas = signal('');
  vin = signal('');
  numeroMatricula = signal('');
  numeroSeguro = signal('');
  aseguradora = signal('Seguros Universal'); // AA18 — default habitual
  color = signal(''); // AA18
  medidaUso = signal<'km' | 'horas'>('km'); // AA18 — km | horas (horómetro)
  uso = signal<'obra' | 'oficina'>('obra'); // AA17
  esPrueba = signal(false); // W7 — dato de prueba (solo admin)
  foto = signal<CapturedPhoto | null>(null);
  // AA19 — fotos existentes (paths) para reordenar / elegir portada / quitar.
  fotosExistentes = signal<string[]>([]);
  private fotoUrls = signal<Record<string, string>>({});

  readonly colores = COLORES;
  readonly aseguradoras = ASEGURADORAS;
  // AA18 — "Otro" cuando el valor no está en la lista (input libre).
  colorEsOtro = computed(() => !!this.color() && !COLORES.includes(this.color()));
  aseguradoraEsOtro = computed(() => !!this.aseguradora() && !ASEGURADORAS.includes(this.aseguradora()));
  // AA18 — etiqueta del odómetro según la medida de uso.
  medidaLabel = computed(() => (this.medidaUso() === 'horas' ? 'Horas de uso' : 'Kilometraje'));

  /** W7 — solo un admin marca/ve el switch de "Dato de prueba". */
  esAdmin = computed(() => this.ctx.hasRol('admin'));

  constructor() {
    const id = this.route.snapshot.paramMap.get('vehiculoId') ?? '';
    this.vehiculoId.set(id);
    void this.init(id);
    // Autosave con debounce + flush al ocultar/descargar (Fase 2).
    effect(() => {
      const snap = this.snapshot();
      if (!this.hydrated || this.submitting()) return;
      if (!snap.placa && !snap.marca && !snap.modelo && !snap.tipo) return;
      this.autosave.queue(this.clave(), snap, {
        tipo: 'vehiculo',
        etiqueta: (this.esEdicion() ? 'Editar vehículo' : 'Nuevo vehículo') + (snap.placa ? ' · ' + snap.placa : ''),
        ruta: this.ruta(),
      });
    });
  }

  private async init(id: string): Promise<void> {
    if (id) await this.load(id);
    const b = await this.borradorSvc.get(this.clave());
    if (b) this.borradorPrevio.set(b.updated_at);
    this.hydrated = true;
  }

  private snapshot(): VehiculoDraft {
    return {
      placa: this.placa(),
      marca: this.marca(),
      modelo: this.modelo(),
      anio: this.anio(),
      tipo: this.tipo(),
      estado: this.estado(),
      kilometraje: this.kilometraje(),
      vencMatricula: this.vencMatricula(),
      vencSeguro: this.vencSeguro(),
      kmUltMant: this.kmUltMant(),
      intervaloMant: this.intervaloMant(),
      rendimientoEsperado: this.rendimientoEsperado(),
      notas: this.notas(),
      vin: this.vin(),
      numeroMatricula: this.numeroMatricula(),
      numeroSeguro: this.numeroSeguro(),
      aseguradora: this.aseguradora(),
      color: this.color(),
      medidaUso: this.medidaUso(),
      uso: this.uso(),
      esPrueba: this.esPrueba(),
    };
  }
  private clave(): string {
    const uid = this.ctx.profile()?.id ?? 'anon';
    return `vehiculo:${this.vehiculoId() || 'nuevo'}:${uid}`;
  }
  private ruta(): string {
    return this.esEdicion()
      ? `/transporte/vehiculos/${this.vehiculoId()}/editar`
      : '/transporte/vehiculos/nuevo';
  }

  continuarBorrador(): void {
    void this.borradorSvc.load<VehiculoDraft>(this.clave()).then((d) => {
      if (d) {
        this.placa.set(d.placa ?? '');
        this.marca.set(d.marca ?? '');
        this.modelo.set(d.modelo ?? '');
        this.anio.set(d.anio ?? null);
        this.tipo.set(d.tipo ?? '');
        this.estado.set(d.estado ?? 'activo');
        this.kilometraje.set(d.kilometraje ?? null);
        this.vencMatricula.set(d.vencMatricula ?? '');
        this.vencSeguro.set(d.vencSeguro ?? '');
        this.kmUltMant.set(d.kmUltMant ?? null);
        this.intervaloMant.set(d.intervaloMant ?? 5000);
        this.rendimientoEsperado.set(d.rendimientoEsperado ?? null);
        this.notas.set(d.notas ?? '');
        this.vin.set(d.vin ?? '');
        this.numeroMatricula.set(d.numeroMatricula ?? '');
        this.numeroSeguro.set(d.numeroSeguro ?? '');
        this.aseguradora.set(d.aseguradora ?? 'Seguros Universal');
        this.color.set(d.color ?? '');
        this.medidaUso.set(d.medidaUso ?? 'km');
        this.uso.set(d.uso ?? 'obra');
        this.esPrueba.set(d.esPrueba ?? false);
      }
      this.borradorPrevio.set(null);
    });
  }
  descartarBorrador(): void {
    void this.autosave.discard(this.clave());
    this.borradorPrevio.set(null);
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const v = await this.vehiculos.getVehiculoFull(id);
      if (v) {
        this.placa.set(v.placa);
        this.marca.set(v.marca);
        this.modelo.set(v.modelo);
        this.anio.set(v.anio);
        this.tipo.set(v.tipo);
        this.estado.set(v.estado);
        this.kilometraje.set(v.kilometraje);
        this.vencMatricula.set(v.vencimientoMatricula ?? '');
        this.vencSeguro.set(v.vencimientoSeguro ?? '');
        this.kmUltMant.set(v.kmUltimoMantenimiento);
        this.intervaloMant.set(v.intervaloMantenimientoKm);
        this.rendimientoEsperado.set(v.rendimientoEsperadoKmGal);
        this.notas.set(v.notas ?? '');
        this.vin.set(v.vin ?? '');
        this.numeroMatricula.set(v.numeroMatricula ?? '');
        this.numeroSeguro.set(v.numeroSeguro ?? '');
        this.aseguradora.set(v.aseguradora ?? '');
        this.color.set(v.color ?? '');
        this.medidaUso.set((v.medidaUso as 'km' | 'horas') ?? 'km');
        this.uso.set((v.uso as 'obra' | 'oficina') ?? 'obra');
        this.esPrueba.set(v.esPrueba ?? false);
        // AA19 — fotos existentes + sus URLs firmadas para la galería.
        this.fotosExistentes.set(v.fotos ?? []);
        void this.loadFotosUrls(v.fotos ?? []);
      }
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo cargar el vehículo.');
    } finally {
      this.loading.set(false);
    }
  }

  onFoto(p: CapturedPhoto): void {
    this.foto.set(p);
  }
  onFotoCleared(): void {
    this.foto.set(null);
  }

  // ── AA19 — galería de fotos: reordenar / portada / quitar ──────────────────
  private async loadFotosUrls(paths: string[]): Promise<void> {
    const map: Record<string, string> = {};
    await Promise.all(
      paths.map(async (p) => {
        const u = await this.vehiculos.getFotoUrl(p);
        if (u) map[p] = u;
      }),
    );
    this.fotoUrls.set(map);
  }
  fotoUrl(path: string): string {
    return this.fotoUrls()[path] ?? '';
  }
  moverFoto(i: number, dir: -1 | 1): void {
    this.fotosExistentes.update((l) => {
      const j = i + dir;
      if (j < 0 || j >= l.length) return l;
      const next = [...l];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  /** Mueve la foto i al frente (índice 0 = portada). */
  hacerPortada(i: number): void {
    this.fotosExistentes.update((l) => (i <= 0 ? l : [l[i], ...l.filter((_, k) => k !== i)]));
  }
  quitarFoto(i: number): void {
    this.fotosExistentes.update((l) => l.filter((_, k) => k !== i));
  }

  private build(): VehiculoEditable {
    return {
      placa: this.placa(),
      marca: this.marca(),
      modelo: this.modelo(),
      anio: this.anio() ?? new Date().getFullYear(),
      tipo: this.tipo(),
      estado: this.estado(),
      kilometraje: this.kilometraje() ?? 0,
      vencimientoMatricula: this.vencMatricula() || null,
      vencimientoSeguro: this.vencSeguro() || null,
      kmUltimoMantenimiento: this.kmUltMant(),
      intervaloMantenimientoKm: this.intervaloMant() ?? 5000,
      rendimientoEsperadoKmGal: this.rendimientoEsperado(),
      notas: this.notas() || null,
      vin: this.vin() || null,
      numeroMatricula: this.numeroMatricula() || null,
      numeroSeguro: this.numeroSeguro() || null,
      aseguradora: this.aseguradora() || null,
      color: this.color() || null, // AA18
      medidaUso: this.medidaUso(), // AA18
      uso: this.uso(), // AA17
      esPrueba: this.esPrueba(), // W7
    };
  }

  async guardar(): Promise<void> {
    if (this.submitting()) return;
    if (!this.placa().trim() || !this.marca().trim() || !this.modelo().trim() || !this.tipo().trim()) {
      this.toast.error('Completa placa, marca, modelo y tipo.');
      return;
    }
    if (this.anio() == null || this.anio()! < 1950) {
      this.toast.error('Escribe un año válido.');
      return;
    }
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para guardar el vehículo.');
      return;
    }
    this.submitting.set(true);
    try {
      const data = this.build();
      const id = this.esEdicion()
        ? (await this.vehiculos.actualizarVehiculo(this.vehiculoId(), data), this.vehiculoId())
        : await this.vehiculos.crearVehiculo(data);
      // AA19 — sube la foto nueva (si hay) y persiste el orden + la portada.
      const nueva = this.foto();
      let fotosFinal = [...this.fotosExistentes()];
      if (nueva) {
        const p = await this.vehiculos.subirFotoStorage(id, nueva.blob);
        fotosFinal = [p, ...fotosFinal]; // la nueva entra como portada
      }
      if (nueva || this.esEdicion()) await this.vehiculos.guardarFotosOrden(id, fotosFinal);
      void this.autosave.discard(this.clave());
      this.toast.success(this.esEdicion() ? 'Vehículo actualizado.' : 'Vehículo creado.');
      void this.router.navigate(['/transporte/vehiculo', id], { replaceUrl: true });
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
      this.submitting.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
