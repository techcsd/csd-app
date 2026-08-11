import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { LocationPicker, UbicacionSeleccionada } from '../../../shared/ui/location-picker/location-picker';
import { ProyectosService } from '../../../core/services/proyectos.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ProyectoEstado, PROYECTO_ESTADO_LABEL, ProyectoInput } from '../../../core/models/proyecto.model';

type PasoKey = 'datos' | 'ubicacion' | 'equipo' | 'revisar';

/**
 * AM9 — Crear/editar proyecto en la app, por HOJAS (patrón del wizard de conduce).
 *  - Datos básicos → Ubicación fácil (link de Maps / coordenadas / pin) → Equipo y
 *    contacto (data estructurada AM10) → Descripción + revisar.
 * La ubicación se resuelve con la edge `resolve-maps-link` (short links maps.app.goo.gl,
 * coordenadas pegadas) y se fija validada con `set_proyecto_ubicacion`. Requerida al
 * CREAR (AM8, validación de form). Gating por rol igual que la web.
 */
@Component({
  selector: 'app-proyecto-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, StepBar, WizardFooter, CollapsibleSelect, LocationPicker],
  templateUrl: './proyecto-form.html',
  styleUrl: './proyecto-form.scss',
})
export class ProyectoFormPage implements OnDestroy {
  private proyectos = inject(ProyectosService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private navGuard = inject(NavGuardService);
  private route = inject(ActivatedRoute);

  readonly estadoOpciones = (Object.keys(PROYECTO_ESTADO_LABEL) as ProyectoEstado[]).map((id) => ({
    id,
    label: PROYECTO_ESTADO_LABEL[id],
  }));

  proyectoId = signal<string>(this.route.snapshot.paramMap.get('id') ?? '');
  esEdicion = computed(() => !!this.proyectoId());
  loading = signal(true);
  guardando = signal(false);
  hoja = signal<'form' | 'exito'>('form');

  // ── Datos ──
  nombre = signal('');
  cliente = signal('');
  tipo = signal('');
  estado = signal<ProyectoEstado>('planificacion');
  fechaInicio = signal('');
  fechaFin = signal('');
  presupuesto = signal<number | null>(null);
  descripcion = signal('');

  // ── Equipo / contacto (AM10) ──
  ingenieroObra = signal('');
  maestroEncargado = signal('');
  contactoNombre = signal('');
  contactoTelefono = signal('');
  private responsableIdActual: string | null = null;

  // ── Ubicación (AM7) ──
  ubicacionTexto = signal(''); // link de Maps o coordenadas pegadas
  resolviendo = signal(false);
  latSel = signal<number | null>(null);
  lngSel = signal<number | null>(null);
  direccionSel = signal('');
  ubicacionMetodo = signal<string | null>(null);
  ubicacionCambiada = signal(false);

  tieneUbicacion = computed(() => this.latSel() != null && this.lngSel() != null);
  estadoLabel = computed(() => PROYECTO_ESTADO_LABEL[this.estado()]);

  // ── Wizard ──
  paso = signal(0);
  pasos: { key: PasoKey; titulo: string }[] = [
    { key: 'datos', titulo: 'Datos del proyecto' },
    { key: 'ubicacion', titulo: 'Ubicación de la obra' },
    { key: 'equipo', titulo: 'Equipo y contacto' },
    { key: 'revisar', titulo: 'Descripción y revisar' },
  ];
  pasoActual = computed(() => this.pasos[Math.min(this.paso(), this.pasos.length - 1)]);
  esUltimo = computed(() => this.paso() >= this.pasos.length - 1);

  pasoValido = computed(() => {
    switch (this.pasoActual().key) {
      case 'datos':
        return !!this.nombre().trim();
      case 'ubicacion':
        // AM8 — requerida AL CREAR; en edición se puede dejar la existente.
        return this.esEdicion() || this.tieneUbicacion();
      default:
        return true;
    }
  });
  primaryLabel = computed(() =>
    this.guardando() ? 'Guardando…' : this.esUltimo() ? (this.esEdicion() ? 'Guardar cambios' : 'Crear proyecto') : 'Siguiente',
  );

  private readonly backHandler = (): boolean => {
    if (this.hoja() !== 'form') return false;
    if (this.paso() > 0) {
      this.paso.update((p) => p - 1);
      return true;
    }
    return false;
  };

  constructor() {
    this.navGuard.register(this.backHandler);
    void this.init();
  }

  private async init(): Promise<void> {
    if (!this.esEdicion()) {
      this.loading.set(false);
      return;
    }
    try {
      const p = await this.proyectos.getProyecto(this.proyectoId());
      if (p) {
        this.nombre.set(p.nombre ?? '');
        this.cliente.set(p.cliente ?? '');
        this.tipo.set(p.tipo ?? '');
        this.estado.set(p.estado ?? 'planificacion');
        this.fechaInicio.set(p.fecha_inicio ?? '');
        this.fechaFin.set(p.fecha_fin_estimada ?? '');
        this.presupuesto.set(p.presupuesto ?? null);
        this.descripcion.set(p.descripcion ?? '');
        this.ingenieroObra.set(p.ingeniero_obra ?? '');
        this.maestroEncargado.set(p.maestro_encargado ?? '');
        this.contactoNombre.set(p.contacto_nombre ?? '');
        this.contactoTelefono.set(p.contacto_telefono ?? '');
        this.responsableIdActual = p.responsable_id ?? null;
        this.latSel.set(p.latitud ?? null);
        this.lngSel.set(p.longitud ?? null);
        this.direccionSel.set(p.direccion_geo ?? '');
        this.ubicacionMetodo.set(p.ubicacion_metodo ?? null);
      }
    } finally {
      this.loading.set(false);
    }
  }

  // ── Ubicación ──
  async resolver(): Promise<void> {
    const txt = this.ubicacionTexto().trim();
    if (!txt) {
      this.toast.error('Pega el link de Google Maps o las coordenadas.');
      return;
    }
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para resolver el link de Maps.');
      return;
    }
    if (this.resolviendo()) return;
    this.resolviendo.set(true);
    try {
      const r = await this.proyectos.resolverUbicacion(txt);
      this.latSel.set(r.lat);
      this.lngSel.set(r.lng);
      this.ubicacionMetodo.set(r.source);
      this.ubicacionCambiada.set(true);
      this.toast.success('Ubicación fijada. Ajústala en el mapa si hace falta.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo resolver la ubicación.');
    } finally {
      this.resolviendo.set(false);
    }
  }

  onUbicacion(u: UbicacionSeleccionada): void {
    this.latSel.set(u.latitud);
    this.lngSel.set(u.longitud);
    if (u.direccion) this.direccionSel.set(u.direccion);
    this.ubicacionMetodo.set('pin');
    this.ubicacionCambiada.set(true);
  }

  // ── Wizard nav ──
  siguiente(): void {
    if (!this.pasoValido() || this.guardando()) return;
    if (this.esUltimo()) return void this.guardar();
    this.paso.update((p) => Math.min(p + 1, this.pasos.length - 1));
  }
  atras(): void {
    if (this.paso() === 0) return this.salir();
    this.paso.update((p) => p - 1);
  }

  private input(): ProyectoInput {
    return {
      nombre: this.nombre(),
      cliente: this.cliente(),
      tipo: this.tipo(),
      estado: this.estado(),
      fecha_inicio: this.fechaInicio(),
      fecha_fin_estimada: this.fechaFin(),
      presupuesto: this.presupuesto(),
      descripcion: this.descripcion(),
      ingeniero_obra: this.ingenieroObra(),
      maestro_encargado: this.maestroEncargado(),
      contacto_nombre: this.contactoNombre(),
      contacto_telefono: this.contactoTelefono(),
      responsable_id: this.responsableIdActual,
    };
  }

  async guardar(): Promise<void> {
    if (this.guardando()) return;
    if (!this.nombre().trim()) {
      this.toast.error('Escribe el nombre del proyecto.');
      return;
    }
    if (!this.esEdicion() && !this.tieneUbicacion()) {
      this.toast.error('Fija la ubicación de la obra antes de crear el proyecto.');
      return;
    }
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para guardar el proyecto.');
      return;
    }
    this.guardando.set(true);
    try {
      let id = this.proyectoId();
      if (this.esEdicion()) {
        await this.proyectos.actualizarProyecto(id, this.input());
      } else {
        id = await this.proyectos.crearProyecto(this.input());
        this.proyectoId.set(id);
      }
      // AM7 — fija/actualiza la ubicación validada si hay coordenadas nuevas.
      if (this.tieneUbicacion() && (this.ubicacionCambiada() || !this.esEdicion())) {
        await this.proyectos.setUbicacion(
          id,
          this.latSel()!,
          this.lngSel()!,
          this.direccionSel().trim() || null,
          this.ubicacionMetodo(),
        );
      }
      this.toast.success(this.esEdicion() ? 'Proyecto actualizado.' : 'Proyecto creado.');
      this.hoja.set('exito');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar el proyecto.');
    } finally {
      this.guardando.set(false);
    }
  }

  verProyecto(): void {
    this.navGuard.back(`/proyectos/${this.proyectoId()}`);
  }

  salir(): void {
    this.navGuard.back('/proyectos');
  }

  get online(): boolean {
    return this.network.online();
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }
}
