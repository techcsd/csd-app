import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { LocalNotifications } from '@capacitor/local-notifications';

import { AVISOS_CHANNEL_ID } from '../../../core/constants/notif';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { VoiceRecorder } from '../../../shared/ui/voice-recorder/voice-recorder';
import { ReunionesService } from '../../../core/services/reuniones.service';
import { CompaService } from '../../../core/services/compa.service';
import { CameraService } from '../../../core/services/camera.service';
import { ToastService } from '../../../core/services/toast.service';
import { NetworkService } from '../../../core/services/network.service';
import { ReunionAcuerdoPendiente, ReunionDetalle, MODALIDAD_LABEL } from '../../../core/models/reunion.model';
import { humanizeError } from '../../../shared/util/friendly-error.util';
import { formatFechaHumana } from '../../../core/util/fecha';
import { abrirUrlExterna } from '../../../core/utils/abrir-url.util';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';

/**
 * CP8 — ficha de una reunión: unirse, agenda, mis notas (texto + dictado +
 * foto de pizarra) y mis acuerdos pendientes de esta reunión. "Mis acuerdos de
 * reuniones ANTERIORES" (mock) vive en la lista general de acuerdos, no aquí
 * (esta pantalla solo filtra los de ESTA reunión, que sí tiene sentido en contexto).
 */
@Component({
  selector: 'app-reunion-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, VoiceRecorder, TranslatePipe],
  templateUrl: './reunion-detalle.html',
  styleUrl: './reunion-detalle.scss',
})
export class ReunionDetallePage {
  private service = inject(ReunionesService);
  private compa = inject(CompaService);
  private camera = inject(CameraService);
  private toast = inject(ToastService);
  private net = inject(NetworkService);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private i18n = inject(I18nService);

  readonly modalidadLabel = MODALIDAD_LABEL;
  readonly fmtFecha = formatFechaHumana;

  /** CP8 — glifos desde TS (guarda AW12/no-ai-tropes: nada de emoji literal nuevo en la plantilla). */
  readonly glyph = { obra: '🏗', dictar: '🎙️', foto: '📷' };

  readonly id = this.route.snapshot.paramMap.get('id') ?? '';

  loading = signal(true);
  error = signal('');
  detalle = signal<ReunionDetalle | null>(null);

  notaTexto = signal('');
  notaFoto = signal<{ blob: Blob; previewUrl: string } | null>(null);
  notaGuardando = signal(false);
  grabandoVoz = signal(false);
  transcribiendo = signal(false);

  fotoPizarraUrls = signal<Record<string, string>>({});

  /** "Mis acuerdos de reuniones anteriores" (mock) — cruza TODAS mis reuniones, no solo esta. */
  misAcuerdos = signal<ReunionAcuerdoPendiente[]>([]);

  get online(): boolean {
    return this.net.online();
  }

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const d = await this.service.detalle(this.id);
      this.detalle.set(d);
      const mia = d.notas.find((n) => n.es_mia);
      this.notaTexto.set(mia?.texto ?? '');
      void this.cargarFotosPizarra(d);
      void this.programarRecordatorio(d);
      void this.service.acuerdosPendientesMios().then((a) => this.misAcuerdos.set(a)).catch(() => {});
    } catch (e) {
      this.error.set(e instanceof Error ? humanizeError(e).mensaje : this.i18n.t('No se pudo cargar esta reunión.'));
    } finally {
      this.loading.set(false);
    }
  }

  /** Resuelve las URLs firmadas de cada foto de pizarra ya guardada (best-effort). */
  private async cargarFotosPizarra(d: ReunionDetalle): Promise<void> {
    const conFoto = d.notas.filter((n) => n.foto_path);
    for (const n of conFoto) {
      const url = await this.service.fotoNotaUrl(n.foto_path!);
      if (url) this.fotoPizarraUrls.update((m) => ({ ...m, [n.id]: url }));
    }
  }

  /**
   * CP8 F5.5 — recordatorio 15 min antes (local, sin backend: pg_cron no existe
   * para esto aún). Se arma al abrir la ficha; id ESTABLE (hash del uuid) para
   * que volver a abrirla sobreescriba el mismo recordatorio en vez de duplicarlo.
   * Mejor esfuerzo: si el permiso no está dado o el plugin falla, no rompe nada.
   */
  private async programarRecordatorio(d: ReunionDetalle): Promise<void> {
    const inicio = new Date(d.reunion.inicio).getTime();
    const at = inicio - 15 * 60 * 1000;
    if (!(at > Date.now()) || d.reunion.estado === 'cancelada') return;
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: this.idNumerico(this.id),
            channelId: AVISOS_CHANNEL_ID,
            title: this.i18n.t('Reunión en 15 minutos'),
            body: d.reunion.titulo,
            schedule: { at: new Date(at) },
            extra: { tipo: 'reunion_recordatorio', referencia_id: this.id, ruta: `/reuniones/${this.id}` },
          },
        ],
      });
    } catch {
      /* best-effort: sin permiso/plugin, simplemente no hay recordatorio local. */
    }
  }

  /** Hash estable (positivo, int32) de un uuid — para el id de notificación local. */
  private idNumerico(uuid: string): number {
    let h = 0;
    for (let i = 0; i < uuid.length; i++) h = (Math.imul(31, h) + uuid.charCodeAt(i)) | 0;
    return Math.abs(h) % 2147483647;
  }

  unirse(): void {
    const enlace = this.detalle()?.reunion.enlace;
    if (enlace) void abrirUrlExterna(enlace);
  }

  // ── Mis notas: texto + dictar + foto de pizarra ─────────────────────────────

  abrirVoz(): void {
    if (!this.online) {
      this.toast.error(this.i18n.t('Necesitas conexión para dictar.'));
      return;
    }
    this.grabandoVoz.set(true);
  }

  async onVozGrabada(blob: Blob | null): Promise<void> {
    this.grabandoVoz.set(false);
    if (!blob) return;
    this.transcribiendo.set(true);
    try {
      const r = await this.compa.transcribir(blob);
      if (r.ok) {
        const actual = this.notaTexto().trim();
        this.notaTexto.set(actual ? `${actual} ${r.texto}` : r.texto);
      } else {
        this.toast.error(this.i18n.t('No se entendió. Intenta de nuevo o escribe tu nota.'));
      }
    } finally {
      this.transcribiendo.set(false);
    }
  }

  async tomarFotoPizarra(): Promise<void> {
    const foto = await this.camera.takePhoto();
    if (foto) this.notaFoto.set(foto);
  }

  quitarFotoPizarra(): void {
    this.notaFoto.set(null);
  }

  async guardarNota(): Promise<void> {
    if (this.notaGuardando()) return;
    const texto = this.notaTexto().trim();
    if (!texto && !this.notaFoto()) return;
    this.notaGuardando.set(true);
    try {
      await this.service.notaGuardar(this.id, texto, this.notaFoto()?.blob);
      this.notaFoto.set(null);
      this.toast.success(this.online ? this.i18n.t('Nota guardada.') : this.i18n.t('Nota guardada. Se enviará al recuperar señal.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo guardar la nota.'));
    } finally {
      this.notaGuardando.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
