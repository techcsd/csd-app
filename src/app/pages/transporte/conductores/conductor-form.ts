import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { SelectList, SelectOption } from '../../../shared/ui/select-list/select-list';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { DraftBanner } from '../../../shared/ui/draft-banner/draft-banner';
import { ConductoresService } from '../../../core/services/conductores.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { UsuarioVinculable } from '../../../core/models/conductor.model';

interface ConductorDraft {
  usuarioId: string;
  nombre: string;
  cedula: string;
  licenciaTipo: string;
  licenciaNumero: string;
  licenciaVencimiento: string;
  tipoAutorizado: TipoAutorizado;
}

type TipoAutorizado = 'Liviano' | 'Pesado' | 'Ambos';

/**
 * Alta de conductor (gestión) — paridad con la web: se puede ligar a un usuario
 * ya creado en el sistema (autollena cédula del perfil) o dejarlo sin usuario.
 * Gated a admin en la UI; RLS exige is_admin OR módulo flota.
 */
@Component({
  selector: 'app-conductor-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, SelectList, OptionButton, WizardFooter, Skeleton, DraftBanner],
  templateUrl: './conductor-form.html',
  styleUrl: './conductor-form.scss',
})
export class ConductorFormPage {
  private conductores = inject(ConductoresService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private autosave = inject(AutosaveService);
  private borradorSvc = inject(BorradorService);
  private ctx = inject(UserContextService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);

  readonly tiposAutorizado: TipoAutorizado[] = ['Liviano', 'Pesado', 'Ambos'];

  conductorId = signal<string>('');
  esEdicion = computed(() => !!this.conductorId());
  loading = signal(true);
  borradorPrevio = signal<number | null>(null);
  private hydrated = false;
  private usuarios = signal<UsuarioVinculable[]>([]);
  usuarioOpts = computed<SelectOption[]>(() =>
    this.usuarios().map((u) => ({ id: u.id, label: u.cedula ? `${u.nombre} · ${u.cedula}` : u.nombre })),
  );

  usuarioId = signal('');
  nombre = signal('');
  cedula = signal('');
  licenciaTipo = signal('');
  licenciaNumero = signal('');
  licenciaVencimiento = signal('');
  tipoAutorizado = signal<TipoAutorizado>('Ambos');
  submitting = signal(false);

  constructor() {
    this.conductorId.set(this.route.snapshot.paramMap.get('conductorId') ?? '');
    void this.load();
    // Autosave con debounce + flush al ocultar/descargar (Fase 2).
    effect(() => {
      const snap: ConductorDraft = {
        usuarioId: this.usuarioId(),
        nombre: this.nombre(),
        cedula: this.cedula(),
        licenciaTipo: this.licenciaTipo(),
        licenciaNumero: this.licenciaNumero(),
        licenciaVencimiento: this.licenciaVencimiento(),
        tipoAutorizado: this.tipoAutorizado(),
      };
      if (!this.hydrated || this.submitting()) return;
      if (!snap.nombre && !snap.cedula && !snap.licenciaTipo && !snap.usuarioId) return;
      this.autosave.queue(this.clave(), snap, {
        tipo: 'conductor',
        etiqueta: (this.esEdicion() ? 'Editar conductor' : 'Nuevo conductor') + (snap.nombre ? ' · ' + snap.nombre : ''),
        ruta: this.ruta(),
      });
    });
  }

  private clave(): string {
    const uid = this.ctx.profile()?.id ?? 'anon';
    return `conductor:${this.conductorId() || 'nuevo'}:${uid}`;
  }
  private ruta(): string {
    return this.esEdicion()
      ? `/transporte/conductores/${this.conductorId()}/editar`
      : '/transporte/conductores/nuevo';
  }

  continuarBorrador(): void {
    void this.borradorSvc.load<ConductorDraft>(this.clave()).then((d) => {
      if (d) {
        this.usuarioId.set(d.usuarioId ?? '');
        this.nombre.set(d.nombre ?? '');
        this.cedula.set(d.cedula ?? '');
        this.licenciaTipo.set(d.licenciaTipo ?? '');
        this.licenciaNumero.set(d.licenciaNumero ?? '');
        this.licenciaVencimiento.set(d.licenciaVencimiento ?? '');
        this.tipoAutorizado.set(d.tipoAutorizado ?? 'Ambos');
      }
      this.borradorPrevio.set(null);
    });
  }
  descartarBorrador(): void {
    void this.autosave.discard(this.clave());
    this.borradorPrevio.set(null);
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.usuarios.set(await this.conductores.getUsuariosVinculables());
    } catch {
      /* offline / sin permiso: se puede crear sin vincular usuario */
    }
    if (this.esEdicion()) {
      try {
        const c = await this.conductores.getConductor(this.conductorId());
        if (c) {
          this.nombre.set(c.nombre ?? '');
          this.cedula.set(c.cedula ?? '');
          this.licenciaTipo.set(c.licencia_tipo ?? '');
          this.licenciaNumero.set(c.licencia_numero ?? '');
          this.licenciaVencimiento.set(c.licencia_vencimiento ?? '');
          this.tipoAutorizado.set((c.tipo_vehiculo_autorizado as TipoAutorizado) || 'Ambos');
          this.usuarioId.set(c.usuario_id ?? '');
        }
      } catch (e) {
        this.toast.error(e instanceof Error ? e.message : 'No se pudo cargar el conductor.');
      }
    }
    // ¿Hay un borrador sin enviar? → ofrecer continuar/descartar (Fase 3).
    const b = await this.borradorSvc.get(this.clave());
    if (b) this.borradorPrevio.set(b.updated_at);
    this.hydrated = true;
    this.loading.set(false);
  }

  async desactivar(): Promise<void> {
    if (this.submitting() || !this.esEdicion()) return;
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para esto.');
      return;
    }
    this.submitting.set(true);
    try {
      await this.conductores.setConductorActivo(this.conductorId(), false);
      void this.autosave.discard(this.clave());
      this.toast.success('Conductor desactivado.');
      void this.router.navigate(['/transporte/conductores'], { replaceUrl: true });
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo desactivar.');
      this.submitting.set(false);
    }
  }

  /** Al elegir un usuario del sistema, autollena nombre y cédula (editables). */
  onUsuario(id: string): void {
    this.usuarioId.set(id);
    const u = this.usuarios().find((x) => x.id === id);
    if (!u) return;
    this.nombre.set(u.nombre ?? '');
    if (u.cedula) this.cedula.set(u.cedula);
  }

  quitarUsuario(): void {
    this.usuarioId.set('');
  }

  async guardar(): Promise<void> {
    if (this.submitting()) return;
    if (!this.nombre().trim()) {
      this.toast.error('Escribe el nombre del conductor.');
      return;
    }
    if (!this.cedula().trim()) {
      this.toast.error('Escribe la cédula.');
      return;
    }
    if (!this.licenciaTipo().trim()) {
      this.toast.error('Escribe el tipo/categoría de licencia.');
      return;
    }
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para crear el conductor.');
      return;
    }
    this.submitting.set(true);
    const input = {
      nombre: this.nombre(),
      cedula: this.cedula(),
      licenciaTipo: this.licenciaTipo(),
      licenciaNumero: this.licenciaNumero() || null,
      licenciaVencimiento: this.licenciaVencimiento() || null,
      tipoVehiculoAutorizado: this.tipoAutorizado(),
      usuarioId: this.usuarioId() || null,
    };
    try {
      if (this.esEdicion()) {
        await this.conductores.actualizarConductor(this.conductorId(), input);
        void this.autosave.discard(this.clave());
        this.toast.success('Conductor actualizado.');
        void this.router.navigate(['/transporte/conductor', this.conductorId()], { replaceUrl: true });
      } else {
        await this.conductores.crearConductor(input);
        void this.autosave.discard(this.clave());
        this.toast.success('Conductor creado.');
        void this.router.navigate(['/transporte/conductores'], { replaceUrl: true });
      }
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar el conductor.');
      this.submitting.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
