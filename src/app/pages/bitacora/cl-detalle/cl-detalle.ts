import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { CameraService, CapturedPhoto } from '../../../core/services/camera.service';
import { ClLiberacionService } from '../../../core/services/cl-liberacion.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { ClFirmaRol, ClItemRevision, ClRegistroDetalle, CL_FIRMA_ROLES } from '../../../core/models/cl-liberacion.model';
import { formatFechaHumana } from '../../../core/util/fecha';

/**
 * Q5 (3b) — detalle de un CL de liberación para revisarlo y FIRMAR el rol propio.
 * Alcanzable desde el aviso "Solicitar firma" (ruta /bitacora/cl/:id) o desde la
 * bandeja "Liberaciones por firmar". Firma por trazo o (cliente) por foto; la
 * firma se inserta directo (online) y el trigger pasa el CL a 'firmado' al tener
 * Residente + Responsable.
 */
@Component({
  selector: 'app-cl-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, OptionButton, SignaturePad],
  templateUrl: './cl-detalle.html',
  styleUrl: './cl-detalle.scss',
})
export class ClDetallePage {
  private route = inject(ActivatedRoute);
  private service = inject(ClLiberacionService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private camera = inject(CameraService);
  private location = inject(Location);

  private sig = viewChild(SignaturePad);

  readonly roles = CL_FIRMA_ROLES;
  private id = '';
  loading = signal(true);
  error = signal(false);
  cl = signal<ClRegistroDetalle | null>(null);
  fmt = formatFechaHumana;
  online = this.network.online;

  firmaRol = signal<ClFirmaRol | null>(null);
  firmaNombre = signal('');
  firmaLista = signal(false);
  firmaFoto = signal<CapturedPhoto | null>(null);
  firmando = signal(false);

  firmado = computed(() => this.cl()?.estado === 'firmado');
  firmaEstados = computed(() => {
    const puestas = new Set((this.cl()?.firmas ?? []).map((f) => f.rol));
    return CL_FIRMA_ROLES.map((r) => ({ ...r, firmada: puestas.has(r.value) }));
  });

  // S14 — ítems del review agrupados por sección.
  gruposItems = computed(() => {
    const items = this.cl()?.items ?? [];
    const grupos = new Map<string, ClItemRevision[]>();
    for (const it of items) {
      const s = it.seccion?.trim() || 'General';
      if (!grupos.has(s)) grupos.set(s, []);
      grupos.get(s)!.push(it);
    }
    return [...grupos.entries()].map(([seccion, items]) => ({ seccion, items }));
  });
  // Etiqueta de la firma existente por rol (para mostrar quién firmó).
  firmaDe(rol: string): { nombre: string | null; firma_url?: string | null } | undefined {
    return (this.cl()?.firmas ?? []).find((f) => f.rol === rol);
  }

  constructor() {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      const cl = await this.service.getCl(this.id);
      this.cl.set(cl);
      if (!cl) this.error.set(true);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  pickRol(rol: ClFirmaRol): void {
    this.firmaRol.set(rol);
  }

  rolLabel(rol: ClFirmaRol): string {
    return CL_FIRMA_ROLES.find((r) => r.value === rol)?.label ?? rol;
  }

  async subirFirmaFoto(desdeGaleria: boolean): Promise<void> {
    const photo = desdeGaleria ? (await this.camera.pickFromGallery())[0] ?? null : await this.camera.takePhoto();
    if (photo) {
      const prev = this.firmaFoto();
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      this.firmaFoto.set(photo);
    }
  }
  quitarFirmaFoto(): void {
    const p = this.firmaFoto();
    if (p) URL.revokeObjectURL(p.previewUrl);
    this.firmaFoto.set(null);
  }

  async firmar(): Promise<void> {
    if (this.firmando()) return;
    const rol = this.firmaRol();
    if (!rol) {
      this.toast.error('Elige el rol que firma.');
      return;
    }
    if (!this.online()) {
      this.toast.error('Necesitas conexión para firmar.');
      return;
    }
    const foto = this.firmaFoto();
    let blob: Blob | null | undefined;
    let metodo: 'pad' | 'foto' = 'pad';
    if (rol === 'cliente' && foto) {
      blob = foto.blob;
      metodo = 'foto';
    } else {
      blob = await this.sig()?.toBlob();
    }
    if (!blob) {
      this.toast.error(rol === 'cliente' ? 'Captura la firma o sube su foto.' : 'Captura la firma primero.');
      return;
    }
    this.firmando.set(true);
    try {
      await this.service.firmarCl({ clId: this.id, rol, nombre: this.firmaNombre().trim() || null, blob, metodo });
      this.toast.success('Firma registrada.');
      this.firmaRol.set(null);
      this.firmaNombre.set('');
      this.firmaLista.set(false);
      this.sig()?.clear();
      this.quitarFirmaFoto();
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo registrar la firma.');
    } finally {
      this.firmando.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
