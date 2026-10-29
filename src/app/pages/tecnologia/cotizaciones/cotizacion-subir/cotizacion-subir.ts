import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CameraService, CapturedDoc } from '../../../../core/services/camera.service';
import { CotizacionesService } from '../../../../core/services/cotizaciones.service';
import { IaConsentGate } from '../../../../core/services/ia-consent-gate.service';
import { ToastService } from '../../../../core/services/toast.service';
import { I18nService } from '../../../../core/i18n/i18n.service';
import { CompraTecSelector } from '../../../../core/models/cotizacion.model';
import { TranslatePipe } from '../../../../core/i18n/translate.pipe';
import { MOTION_DIRECTIVES } from '../../../../shared/motion';

/**
 * CZ1/CZ6 — Subir una cotización (foto o PDF), con lectura automática por IA
 * (reusa `leer-cotizacion`, sin cambios) y ligar opcional a una compra
 * tecnológica. Ligar a equipos y corregir renglones queda en la web (DZ-25).
 */
@Component({
  selector: 'app-cotizacion-subir',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './cotizacion-subir.html',
  styleUrl: './cotizacion-subir.scss',
})
export class CotizacionSubirPage {
  private camera = inject(CameraService);
  private service = inject(CotizacionesService);
  private iaGate = inject(IaConsentGate);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private router = inject(Router);

  archivo = signal<CapturedDoc | null>(null);
  leyendo = signal(false);
  leido = signal(false);
  leidoFallo = signal(false);
  guardando = signal(false);

  // ── Revisión / formulario (prellenado por la lectura, siempre editable) ──
  titulo = signal('');
  proveedor = signal('');
  fecha = signal('');
  moneda = signal<'DOP' | 'USD'>('DOP');
  subtotal = signal<number | null>(null);
  itbis = signal<number | null>(null);
  total = signal<number | null>(null);
  notas = signal('');

  private lecturaCruda: unknown = null;
  private costoUsd: number | null = null;

  comprasTec = signal<CompraTecSelector[]>([]);
  compraSeleccionada = signal<string | null>(null);
  cargandoCompras = signal(false);

  constructor() {
    void this.cargarCompras();
  }

  private async cargarCompras(): Promise<void> {
    this.cargandoCompras.set(true);
    try {
      this.comprasTec.set(await this.service.listarComprasTec());
    } finally {
      this.cargandoCompras.set(false);
    }
  }

  async tomarFoto(): Promise<void> {
    const doc = await this.camera.takeDocumentPhoto();
    if (!doc) return;
    this.archivo.set(doc);
    await this.leer(doc);
  }

  async elegirArchivo(): Promise<void> {
    const doc = await this.camera.pickDocument();
    if (!doc) return;
    this.archivo.set(doc);
    await this.leer(doc);
  }

  private async leer(doc: CapturedDoc): Promise<void> {
    if (!(await this.iaGate.pedir())) return; // CI10 — consentimiento de IA
    this.leyendo.set(true);
    this.leidoFallo.set(false);
    try {
      const mime = doc.esImagen ? 'image/jpeg' : 'application/pdf';
      const res = await this.service.leerCotizacion(doc.blob, mime);
      if (res.ok && res.lectura) {
        const l = res.lectura;
        this.proveedor.set(l.proveedor ?? '');
        this.fecha.set(l.fecha ?? '');
        if (l.moneda === 'USD' || l.moneda === 'DOP') this.moneda.set(l.moneda);
        this.itbis.set(l.itbis ?? null);
        this.total.set(l.total ?? null);
        if (l.articulos?.length) {
          const suma = l.articulos.reduce((acc, a) => acc + (a.precio ?? 0) * (a.cantidad ?? 1), 0);
          this.subtotal.set(suma || null);
        }
        if (!this.titulo().trim()) this.titulo.set(l.proveedor || doc.nombre);
        this.lecturaCruda = l;
        this.costoUsd = res.costo_usd ?? null;
        this.leido.set(true);
      } else {
        this.leidoFallo.set(true);
        if (!this.titulo().trim()) this.titulo.set(doc.nombre);
      }
    } finally {
      this.leyendo.set(false);
    }
  }

  async guardar(): Promise<void> {
    const t = this.titulo().trim() || this.proveedor().trim();
    if (!t) {
      this.toast.error(this.i18n.t('Escribe al menos el proveedor o un título.'));
      return;
    }
    this.guardando.set(true);
    try {
      const doc = this.archivo();
      await this.service.crear({
        titulo: t,
        proveedor: this.proveedor().trim() || null,
        fecha: this.fecha() || null,
        moneda: this.moneda(),
        subtotal: this.subtotal(),
        itbis: this.itbis(),
        total: this.total(),
        notas: this.notas().trim() || null,
        lectura: this.lecturaCruda,
        lectura_costo_usd: this.costoUsd,
        archivo: doc ? { blob: doc.blob, nombre: doc.nombre } : null,
        compraId: this.compraSeleccionada(),
      });
      this.toast.success(this.i18n.t('Cotización guardada.'));
      void this.router.navigate(['/tecnologia/cotizaciones']);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo guardar la cotización.'));
    } finally {
      this.guardando.set(false);
    }
  }

  cancelar(): void {
    void this.router.navigate(['/tecnologia/cotizaciones']);
  }
}
