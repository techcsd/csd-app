import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { SelectList, SelectOption } from '../../../shared/ui/select-list/select-list';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { DraftBanner } from '../../../shared/ui/draft-banner/draft-banner';
import { DocSlot } from '../../../shared/ui/doc-slot/doc-slot';
import { GenerarAcceso } from '../../../shared/components/generar-acceso/generar-acceso';
import { ConductoresService } from '../../../core/services/conductores.service';
import { LicenciaCategoriasService, LicenciaCategoria } from '../../../core/services/licencia-categorias.service';
import { DocumentosService } from '../../../core/services/documentos.service';
import { CapturedDoc } from '../../../core/services/camera.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { UsuarioVinculable, CONDUCTOR_TAGS_SUGERIDOS } from '../../../core/models/conductor.model';

interface ConductorDraft {
  usuarioId: string;
  nombre: string;
  cedula: string;
  licenciaTipo: string;
  licenciaNumero: string;
  licenciaVencimiento: string;
  tipoAutorizado: TipoAutorizado;
  nota: string;
  tags: string[];
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
  imports: [FormsModule, SelectList, OptionButton, WizardFooter, Skeleton, DraftBanner, DocSlot, GenerarAcceso],
  templateUrl: './conductor-form.html',
  styleUrl: './conductor-form.scss',
})
export class ConductorFormPage {
  private conductores = inject(ConductoresService);
  private licCategorias = inject(LicenciaCategoriasService);
  private documentos = inject(DocumentosService);
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

  // C1 — categorías de licencia RD (catálogo del SGC). El valor guardado es el
  // `codigo` ('01'…). Si el conductor trae un valor viejo/libre no presente en
  // el catálogo, lo añadimos como opción para no perderlo al editar.
  private categorias = signal<LicenciaCategoria[]>([]);
  categoriaOpts = computed<SelectOption[]>(() => {
    const opts = this.categorias().map((c) => ({ id: c.codigo, label: LicenciaCategoriasService.label(c) }));
    const actual = this.licenciaTipo();
    if (actual && !opts.some((o) => o.id === actual)) opts.push({ id: actual, label: actual });
    return opts;
  });

  usuarioId = signal('');
  nombre = signal('');
  cedula = signal('');
  licenciaTipo = signal('');
  licenciaNumero = signal('');
  licenciaVencimiento = signal('');
  tipoAutorizado = signal<TipoAutorizado>('Ambos');
  nota = signal('');
  tags = signal<string[]>([]);
  tagInput = signal('');
  readonly tagsSugeridos = CONDUCTOR_TAGS_SUGERIDOS;
  submitting = signal(false);

  // C4/C5 — documentos opcionales capturados en el alta (se suben tras crear,
  // con el id devuelto). La licencia admite frente y dorso (backend: N por tipo).
  docCedula = signal<CapturedDoc | null>(null);
  docLicFrente = signal<CapturedDoc | null>(null);
  docLicDorso = signal<CapturedDoc | null>(null);

  // P8 — paso opcional "Generar acceso" tras crear un conductor nuevo.
  mostrarAcceso = signal(false);
  nuevoConductorId = signal('');
  private destinoTrasAlta: string[] = ['/transporte/conductores'];

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
        nota: this.nota(),
        tags: this.tags(),
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
        this.nota.set(d.nota ?? '');
        this.tags.set(d.tags ?? []);
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
    try {
      this.categorias.set(await this.licCategorias.getCategorias());
    } catch {
      /* offline sin caché previa: el select queda con la opción actual si la hay */
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
          this.nota.set(c.nota ?? '');
          this.tags.set(c.tags ?? []);
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
      this.toast.error('Elige la categoría de licencia.');
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
      nota: this.nota() || null,
      tags: this.tags(),
    };
    try {
      const id = this.esEdicion()
        ? (await this.conductores.actualizarConductor(this.conductorId(), input), this.conductorId())
        : await this.conductores.crearConductor(input);
      // C4/C5 — sube (encola, offline-safe) cédula/licencia capturadas. Un fallo
      // aquí no revierte el conductor ya guardado; se avisa aparte.
      let subioDocs = false;
      try {
        subioDocs = await this.subirDocs(id);
      } catch {
        this.toast.error('El conductor se guardó, pero un documento no se pudo encolar. Súbelo desde su perfil.');
      }
      void this.autosave.discard(this.clave());
      this.toast.success(this.esEdicion() ? 'Conductor actualizado.' : 'Conductor creado.');
      // Si hubo documentos, abre el perfil para verlos; si no, la lista.
      const destino = subioDocs || this.esEdicion() ? ['/transporte/conductor', id] : ['/transporte/conductores'];
      if (this.esEdicion()) {
        void this.router.navigate(destino, { replaceUrl: true });
      } else {
        // P8 — conductor NUEVO: ofrecer generar el acceso (PIN 6 dígitos) antes
        // de salir. El modal ya maneja el caso offline (se puede hacer luego).
        this.destinoTrasAlta = destino;
        this.nuevoConductorId.set(id);
        this.mostrarAcceso.set(true);
        this.submitting.set(false);
      }
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar el conductor.');
      this.submitting.set(false);
    }
  }

  /** P8 — cerrar el paso de acceso (generado o saltado) → salir del alta. */
  finalizarAlta(): void {
    this.mostrarAcceso.set(false);
    void this.router.navigate(this.destinoTrasAlta, { replaceUrl: true });
  }

  /** C4/C5 — encola las fotos de documento capturadas (cédula + licencia
   *  frente/dorso). Devuelve true si había alguna. */
  private async subirDocs(id: string): Promise<boolean> {
    const items: Array<{ tipo: 'cedula' | 'licencia'; doc: CapturedDoc }> = [];
    const ced = this.docCedula();
    if (ced) items.push({ tipo: 'cedula', doc: ced });
    const frente = this.docLicFrente();
    if (frente) items.push({ tipo: 'licencia', doc: frente });
    const dorso = this.docLicDorso();
    if (dorso) items.push({ tipo: 'licencia', doc: dorso });
    for (const it of items) {
      await this.documentos.enqueueDocumento({ entidad: 'conductor', entidadId: id, tipo: it.tipo, doc: it.doc });
    }
    return items.length > 0;
  }

  // C3 — tags (chips). Texto libre + sugerencias; sin duplicados.
  agregarTag(valor: string): void {
    const t = valor.trim();
    if (!t) return;
    this.tags.update((cur) => (cur.some((x) => x.toLowerCase() === t.toLowerCase()) ? cur : [...cur, t]));
    this.tagInput.set('');
  }
  quitarTag(tag: string): void {
    this.tags.update((cur) => cur.filter((t) => t !== tag));
  }
  toggleSugerencia(tag: string): void {
    if (this.tags().some((t) => t.toLowerCase() === tag.toLowerCase())) this.quitarTag(tag);
    else this.agregarTag(tag);
  }

  back(): void {
    this.location.back();
  }
}
