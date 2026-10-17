import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { ToastService } from '../../../core/services/toast.service';
import { NetworkService } from '../../../core/services/network.service';
import {
  ImportacionService,
  ENTIDADES_IMPORTACION,
  EntidadImportacion,
  FilaResultadoRpc,
} from '../../../core/services/importacion.service';
import { parseXlsxTable } from '../../../core/util/xlsx-generic';
import { unzipToMap, mimeForFilename } from '../../../core/util/zip-files';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

interface FilaPreview {
  i: number;
  clave: string;
  nombre: string;
  principal?: string;
  licenciaFrente?: string;
  licenciaDorso?: string;
}

interface CambioVista {
  campo: string;
  label: string;
  antes: unknown;
  despues: unknown;
}

interface FilaResultadoVista {
  i: number;
  id: string;
  accion: 'creado' | 'actualizado';
  clave: string;
  nombre: string;
  cambios: CambioVista[];
}

interface ResultadoFinal {
  nuevos: number;
  actualizados: number;
  errores: { i: number; motivo: string }[];
  fotosSubidas: number;
  fotosSinUsar: string[];
  filas: FilaResultadoVista[];
}

/**
 * CSD-importar — import masivo de Choferes/Vehículos (mobile = solo subida): elige
 * el .xlsx ya lleno (generado por la plantilla de SGC web) + un .zip de fotos
 * opcional (un solo picker, `multiple`), revisa el emparejamiento foto↔fila ANTES de
 * importar, llama los mismos RPCs que la web y muestra el resultado en un modal con
 * el detalle de qué cambió por fila. Sin generación de plantilla ni UI de mapeo de
 * columnas — se asume el header exacto de la plantilla web (CQ4-a: si no calza,
 * se distingue "no es la plantilla" de "le faltan columnas").
 */
@Component({
  selector: 'app-importar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './importar.html',
  styleUrl: './importar.scss',
})
export class ImportarPage implements OnDestroy {
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

  /** CQ4 — asignación manual de fotos huérfanas en la revisión: nombre de archivo → índice de fila (0-based). */
  asignacionManual = signal<Record<string, number>>({});

  importando = signal(false);
  resultado = signal<ResultadoFinal | null>(null);

  mapeo = computed(() => this.importacion.mapearColumnas(this.entidadActual(), this.headers()));
  faltantes = computed(() => this.importacion.camposFaltantes(this.entidadActual(), this.mapeo()));
  faltantesLabels = computed(() => this.faltantes().map((c) => c.label).join(', '));

  /** CQ4-a — match muy bajo + falta el/los requerido(s) → probablemente no es la plantilla del SGC. */
  noEsPlantilla = computed(() => {
    if (!this.headers().length || !this.faltantes().length) return false;
    return this.importacion.tasaCoincidencia(this.entidadActual(), this.mapeo()) < 0.5;
  });

  /** Label + ejemplo del campo clave (cédula/placa) usado para emparejar fotos por nombre. */
  claveLabel = computed(() => this.importacion.claveLabel(this.entidadActual()));
  claveEjemplo = computed(() => this.importacion.claveEjemplo(this.entidadActual()));

  tieneArchivo = computed(() => this.filas().length > 0 && !this.faltantes().length);

  /** Filas ya transformadas al shape del RPC — reusada por la revisión Y por confirmar(). */
  filasRpc = computed(() => this.importacion.construirFilas(this.entidadActual(), this.filas(), this.mapeo()));

  private previewFotos = computed(() => this.importacion.previsualizarFotos(this.entidadActual(), this.filasRpc(), this.fotosZip()));

  /** CQ4 — paso "Revisa y confirma": qué foto (si alguna) le tocó a cada fila. */
  previewFilas = computed<FilaPreview[]>(() => {
    const entidad = this.entidadActual();
    const filasRpc = this.filasRpc();
    const porFila = this.previewFotos().porFila;
    return filasRpc.map((f, idx) => {
      const clave = String(f[entidad.foto.campoClave] ?? '').trim() || '—';
      const nombre =
        entidad.key === 'conductores'
          ? String(f['nombre'] ?? '').trim() || '—'
          : [String(f['marca'] ?? '').trim(), String(f['modelo'] ?? '').trim()].filter(Boolean).join(' ') || '—';
      const slots = porFila.get(idx) ?? {};
      return { i: idx + 1, clave, nombre, principal: slots.principal, licenciaFrente: slots.licencia_frente, licenciaDorso: slots.licencia_dorso };
    });
  });

  /** Fotos del .zip que no emparejaron ninguna fila ("fotos sin dueño"). */
  fotosOrfanas = computed(() => this.previewFotos().sinDueno);

  /** CQ4 — URLs de miniatura (blob:) por nombre de archivo del .zip; se revocan al cambiar/quitar el .zip. */
  private thumbMap = new Map<string, string>();

  constructor() {
    const tipoParam = this.route.snapshot.queryParamMap.get('tipo');
    if (tipoParam === 'conductores' || tipoParam === 'vehiculos') this.tipo.set(tipoParam);

    // Reconstruye las miniaturas cada vez que cambia el .zip cargado (y revoca las anteriores).
    effect(() => {
      const zip = this.fotosZip();
      this.revokeThumbs();
      if (!zip) return;
      for (const [nombre, bytes] of zip) {
        try {
          const blob = new Blob([new Uint8Array(bytes)], { type: mimeForFilename(nombre) });
          this.thumbMap.set(nombre, URL.createObjectURL(blob));
        } catch {
          /* best-effort — si falla, simplemente no hay miniatura para ese archivo */
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.revokeThumbs();
  }

  private revokeThumbs(): void {
    for (const url of this.thumbMap.values()) URL.revokeObjectURL(url);
    this.thumbMap.clear();
  }

  /** Usado desde el template para pintar la miniatura de un archivo del .zip (o null). */
  urlFoto(nombre: string | undefined): string | null {
    return nombre ? this.thumbMap.get(nombre) ?? null : null;
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
    this.asignacionManual.set({});
    this.resultado.set(null);
  }

  /** CQ4 — un solo picker (.xlsx + .zip, `multiple`): enruta cada archivo por extensión. */
  async onArchivos(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    this.resultado.set(null);
    for (const file of files) {
      if (/\.xlsx$/i.test(file.name)) {
        await this.procesarExcel(file);
      } else if (/\.zip$/i.test(file.name)) {
        await this.procesarZip(file);
      } else {
        this.toast.error(this.i18n.t('Archivo no reconocido: {nombre} (usa .xlsx o .zip).', { nombre: file.name }));
      }
    }
    input.value = '';
  }

  private async procesarExcel(file: File): Promise<void> {
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
      this.asignacionManual.set({});

      const entidad = this.entidadActual();
      const mapeoArchivo = this.importacion.mapearColumnas(entidad, tabla.headers);
      const faltan = this.importacion.camposFaltantes(entidad, mapeoArchivo);
      if (faltan.length) {
        const tasa = this.importacion.tasaCoincidencia(entidad, mapeoArchivo);
        if (tasa < 0.5) {
          this.toast.error(
            this.i18n.t('Este archivo no es la plantilla del SGC. Descárgala desde la web o importa desde la web para mapear columnas.'),
          );
        } else {
          this.toast.error(
            this.i18n.t('Faltan columnas obligatorias en el archivo: {cols}', { cols: faltan.map((c) => c.label).join(', ') }),
          );
        }
      }
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo leer el Excel.'));
      this.archivoNombre.set(null);
      this.headers.set([]);
      this.filas.set([]);
    } finally {
      this.parseando.set(false);
    }
  }

  private async procesarZip(file: File): Promise<void> {
    try {
      const buf = await file.arrayBuffer();
      const map = unzipToMap(buf);
      this.zipNombre.set(file.name);
      this.fotosZip.set(map);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo leer el .zip.'));
    }
  }

  quitarZip(): void {
    this.zipNombre.set(null);
    this.fotosZip.set(null);
    this.asignacionManual.set({});
  }

  /** CQ4 — "¿De cuál es?": asigna a mano una foto huérfana a una fila cargada. */
  asignarFotoOrfana(nombre: string, valor: string): void {
    this.asignacionManual.update((m) => {
      const copia = { ...m };
      if (valor === '') delete copia[nombre];
      else copia[nombre] = Number(valor);
      return copia;
    });
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
      // 1:1 con `filas()` — el RPC devuelve índices 1-based sobre este mismo arreglo.
      const filasRpc = this.filasRpc();

      const importacionId = await this.importacion.crearImportacion(entidad.key, this.archivoNombre() ?? '', filasRpc.length);
      const r = await this.importacion.importar(entidad, filasRpc, importacionId);

      const zip = this.fotosZip();
      let fotosSubidas = 0;
      let fotosSinUsar: string[] = [];
      if (zip && zip.size) {
        const auto = await this.importacion.subirFotosImportadas(entidad, filasRpc, r, zip);
        fotosSubidas += auto.subidas;
        fotosSinUsar = auto.sinUsar;

        const asign = this.asignacionManual();
        const asignaciones = Object.entries(asign)
          .filter(([nombre]) => fotosSinUsar.includes(nombre) && zip.has(nombre))
          .map(([nombre, filaIndex]) => ({ filaIndex, nombre, bytes: zip.get(nombre)! }));
        if (asignaciones.length) {
          const extra = await this.importacion.subirFotosManual(entidad, r, asignaciones);
          fotosSubidas += extra;
          const asignadosNombres = new Set(asignaciones.map((a) => a.nombre));
          fotosSinUsar = fotosSinUsar.filter((n) => !asignadosNombres.has(n));
        }
      }

      await this.importacion.registrarResultado(importacionId, r).catch(() => {});

      this.resultado.set({
        nuevos: r.nuevos,
        actualizados: r.actualizados,
        errores: r.errores,
        fotosSubidas,
        fotosSinUsar,
        filas: this.construirFilasVista(entidad, filasRpc, r.filas),
      });
      this.toast.success(this.i18n.t('Importación completada.'));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo completar la importación.'));
    } finally {
      this.importando.set(false);
    }
  }

  private construirFilasVista(entidad: EntidadImportacion, filasRpc: Record<string, unknown>[], filasResultado: FilaResultadoRpc[]): FilaResultadoVista[] {
    return filasResultado.map((f) => {
      const raw = filasRpc[f.i - 1] ?? {};
      const clave = String(raw[entidad.foto.campoClave] ?? '').trim();
      const nombre =
        entidad.key === 'conductores'
          ? String(raw['nombre'] ?? '').trim()
          : [String(raw['marca'] ?? '').trim(), String(raw['modelo'] ?? '').trim()].filter(Boolean).join(' ');
      const cambios: CambioVista[] = Object.entries(f.cambios ?? {}).map(([campo, c]) => ({
        campo,
        label: this.importacion.labelCampo(entidad, campo),
        antes: c.antes,
        despues: c.despues,
      }));
      return { i: f.i, id: f.id, accion: f.accion ?? 'creado', clave, nombre, cambios };
    });
  }

  /** Valor legible de un {antes, despues} del detalle de cambios (vacío → "—"). */
  textoValor(v: unknown): string {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? this.i18n.t('Sí') : this.i18n.t('No');
    return String(v);
  }

  abrirPerfil(fila: FilaResultadoVista): void {
    const ruta = this.tipo() === 'conductores' ? `/transporte/conductor/${fila.id}` : `/transporte/vehiculo/${fila.id}`;
    this.resultado.set(null);
    void this.router.navigate([ruta]);
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
