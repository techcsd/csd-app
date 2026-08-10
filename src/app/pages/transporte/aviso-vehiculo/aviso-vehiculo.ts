import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { VehiculoPicker } from '../../../shared/ui/vehiculo-picker/vehiculo-picker';
import { VoiceNotes, VoiceNoteItem } from '../../../shared/ui/voice-notes/voice-notes';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { VehiculosService, AlertasVehiculo, MiNovedad } from '../../../core/services/vehiculos.service';
import { VehiculoDisponible } from '../../../core/models/transporte.model';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatFecha, formatFechaHumana } from '../../../core/util/fecha';

type Severidad = 'baja' | 'media' | 'alta';

/** AK16 — límite propuesto de duración de video (segundos). ⚠️ confirmar con Xaviel. */
const VIDEO_MAX_SEG = 60;

/**
 * AI13/AK16 — "Aviso de vehículo": (a) Reportar novedad/daño (descripción + foto(s)
 * + VIDEO + NOTA DE VOZ + severidad → roles de flota, push + bandeja); (b) Alertas
 * del vehículo; (c) "Mis reportes" (el chofer ve los suyos con su estado).
 */
@Component({
  selector: 'app-aviso-vehiculo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, OptionButton, PhotoSlot, VehiculoPicker, VoiceNotes],
  templateUrl: './aviso-vehiculo.html',
  styleUrl: './aviso-vehiculo.scss',
})
export class AvisoVehiculoPage {
  private vehiculos = inject(VehiculosService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private location = inject(Location);

  fmtFecha = formatFecha;
  fmtFechaHora = formatFechaHumana;
  readonly videoMaxSeg = VIDEO_MAX_SEG;

  tab = signal<'reportar' | 'alertas' | 'mios'>('reportar');
  vehiculo = signal<VehiculoDisponible | null>(null);

  // Reportar
  descripcion = signal('');
  severidad = signal<Severidad>('media');
  fotos = signal<(CapturedPhoto | null)[]>([null, null, null]);
  // AK16 — videos + notas de voz.
  videos = signal<{ blob: Blob; url: string }[]>([]);
  notasVoz = signal<VoiceNoteItem[]>([]);
  enviando = signal(false);

  fotosValidas = computed(() => this.fotos().filter((f): f is CapturedPhoto => !!f));
  puedeReportar = computed(() => !!(this.vehiculo() && this.descripcion().trim() && this.fotosValidas().length));

  // Alertas
  alertas = signal<AlertasVehiculo | null>(null);
  cargandoAlertas = signal(false);

  // AK16 — "Mis reportes" (novedades que YO reporté).
  misReportes = signal<MiNovedad[]>([]);
  cargandoMios = signal(false);

  estadoLabel(e: string): string {
    return e === 'atendido' ? 'Atendido' : e === 'pendiente' ? 'Pendiente' : e;
  }

  irTab(t: 'reportar' | 'alertas' | 'mios'): void {
    this.tab.set(t);
    if (t === 'mios' && !this.misReportes().length) void this.cargarMisReportes();
  }

  private async cargarMisReportes(): Promise<void> {
    this.cargandoMios.set(true);
    try {
      this.misReportes.set(await this.vehiculos.misNovedadesReportadas());
    } catch {
      /* best-effort */
    } finally {
      this.cargandoMios.set(false);
    }
  }

  /** AK16 — captura un video con la cámara (input nativo, límite propuesto 60s). */
  async agregarVideo(): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.setAttribute('capture', 'environment');
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      this.videos.update((list) => [...list, { blob: file, url: URL.createObjectURL(file) }]);
    };
    input.click();
  }

  quitarVideo(i: number): void {
    this.videos.update((list) => {
      const v = list[i];
      if (v) URL.revokeObjectURL(v.url);
      return list.filter((_, idx) => idx !== i);
    });
  }

  onVehiculo(v: VehiculoDisponible): void {
    this.vehiculo.set(v);
    void this.cargarAlertas();
  }

  cambiarVehiculo(): void {
    this.vehiculo.set(null);
    this.alertas.set(null);
  }

  setFoto(i: number, p: CapturedPhoto | null): void {
    this.fotos.update((list) => list.map((f, idx) => (idx === i ? p : f)));
  }

  private async cargarAlertas(): Promise<void> {
    const v = this.vehiculo();
    if (!v) return;
    this.cargandoAlertas.set(true);
    try {
      this.alertas.set(await this.vehiculos.getAlertasVehiculo(v.vehiculo_id));
    } catch {
      /* best-effort */
    } finally {
      this.cargandoAlertas.set(false);
    }
  }

  async reportar(): Promise<void> {
    const v = this.vehiculo();
    if (!v) {
      this.toast.error('Elige el vehículo.');
      return;
    }
    if (!this.descripcion().trim()) {
      this.toast.error('Describe la novedad.');
      return;
    }
    if (!this.fotosValidas().length) {
      this.toast.error('Toma al menos una foto de la novedad.');
      return;
    }
    if (this.enviando()) return;
    this.enviando.set(true);
    try {
      await this.vehiculos.reportarNovedad({
        vehiculoId: v.vehiculo_id,
        descripcion: this.descripcion().trim(),
        severidad: this.severidad(),
        fotos: this.fotosValidas().map((f) => f.blob),
        videos: this.videos().map((x) => x.blob), // AK16
        notasVoz: this.notasVoz().map((n) => n.blob), // AK16
      });
      this.toast.success(
        this.network.online()
          ? 'Novedad reportada. Flota fue notificada.'
          : 'Novedad guardada. Se enviará al reconectar.',
      );
      this.descripcion.set('');
      this.severidad.set('media');
      this.fotos.set([null, null, null]);
      this.videos().forEach((x) => URL.revokeObjectURL(x.url));
      this.videos.set([]);
      this.notasVoz.set([]);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo reportar la novedad.');
    } finally {
      this.enviando.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
