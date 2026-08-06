import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { WizardExit } from '../../../shared/ui/wizard-exit/wizard-exit';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { ObraService } from '../../../core/services/obra.service';
import { NcTipo, NC_TIPO_META, Severidad, SEVERIDAD_META } from '../../../core/models/obra.model';

const MAX_FOTOS = 3;

/** AG16 FASE 2 — Levantar no conformidad (tipo, foto obligatoria, ubicación, severidad). */
@Component({
  selector: 'app-obra-nc',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PhotoSlot, OptionButton, WizardExit, BigConfirm, ConfirmDialog],
  templateUrl: './no-conformidad.html',
  styleUrl: './no-conformidad.scss',
})
export class NoConformidadPage implements OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private obra = inject(ObraService);
  private navGuard = inject(NavGuardService);
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);
  protected network = inject(NetworkService);
  private toast = inject(ToastService);
  private location = inject(Location);

  readonly slots = Array.from({ length: MAX_FOTOS }, (_, i) => i);
  readonly tipos = (Object.keys(NC_TIPO_META) as NcTipo[]).map((k) => ({ key: k, ...NC_TIPO_META[k] }));
  readonly severidades = (Object.keys(SEVERIDAD_META) as Severidad[]).map((k) => ({ key: k, ...SEVERIDAD_META[k] }));

  proyectoId = '';
  tipo = signal<NcTipo | null>(null);
  titulo = signal('');
  descripcion = signal('');
  severidad = signal<Severidad>('media');
  ubicacion = signal('');
  // Responsable (opcional) — quién debe corregir. Búsqueda por RPC buscar_usuarios.
  respBusqueda = signal('');
  respResultados = signal<{ id: string; nombre: string }[]>([]);
  respSel = signal<{ id: string; nombre: string } | null>(null);
  buscandoResp = signal(false);
  bloqueaVaciado = signal(false);
  fotos = signal<Record<number, CapturedPhoto>>({});

  submitting = signal(false);
  done = signal(false);
  confirmSalir = signal(false);
  borradorPrevio = signal(false);
  private hydrated = false;

  puedeGuardar = computed(
    () => !!this.tipo() && !!this.titulo().trim() && !!this.descripcion().trim() && Object.keys(this.fotos()).length > 0,
  );

  private get clave(): string {
    return `obra_nc:${this.proyectoId}`;
  }

  private readonly backHandler = (): boolean => {
    if (!this.done() && this.tieneDatos()) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  constructor() {
    this.proyectoId = this.route.snapshot.paramMap.get('proyectoId') ?? '';
    void this.restoreDraft();
    this.navGuard.register(this.backHandler);
    effect(() => {
      const snap = {
        tipo: this.tipo(), titulo: this.titulo(), descripcion: this.descripcion(),
        severidad: this.severidad(), ubicacion: this.ubicacion(), bloqueaVaciado: this.bloqueaVaciado(),
        respSel: this.respSel(),
      };
      if (!this.hydrated || this.submitting() || this.done()) return;
      this.autosave.queue(this.clave, snap, { tipo: 'obra_nc', etiqueta: 'No conformidad', ruta: this.location.path() });
    });
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }

  private async restoreDraft(): Promise<void> {
    const d = await this.borrador.load<{
      tipo: NcTipo | null; titulo: string; descripcion: string; severidad: Severidad; ubicacion: string; bloqueaVaciado: boolean;
      respSel?: { id: string; nombre: string } | null;
    }>(this.clave);
    if (d) {
      this.tipo.set(d.tipo ?? null);
      this.titulo.set(d.titulo ?? '');
      this.descripcion.set(d.descripcion ?? '');
      this.severidad.set(d.severidad ?? 'media');
      this.ubicacion.set(d.ubicacion ?? '');
      this.bloqueaVaciado.set(d.bloqueaVaciado ?? false);
      this.respSel.set(d.respSel ?? null);
      const fotos = await this.borrador.loadFotos(this.clave);
      if (fotos.length) {
        const map: Record<number, CapturedPhoto> = {};
        for (const f of fotos) {
          const idx = Number(f.slot);
          if (Number.isFinite(idx)) map[idx] = { blob: f.blob, previewUrl: URL.createObjectURL(f.blob) };
        }
        this.fotos.set(map);
      }
      this.borradorPrevio.set(true);
    }
    this.hydrated = true;
  }

  private tieneDatos(): boolean {
    return !!this.tipo() || !!this.titulo().trim() || !!this.descripcion().trim() || Object.keys(this.fotos()).length > 0;
  }

  onFoto(idx: number, photo: CapturedPhoto): void {
    this.fotos.update((f) => ({ ...f, [idx]: photo }));
    void this.borrador.saveFoto(this.clave, String(idx), photo.blob);
  }
  onFotoCleared(idx: number): void {
    this.fotos.update((f) => {
      const next = { ...f };
      delete next[idx];
      return next;
    });
    void this.borrador.removeFoto(this.clave, String(idx));
  }

  async buscarResp(): Promise<void> {
    const term = this.respBusqueda().trim();
    if (term.length < 2) {
      this.respResultados.set([]);
      return;
    }
    this.buscandoResp.set(true);
    try {
      this.respResultados.set(await this.obra.buscarUsuarios(term));
    } finally {
      this.buscandoResp.set(false);
    }
  }
  pickResp(u: { id: string; nombre: string }): void {
    this.respSel.set(u);
    this.respResultados.set([]);
    this.respBusqueda.set('');
  }
  clearResp(): void {
    this.respSel.set(null);
    this.respResultados.set([]);
    this.respBusqueda.set('');
  }

  pedirSalir(): void {
    if (!this.done() && this.tieneDatos()) this.confirmSalir.set(true);
    else this.salir();
  }
  cancelarSalir(): void {
    this.confirmSalir.set(false);
  }
  salir(): void {
    this.confirmSalir.set(false);
    void this.router.navigate(['/obra']);
  }

  async guardar(): Promise<void> {
    if (this.submitting() || !this.puedeGuardar()) return;
    this.submitting.set(true);
    try {
      const fotosMap = this.fotos();
      const fotos = this.slots.map((i) => fotosMap[i]?.blob).filter((b): b is Blob => !!b);
      await this.obra.enqueueNc({
        proyectoId: this.proyectoId,
        tipo: this.tipo()!,
        titulo: this.titulo().trim(),
        descripcion: this.descripcion().trim(),
        severidad: this.severidad(),
        ubicacion: this.ubicacion().trim() || null,
        responsableId: this.respSel()?.id ?? null,
        bloqueaVaciado: this.bloqueaVaciado(),
        fotos,
      });
      await this.autosave.discard(this.clave);
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar la no conformidad.');
    } finally {
      this.submitting.set(false);
    }
  }

  cerrar(): void {
    void this.router.navigate(['/obra']);
  }
}
