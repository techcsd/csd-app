import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { ToastService } from '../../../core/services/toast.service';
import { NetworkService } from '../../../core/services/network.service';
import { ImportacionService, ENTIDADES_IMPORTACION, EntidadImportacion } from '../../../core/services/importacion.service';
import { parseXlsxTable } from '../../../core/util/xlsx-generic';
import { unzipToMap, mimeForFilename } from '../../../core/util/zip-files';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

interface ResultadoFinal {
  nuevos: number;
  actualizados: number;
  errores: { i: number; motivo: string }[];
  fotosSubidas: number;
  fotosFallidas: number;
}

/**
 * CSD-importar — import masivo de Choferes/Vehículos (mobile = solo subida): elige
 * el .xlsx ya lleno (generado por la plantilla de SGC web) + un .zip de fotos
 * opcional, y llama los mismos RPCs que la web. Sin generación de plantilla ni UI
 * de mapeo de columnas — se asume el header exacto de la plantilla web.
 */
@Component({
  selector: 'app-importar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './importar.html',
  styleUrl: './importar.scss',
})
export class ImportarPage {
  private importacion = inject(ImportacionService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private i18n = inject(I18nService);

  readonly entidades = ENTIDADES_IMPORTACION;

  /** Glifos desde TS (guarda AW12/no-ai-tropes: nada de emoji literal en la plantilla). */
  readonly glyph = {
    exito: '✅',
    warn: '⚠️',
    conductores: '🪪',
    vehiculos: '🚙',
    archivo: '📄',
    foto: '🖼️',
  };

  tipo = signal<'conductores' | 'vehiculos'>('conductores');
  entidadActual = computed<EntidadImportacion>(
    () => this.entidades.find((e) => e.key === this.tipo()) ?? this.entidades[0],
  );

  archivoNombre = signal<string | null>(null);
  parseando = signal(false);
  headers = signal<string[]>([]);
  filas = signal<Record<string, string>[]>([]);

  zipNombre = signal<string | null>(null);
  fotosZip = signal<Map<string, Uint8Array> | null>(null);

  importando = signal(false);
  resultado = signal<ResultadoFinal | null>(null);

  mapeo = computed(() => this.importacion.mapearColumnas(this.entidadActual(), this.headers()));
  faltantes = computed(() => this.importacion.camposFaltantes(this.entidadActual(), this.mapeo()));
  faltantesLabels = computed(() => this.faltantes().map((c) => c.label).join(', '));

  /** Cuántas filas traen un nombre de archivo de foto (para avisar si falta el .zip). */
  filasConFoto = computed(() => {
    const col = this.mapeo()['archivo_foto'];
    if (!col) return 0;
    return this.filas().filter((r) => !!r[col]?.trim()).length;
  });

  tieneArchivo = computed(() => this.filas().length > 0 && !this.faltantes().length);

  constructor() {
    const tipoParam = this.route.snapshot.queryParamMap.get('tipo');
    if (tipoParam === 'conductores' || tipoParam === 'vehiculos') this.tipo.set(tipoParam);
  }

  elegirTipo(t: 'conductores' | 'vehiculos'): void {
    if (this.tipo() === t) return;
    this.tipo.set(t);
    this.resetArchivo();
  }

  private resetArchivo(): void {
    this.archivoNombre.set(null);
    this.headers.set([]);
    this.filas.set([]);
    this.zipNombre.set(null);
    this.fotosZip.set(null);
    this.resultado.set(null);
  }

  async onArchivo(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.resultado.set(null);
    if (!/\.xlsx$/i.test(file.name)) {
      this.toast.error(this.i18n.t('Elige un archivo Excel (.xlsx).'));
      input.value = '';
      return;
    }
    this.parseando.set(true);
    try {
      const buf = await file.arrayBuffer();
      const tabla = parseXlsxTable(buf);
      if (!tabla.rows.length) {
        this.toast.error(this.i18n.t('No se detectaron filas en el Excel.'));
        this.archivoNombre.set(null);
        this.headers.set([]);
        this.filas.set([]);
        return;
      }
      this.archivoNombre.set(file.name);
      this.headers.set(tabla.headers);
      this.filas.set(tabla.rows);
      const faltan = this.importacion.camposFaltantes(this.entidadActual(), this.importacion.mapearColumnas(this.entidadActual(), tabla.headers));
      if (faltan.length) {
        this.toast.error(
          this.i18n.t('Faltan columnas obligatorias en el archivo: {cols}', { cols: faltan.map((c) => c.label).join(', ') }),
        );
      }
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo leer el Excel.'));
      this.archivoNombre.set(null);
      this.headers.set([]);
      this.filas.set([]);
    } finally {
      this.parseando.set(false);
      input.value = '';
    }
  }

  async onZip(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) {
      this.toast.error(this.i18n.t('Elige un archivo .zip.'));
      input.value = '';
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const map = unzipToMap(buf);
      this.zipNombre.set(file.name);
      this.fotosZip.set(map);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo leer el .zip.'));
    } finally {
      input.value = '';
    }
  }

  quitarZip(): void {
    this.zipNombre.set(null);
    this.fotosZip.set(null);
  }

  async confirmar(): Promise<void> {
    if (!this.tieneArchivo() || this.importando()) return;
    if (!this.network.online()) {
      this.toast.error(this.i18n.t('Necesitas conexión para importar.'));
      return;
    }
    this.importando.set(true);
    try {
      const entidad = this.entidadActual();
      const rows = this.filas();
      const mapeo = this.mapeo();
      // 1:1 con `rows` — el RPC devuelve índices 1-based sobre este mismo arreglo.
      const filasRpc = this.importacion.construirFilas(entidad, rows, mapeo);

      const importacionId = await this.importacion.crearImportacion(entidad.key, this.archivoNombre() ?? '', filasRpc.length);
      const r = await this.importacion.importar(entidad, filasRpc, importacionId);

      let fotosSubidas = 0;
      let fotosFallidas = 0;
      const colFoto = mapeo['archivo_foto'];
      const zip = this.fotosZip();
      if (colFoto) {
        for (const f of r.filas) {
          const original = rows[f.i - 1];
          const filename = original?.[colFoto]?.trim();
          if (!filename) continue;
          const bytes = zip?.get(filename);
          if (!bytes) {
            fotosFallidas++;
            continue;
          }
          try {
            await this.importacion.subirFoto(entidad, f.id, filename, bytes, mimeForFilename(filename));
            fotosSubidas++;
          } catch {
            fotosFallidas++;
          }
        }
      }

      await this.importacion.registrarResultado(importacionId, r).catch(() => {});

      this.resultado.set({
        nuevos: r.nuevos,
        actualizados: r.actualizados,
        errores: r.errores,
        fotosSubidas,
        fotosFallidas,
      });
      this.toast.success(this.i18n.t('Importación completada.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo completar la importación.'));
    } finally {
      this.importando.set(false);
    }
  }

  nuevaImportacion(): void {
    this.resetArchivo();
  }

  verLista(): void {
    void this.router.navigate([this.tipo() === 'conductores' ? '/transporte/conductores' : '/transporte/vehiculos']);
  }

  back(): void {
    this.location.back();
  }
}
