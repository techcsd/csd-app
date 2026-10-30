import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, input, output, signal } from '@angular/core';
import { BottomSheet } from '../bottom-sheet/bottom-sheet';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { CameraService, CapturedDoc } from '../../../core/services/camera.service';
import { IaConsentGate } from '../../../core/services/ia-consent-gate.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { DocumentosService } from '../../../core/services/documentos.service';
import { FlotaDocumentosIaService } from '../../../core/services/flota-documentos-ia.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { SyncService } from '../../../core/sync/sync.service';
import {
  CamposLecturaDocumento,
  FilaAplicarDocumento,
  PaginaEmparejada,
  ResultadoAplicarDocumento,
  TipoDocumentoAplicable,
} from '../../../core/models/documento-flota.model';

type Paso = 'procesando' | 'revision' | 'aplicando' | 'hecho';
interface CampoMostrado {
  label: string;
  valor: string;
}

/**
 * A5 — "Leer documento" en el perfil de UN vehículo: una foto (seguro/matrícula/
 * marbete DGII) → IA (`leer-documento-flota`) → emparejar contra la flota
 * (`flota_documentos_emparejar`) → mostrar qué cambiaría → aplicar
 * (`flota_documentos_aplicar`, SOLO Flota elevado: admin/jefe_flota/logistica). Un
 * chofer sin ese permiso puede "proponer": la foto se guarda igual (Documentos del
 * vehículo) y se avisa a Flota (`notificar_modulo`), sin aplicar el cambio él mismo.
 *
 * Degrada en cascada a la subida simple de siempre (DocumentosService.enqueueDocumento,
 * la MISMA ruta offline-safe que `onDoc()` del perfil) si: el usuario no da
 * consentimiento de IA, no hay conexión, la lectura falla, o el documento no es de un
 * tipo aplicable (licencia/otro/reverso) — nunca deja la foto sin guardar.
 */
@Component({
  selector: 'app-leer-documento-vehiculo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BottomSheet, TranslatePipe],
  templateUrl: './leer-documento-vehiculo.html',
  styleUrl: './leer-documento-vehiculo.scss',
})
export class LeerDocumentoVehiculo implements OnDestroy {
  vehiculoId = input.required<string>();
  placaVehiculo = input<string>('');

  /** Se emite cuando `flota_documentos_aplicar` aplicó el cambio (el padre refresca). */
  aplicado = output<void>();

  private camera = inject(CameraService);
  private iaGate = inject(IaConsentGate);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private documentos = inject(DocumentosService);
  private flotaIa = inject(FlotaDocumentosIaService);
  private ctx = inject(UserContextService);
  private sync = inject(SyncService);
  private i18n = inject(I18nService);

  readonly glyphCamara = '📷';
  readonly glyphAlerta = '⚠️';

  online = this.network.online;
  puedeAplicar = this.ctx.puedeAplicarDocumentosFlota;

  sheetAbierto = signal(false);
  ocupado = signal(false);
  paso = signal<Paso>('procesando');
  noAplicable = signal(false);
  mensajeError = signal('');
  mensajeFinal = signal('');
  detalleAplicado = signal<CampoMostrado[]>([]);

  private docCapturado = signal<CapturedDoc | null>(null);
  private paginaEmparejada = signal<PaginaEmparejada | null>(null);

  private static readonly TIPO_DOC_LABEL: Record<string, string> = {
    seguro: 'Seguro',
    matricula: 'Matrícula',
    marbete_dgii: 'Marbete DGII',
  };
  private static readonly CAMPO_LABEL: Record<string, string> = {
    poliza: 'N.º póliza',
    aseguradora: 'Aseguradora',
    vigencia_desde: 'Vigente desde',
    vigencia_hasta: 'Vigente hasta',
    placa: 'Placa leída',
    chasis: 'Chasis',
    marca: 'Marca',
    modelo: 'Modelo',
    anio: 'Año',
    numero_matricula: 'N.º matrícula',
    marbete_numero: 'N.º marbete',
  };
  private static readonly CAMPOS_POR_TIPO: Record<string, (keyof CamposLecturaDocumento)[]> = {
    seguro: ['aseguradora', 'poliza', 'vigencia_desde', 'vigencia_hasta'],
    matricula: ['numero_matricula', 'vigencia_hasta', 'chasis'],
    marbete_dgii: ['marbete_numero', 'vigencia_hasta'],
  };
  private static readonly CAMPOS_COMUNES: (keyof CamposLecturaDocumento)[] = ['placa', 'marca', 'modelo', 'anio'];

  tipoLabel = computed(() => {
    const p = this.paginaEmparejada();
    return p ? this.i18n.t(LeerDocumentoVehiculo.TIPO_DOC_LABEL[p.tipo] ?? p.tipo) : '';
  });

  /** ¿La placa leída coincide con ESTE vehículo (match exacta/vin + mismo id)? */
  coincideVehiculo = computed(() => {
    const p = this.paginaEmparejada();
    if (!p) return true;
    return (p.match === 'exacta' || p.match === 'vin') && p.vehiculo_id === this.vehiculoId();
  });

  camposMostrar = computed<CampoMostrado[]>(() => {
    const p = this.paginaEmparejada();
    if (!p) return [];
    const claves = [...(LeerDocumentoVehiculo.CAMPOS_POR_TIPO[p.tipo] ?? []), ...LeerDocumentoVehiculo.CAMPOS_COMUNES];
    const vistos = new Set<string>();
    const out: CampoMostrado[] = [];
    for (const k of claves) {
      if (vistos.has(k)) continue;
      vistos.add(k);
      const v = p.campos[k];
      if (v == null || String(v).trim() === '') continue;
      out.push({ label: this.i18n.t(LeerDocumentoVehiculo.CAMPO_LABEL[k] ?? k), valor: String(v) });
    }
    return out;
  });

  /** Abre la cámara para UNA foto; si se cancela, no pasa nada (sin hoja). */
  async comenzar(): Promise<void> {
    if (this.ocupado()) return;
    const doc = await this.camera.takeDocumentPhoto();
    if (!doc) return;
    this.docCapturado.set(doc);
    this.paginaEmparejada.set(null);
    this.mensajeError.set('');
    this.mensajeFinal.set('');
    this.detalleAplicado.set([]);
    this.noAplicable.set(false);
    this.paso.set('procesando');
    this.sheetAbierto.set(true);
    await this.procesar(doc);
  }

  private async procesar(doc: CapturedDoc): Promise<void> {
    // CI10 — consentimiento de IA ANTES de cualquier llamada a la edge. Sin él,
    // degrada a la subida simple de siempre (no hay nada que leer/revisar).
    if (!(await this.iaGate.pedir())) {
      await this.guardarComoDocumentoInterno('otro', this.i18n.t('Documento guardado. Se subirá cuando haya conexión.'));
      return;
    }
    if (!this.network.online()) {
      this.mensajeError.set(
        this.i18n.t('Necesitas conexión para leer el documento. Se guardará como documento pendiente.'),
      );
      this.noAplicable.set(true);
      this.paso.set('revision');
      return;
    }
    this.ocupado.set(true);
    try {
      const { data, mime } = await this.imagenBase64(doc.blob);
      const res = await this.flotaIa.leerDocumento({ data, mime });
      if (!res.ok || !res.paginas?.length) {
        this.mensajeError.set(res.error || this.i18n.t('No se pudo interpretar el documento. Llena los campos a mano.'));
        this.noAplicable.set(true);
        this.paso.set('revision');
        return;
      }
      const pagina = res.paginas[0];
      if (pagina.tipo === 'licencia' || pagina.tipo === 'otro' || pagina.tipo === 'reverso') {
        this.paginaEmparejada.set({ ...pagina, match: 'sin_vehiculo' });
        this.noAplicable.set(true);
        this.paso.set('revision');
        return;
      }
      let emp: PaginaEmparejada = { ...pagina, match: 'sin_vehiculo' };
      try {
        const emparejadas = await this.flotaIa.emparejar([pagina]);
        if (emparejadas[0]) emp = emparejadas[0];
      } catch {
        /* best-effort: sin match, igual se puede revisar/aplicar sobre ESTE vehículo */
      }
      this.paginaEmparejada.set(emp);
      this.noAplicable.set(false);
      this.paso.set('revision');
    } catch {
      this.mensajeError.set(this.i18n.t('No se pudo interpretar el documento. Llena los campos a mano.'));
      this.noAplicable.set(true);
      this.paso.set('revision');
    } finally {
      this.ocupado.set(false);
    }
  }

  /** Aplica el cambio (gated server-side; el botón ya solo se pinta a elevados). */
  async aplicar(): Promise<void> {
    const p = this.paginaEmparejada();
    const doc = this.docCapturado();
    if (!p || !doc || this.ocupado() || !this.network.online()) return;
    this.ocupado.set(true);
    this.paso.set('aplicando');
    try {
      const tipo = p.tipo as TipoDocumentoAplicable;
      const { id, path } = await this.documentos.enqueueDocumento({
        entidad: 'vehiculo',
        entidadId: this.vehiculoId(),
        tipo,
        doc,
      });
      const sincronizado = await this.esperarSincronizado(id);
      if (!sincronizado) {
        this.toast.error(
          this.i18n.t('La foto se guardó pero aún no termina de subir. Intenta "Aplicar" de nuevo en un momento.'),
        );
        this.paso.set('revision');
        return;
      }
      const filas: FilaAplicarDocumento[] = [
        { vehiculo_id: this.vehiculoId(), tipo, campos: p.campos, imagen_path: path, pagina: p.pagina },
      ];
      const resultados = await this.flotaIa.aplicar(filas);
      const r = resultados[0] as ResultadoAplicarDocumento | undefined;
      this.detalleAplicado.set(this.formatearAplicado(r));
      if (r?.omitido) {
        this.mensajeFinal.set(this.i18n.t('No se aplicó: {motivo}', { motivo: r.omitido }));
      } else if (r?.ok) {
        this.mensajeFinal.set(this.i18n.t('Documento guardado y aplicado al vehículo.'));
      } else {
        this.mensajeFinal.set(r?.error || this.i18n.t('No se pudo aplicar el cambio, pero el documento quedó guardado.'));
      }
      this.paso.set('hecho');
      this.aplicado.emit();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo aplicar el cambio.'));
      this.paso.set('revision');
    } finally {
      this.ocupado.set(false);
    }
  }

  /** Chofer sin permiso de aplicar: guarda la foto + avisa a Flota (proponer). */
  async avisarFlota(): Promise<void> {
    const p = this.paginaEmparejada();
    const doc = this.docCapturado();
    if (!doc || this.ocupado()) return;
    this.ocupado.set(true);
    try {
      const tipo: string = p && p.tipo !== 'licencia' && p.tipo !== 'otro' && p.tipo !== 'reverso' ? p.tipo : 'otro';
      await this.documentos.enqueueDocumento({ entidad: 'vehiculo', entidadId: this.vehiculoId(), tipo, doc });
      try {
        await this.flotaIa.avisarFlota(
          this.placaVehiculo() || this.vehiculoId(),
          this.tipoLabel() || this.i18n.t('un documento'),
          this.vehiculoId(),
        );
      } catch {
        /* best-effort: el documento ya quedó guardado aunque el aviso a Flota falle */
      }
      this.mensajeFinal.set(this.i18n.t('Documento enviado a Flota para revisión.'));
      this.detalleAplicado.set([]);
      this.paso.set('hecho');
    } catch {
      this.toast.error(this.i18n.t('No se pudo guardar el documento.'));
    } finally {
      this.ocupado.set(false);
    }
  }

  /** Fallback de "Guardar como documento" (no aplicable / no se pudo leer). */
  async guardarComoDocumento(): Promise<void> {
    await this.guardarComoDocumentoInterno('otro', this.i18n.t('Documento guardado. Se subirá cuando haya conexión.'));
  }

  private async guardarComoDocumentoInterno(tipo: string, mensaje: string): Promise<void> {
    const doc = this.docCapturado();
    if (!doc || this.ocupado()) return;
    this.ocupado.set(true);
    try {
      await this.documentos.enqueueDocumento({ entidad: 'vehiculo', entidadId: this.vehiculoId(), tipo, doc });
      this.mensajeFinal.set(mensaje);
      this.detalleAplicado.set([]);
      this.paso.set('hecho');
    } catch {
      this.toast.error(this.i18n.t('No se pudo guardar el documento.'));
    } finally {
      this.ocupado.set(false);
    }
  }

  private formatearAplicado(r: ResultadoAplicarDocumento | undefined): CampoMostrado[] {
    if (!r?.aplicado) return [];
    return Object.entries(r.aplicado)
      .filter(([, v]) => v != null && String(v).trim() !== '')
      .map(([k, v]) => ({ label: this.i18n.t(LeerDocumentoVehiculo.CAMPO_LABEL[k] ?? k), valor: String(v) }));
  }

  /** Sondea la op del outbox hasta que sincroniza (desaparece) o queda en error. */
  private async esperarSincronizado(id: string, timeoutMs = 20000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const op = await this.sync.getOp(id);
      if (!op) return true; // éxito: el handler la sincronizó y la borró del outbox
      if (op.estado === 'error') return false;
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  }

  /** Mismo canvas/base64 que CombustibleService.leerRecibo (CF4), inline aquí: no
   *  hay un util compartido todavía y es una sola llamada. */
  private async imagenBase64(blob: Blob, max = 1600): Promise<{ data: string; mime: string }> {
    const bitmap = await createImageBitmap(blob);
    const escala = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * escala);
    const h = Math.round(bitmap.height * escala);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { data: dataUrl.split(',')[1] ?? '', mime: 'image/jpeg' };
  }

  cerrar(): void {
    if (this.ocupado()) return; // no interrumpir un "Aplicando…" en curso
    this.revocar();
    this.sheetAbierto.set(false);
    this.docCapturado.set(null);
    this.paginaEmparejada.set(null);
    this.paso.set('procesando');
    this.noAplicable.set(false);
    this.mensajeError.set('');
    this.mensajeFinal.set('');
    this.detalleAplicado.set([]);
  }

  private revocar(): void {
    const url = this.docCapturado()?.previewUrl;
    if (url) URL.revokeObjectURL(url);
  }

  ngOnDestroy(): void {
    this.revocar();
  }
}
