import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { CedulaPipe } from '../../../shared/pipes/cedula-pipe';
import { ActivatedRoute } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { PersonalCarnet } from '../../../shared/ui/personal-carnet/personal-carnet';
import { UserContextService } from '../../../core/services/user-context.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { PersonalObraService } from '../../../core/services/personal-obra.service';
import {
  Cargo,
  FotoTipo,
  FOTOS_GUIA,
  NACIONALIDADES,
  NACIONALIDAD_LABEL,
  TIPOS_DOCUMENTO,
  CUADRILLAS,
  ASEGURAMIENTO,
  ASEGURAMIENTO_LABEL,
  Nacionalidad,
  TipoDocumento,
  AseguramientoEstado,
  PersonalObra,
  PersonalFirma,
} from '../../../core/models/personal-obra.model';

const SGC_WEB = 'https://sgcconstructorasd.com';

/** AR1 (app) — Expediente del personal: datos, galería (5 fotos + lightbox), carnet
 *  con QR, edición de datos + activar/desactivar (según permisos, offline-safe). */
@Component({
  selector: 'app-personal-expediente',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, CollapsibleSelect, OptionButton, ConfirmDialog, PersonalCarnet, CedulaPipe],
  templateUrl: './personal-expediente.html',
  styleUrl: './personal-expediente.scss',
})
export class PersonalExpedientePage implements OnInit {
  private service = inject(PersonalObraService);
  private ctx = inject(UserContextService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private location = inject(Location);

  readonly fotosGuia = FOTOS_GUIA;
  readonly nacionalidades = NACIONALIDADES;
  readonly tiposDocumento = TIPOS_DOCUMENTO;
  readonly nacionalidadLabel = NACIONALIDAD_LABEL;
  readonly cuadrillas = CUADRILLAS; // AV4
  readonly aseguramientos = ASEGURAMIENTO; // AV4
  readonly aseguramientoLabel = ASEGURAMIENTO_LABEL; // AV4

  personal = signal<PersonalObra | null>(null);
  fotos = signal<Partial<Record<FotoTipo, string>>>({});
  firmas = signal<PersonalFirma[]>([]);
  cargos = signal<Cargo[]>([]);
  loading = signal(true);
  error = signal('');
  saving = signal(false);
  lightboxUrl = signal<string | null>(null);
  confirmEstado = signal(false);

  // Edición inline
  editando = signal(false);
  eNombre = signal('');
  eApellido = signal('');
  eNacionalidad = signal<Nacionalidad>('dominicano');
  eTipoDoc = signal<TipoDocumento>('cedula');
  eDocNumero = signal('');
  eCargoId = signal('');
  eCuadrilla = signal(''); // AV4
  eAseguramiento = signal<AseguramientoEstado>('desconocido'); // AV4
  eTelefono = signal('');
  eNotas = signal('');

  cargoOptions = computed(() => this.cargos().map((c) => ({ id: c.id, label: `${c.nombre} · ${c.codigo}` })));
  cuadrillaOptions = computed(() => this.cuadrillas.map((c) => ({ id: c.value, label: c.label }))); // AV4
  aseguramientoActual = computed(() => this.personal()?.aseguramiento_estado ?? 'desconocido'); // AV4

  puedeGestionar = computed(
    () =>
      this.ctx.esAdmin() ||
      this.ctx.hasModulo('proyectos') ||
      this.ctx.hasModulo('rrhh') ||
      this.ctx.hasModulo('direccion') ||
      this.ctx.puedeOperarSubmodulo('proyectos.personal') ||
      this.ctx.puedeVerObra(),
  );

  fotoPersonaUrl = computed(() => this.fotos()['persona'] ?? null);
  verifyUrl = computed(() => {
    const p = this.personal();
    return p ? `${SGC_WEB}/proyectos/personal/${p.id}` : '';
  });

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('Personal no encontrado.');
      this.loading.set(false);
      return;
    }
    await this.load(id);
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [p, cargos] = await Promise.all([this.service.getById(id), this.service.getCargos().catch(() => [] as Cargo[])]);
      this.cargos.set(cargos);
      if (!p) {
        this.error.set('Personal no encontrado o sin acceso.');
        return;
      }
      this.personal.set(p);
      const [fotos, firmas] = await Promise.all([this.service.getFotos(id), this.service.getFirmas(id)]);
      this.firmas.set(firmas);
      const urls: Partial<Record<FotoTipo, string>> = {};
      for (const f of fotos) {
        const url = await this.service.fotoUrl(f.foto_path);
        if (url) urls[f.tipo] = url;
      }
      this.fotos.set(urls);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el expediente.');
    } finally {
      this.loading.set(false);
    }
  }

  cargoNombre(id: string | null | undefined): string {
    const c = this.cargos().find((x) => x.id === id);
    return c ? `${c.nombre} · ${c.codigo}` : '—';
  }

  abrirFoto(url: string | undefined): void {
    if (url) this.lightboxUrl.set(url);
  }
  cerrarFoto(): void {
    this.lightboxUrl.set(null);
  }

  // ── Edición ────────────────────────────────────────────────────────────────
  editar(): void {
    const p = this.personal();
    if (!p) return;
    this.eNombre.set(p.nombre);
    this.eApellido.set(p.apellido ?? '');
    this.eNacionalidad.set(p.nacionalidad);
    this.eTipoDoc.set(p.tipo_documento);
    this.eDocNumero.set(p.documento_numero ?? '');
    this.eCargoId.set(p.cargo_id ?? '');
    this.eCuadrilla.set((p.cuadrilla as string) ?? ''); // AV4
    this.eAseguramiento.set(p.aseguramiento_estado ?? 'desconocido'); // AV4
    this.eTelefono.set(p.telefono ?? '');
    this.eNotas.set(p.notas ?? '');
    this.editando.set(true);
  }

  cancelarEdicion(): void {
    this.editando.set(false);
  }

  async guardarEdicion(): Promise<void> {
    const p = this.personal();
    if (!p || this.saving()) return;
    if (!this.eNombre().trim()) {
      this.toast.error('El nombre es obligatorio.');
      return;
    }
    this.saving.set(true);
    try {
      const cambios: Partial<PersonalObra> = {
        nombre: this.eNombre().trim(),
        apellido: this.eApellido().trim() || null,
        nacionalidad: this.eNacionalidad(),
        tipo_documento: this.eTipoDoc(),
        documento_numero: this.eDocNumero().trim() || null,
        cargo_id: this.eCargoId() || null,
        cuadrilla: this.eCuadrilla() || null, // AV4
        aseguramiento_estado: this.eAseguramiento(), // AV4
        telefono: this.eTelefono().trim() || null,
        notas: this.eNotas().trim() || null,
      };
      await this.service.enqueueEditar(p.id, cambios);
      // Optimista: refleja los cambios (el cargo join se resuelve del catálogo).
      const cargo = this.cargos().find((c) => c.id === (cambios.cargo_id ?? null)) ?? null;
      this.personal.set({ ...p, ...cambios, cargo });
      this.editando.set(false);
      this.toast.success('Cambios guardados. Se sincronizarán en segundo plano.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudieron guardar los cambios.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Activar / desactivar ─────────────────────────────────────────────────────
  pedirCambioEstado(): void {
    this.confirmEstado.set(true);
  }
  cancelarEstado(): void {
    this.confirmEstado.set(false);
  }
  async confirmarEstado(): Promise<void> {
    const p = this.personal();
    if (!p) return;
    this.confirmEstado.set(false);
    const nuevo = p.estado === 'activo' ? 'inactivo' : 'activo';
    this.saving.set(true);
    try {
      await this.service.enqueueEstado(p.id, nuevo);
      this.personal.set({ ...p, estado: nuevo });
      this.toast.success(nuevo === 'inactivo' ? 'Personal desactivado.' : 'Personal reactivado.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo cambiar el estado.');
    } finally {
      this.saving.set(false);
    }
  }

  get online(): boolean {
    return this.network.online();
  }

  back(): void {
    this.location.back();
  }
}
