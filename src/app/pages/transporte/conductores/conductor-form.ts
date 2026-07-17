import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { SelectList, SelectOption } from '../../../shared/ui/select-list/select-list';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { ConductoresService } from '../../../core/services/conductores.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { UsuarioVinculable } from '../../../core/models/conductor.model';

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
  imports: [FormsModule, SelectList, OptionButton, WizardFooter, Skeleton],
  templateUrl: './conductor-form.html',
  styleUrl: './conductor-form.scss',
})
export class ConductorFormPage {
  private conductores = inject(ConductoresService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);

  readonly tiposAutorizado: TipoAutorizado[] = ['Liviano', 'Pesado', 'Ambos'];

  loading = signal(true);
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
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.usuarios.set(await this.conductores.getUsuariosVinculables());
    } catch {
      /* offline / sin permiso: se puede crear sin vincular usuario */
    } finally {
      this.loading.set(false);
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
    try {
      await this.conductores.crearConductor({
        nombre: this.nombre(),
        cedula: this.cedula(),
        licenciaTipo: this.licenciaTipo(),
        licenciaNumero: this.licenciaNumero() || null,
        licenciaVencimiento: this.licenciaVencimiento() || null,
        tipoVehiculoAutorizado: this.tipoAutorizado(),
        usuarioId: this.usuarioId() || null,
      });
      this.toast.success('Conductor creado.');
      void this.router.navigate(['/transporte/conductores'], { replaceUrl: true });
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo crear el conductor.');
      this.submitting.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
