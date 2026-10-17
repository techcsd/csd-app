import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { mimeForFilename } from '../util/zip-files';
import { parseNumeroFlexible, type NumeroModo } from '../util/numero';

/**
 * CSD-importar — import masivo de Choferes/Vehículos desde Excel (+ fotos vía .zip),
 * mobile es "solo subida": asume los headers EXACTOS de la plantilla que genera SGC
 * web (`src/shared/services/importador.service.ts` en el repo padre) — sin UI de
 * mapeo de columnas. Llama los mismos RPCs que la web
 * (`sql/2026-10-16-importar-choferes-vehiculos-fotos.sql`, ya en sgc-dev).
 *
 * CQ4 — labels EXACTOS copiados de `importador.service.ts` (padre): la plantilla web
 * usa `campo.label` tal cual como encabezado de columna, así que copiarlos al dedillo
 * es lo que hace que re-subir esa plantilla automapee el 100% de las columnas.
 */

export interface CampoImportacion {
  t: string;
  label: string;
  requerido?: boolean;
}

export interface FotoImportacion {
  bucket: string;
  /** 't' del campo que identifica la fila (cedula/placa) — así se empareja la foto
   *  del .zip sin necesitar una columna "archivo_foto" en el Excel. */
  campoClave: string;
  campoDestino: string;
  /** Mismo criterio de normalización que el RPC/servidor, para comparar contra el
   *  nombre de archivo (sin extensión) del .zip. */
  normalizar: (raw: string) => string;
  ruta: (id: string, filename: string) => string;
}

export interface EntidadImportacion {
  key: 'conductores' | 'vehiculos';
  label: string;
  rpc: string;
  campos: CampoImportacion[];
  foto: FotoImportacion;
}

export const ENTIDADES_IMPORTACION: EntidadImportacion[] = [
  {
    key: 'conductores',
    label: 'Choferes',
    rpc: 'importar_conductores',
    campos: [
      { t: 'cedula', label: 'Cédula', requerido: true },
      { t: 'nombre', label: 'Nombre', requerido: true },
      { t: 'telefono', label: 'Teléfono' },
      { t: 'licencia_tipo', label: 'Categoría de licencia (código, ej. 02)' },
      { t: 'licencia_numero', label: 'N° de licencia' },
      { t: 'licencia_vencimiento', label: 'Vencimiento de licencia (AAAA-MM-DD)' },
      { t: 'tipo_vehiculo_autorizado', label: 'Vehículo autorizado (Liviano/Pesado/Ambos)' },
      // CQ4-f — campos nuevos del formulario real (conductores.html), ya en el RPC.
      { t: 'vehiculo_id', label: 'Vehículo asignado (placa)' },
      { t: 'tags', label: 'Tags (separados por coma)' },
      { t: 'activo', label: 'Activo (sí/no)' },
      { t: 'nota', label: 'Nota' },
    ],
    foto: {
      bucket: 'conductores',
      campoClave: 'cedula',
      campoDestino: 'foto_path',
      normalizar: (s) => s.replace(/\D/g, ''),
      ruta: (id, filename) => `conductor/${id}/import-${Date.now()}-${filename}`,
    },
  },
  {
    key: 'vehiculos',
    label: 'Vehículos',
    rpc: 'importar_vehiculos',
    campos: [
      { t: 'placa', label: 'Placa', requerido: true },
      { t: 'marca', label: 'Marca' },
      { t: 'modelo', label: 'Modelo' },
      { t: 'anio', label: 'Año (si no se indica, usa el año actual)' },
      { t: 'color', label: 'Color' },
      { t: 'tipo', label: 'Tipo' },
      // CQ4-e — campos nuevos del formulario real (vehiculos.html), ya en el RPC.
      { t: 'vin', label: 'VIN / Serial' },
      { t: 'alias', label: 'Nombre / Alias' },
      { t: 'estado', label: 'Estado' },
      { t: 'uso', label: 'Uso (Obra/Oficina)' },
      { t: 'medida_uso', label: 'Medida de uso (Km/Horas)' },
      { t: 'kilometraje', label: 'Kilometraje / lectura actual' },
      { t: 'capacidad_valor', label: 'Capacidad de carga (valor)' },
      { t: 'capacidad_unidad', label: 'Unidad de capacidad' },
      { t: 'numero_matricula', label: 'N° de matrícula' },
      { t: 'vencimiento_matricula', label: 'Vencimiento de matrícula (AAAA-MM-DD)' },
      { t: 'numero_seguro', label: 'N° de seguro (póliza)' },
      { t: 'aseguradora', label: 'Compañía aseguradora' },
      { t: 'vencimiento_seguro', label: 'Vencimiento de seguro (AAAA-MM-DD)' },
      { t: 'km_ultimo_mantenimiento', label: 'Km/horas último mantenimiento' },
      { t: 'intervalo_mantenimiento_km', label: 'Intervalo de mantenimiento (km)' },
      { t: 'intervalo_mantenimiento_horas', label: 'Intervalo de mantenimiento (horas)' },
      { t: 'rendimiento_esperado_km_gal', label: 'Rendimiento esperado (km/gal)' },
      { t: 'notas', label: 'Notas' },
      { t: 'es_prueba', label: 'Dato de prueba (sí/no)' },
    ],
    foto: {
      bucket: 'vehiculos',
      campoClave: 'placa',
      campoDestino: 'foto_portada',
      normalizar: (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, ''),
      ruta: (id, filename) => `vehiculo/${id}/import-${Date.now()}-${filename}`,
    },
  },
];

/** Serial de Excel (base 1899-12-30) → ISO yyyy-mm-dd. */
function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Celda de fecha → AAAA-MM-DD. Mismo criterio para los 3 campos de fecha: si Excel
 *  "auto-formateó" la celda como fecha, llega como serial numérico en vez de texto. */
function parseFechaCelda(raw: string): string {
  if (/^\d+(\.\d+)?$/.test(raw) && Number(raw) >= 25000 && Number(raw) <= 60000) {
    return excelSerialToIso(Number(raw)) ?? raw;
  }
  return raw;
}

/** Texto común (ES) → booleano. Cualquier otra cosa (no/false/0/vacío) → false. */
function parseBooleano(raw: string): boolean {
  const s = raw.trim().toLowerCase();
  return ['si', 'sí', 'true', '1', 'yes', 'x'].includes(s);
}

const CAMPOS_FECHA = new Set(['licencia_vencimiento', 'vencimiento_matricula', 'vencimiento_seguro']);
/** Lecturas/contadores — tolerantes a separador de miles (AW3 `parseNumeroFlexible`, modo 'monto'). */
const CAMPOS_NUMERO_ENTERO = new Set([
  'kilometraje',
  'km_ultimo_mantenimiento',
  'intervalo_mantenimiento_km',
  'intervalo_mantenimiento_horas',
]);
/** Valores con decimales típicos (capacidad, rendimiento) — modo 'decimal'. */
const CAMPOS_NUMERO_DECIMAL = new Set(['capacidad_valor', 'rendimiento_esperado_km_gal']);
const CAMPOS_BOOLEANO = new Set(['es_prueba', 'activo']);

export interface CambioCampo {
  antes: unknown;
  despues: unknown;
}

export interface FilaResultadoRpc {
  i: number;
  id: string;
  accion?: 'creado' | 'actualizado';
  cambios?: Record<string, CambioCampo>;
}

export interface ResultadoImportacion {
  nuevos: number;
  actualizados: number;
  errores: { i: number; motivo: string }[];
  filas: FilaResultadoRpc[];
}

/** CQ4 — a qué slot de foto pertenece un archivo del .zip de conductores. 'principal'
 *  es la foto de cédula (única con columna real, `foto_path`); los otros dos solo se
 *  detectan/etiquetan en la revisión — `sgc.conductores` todavía no tiene columnas
 *  `licencia_frente_path`/`licencia_dorso_path` (verificado en sgc-dev), así que NUNCA
 *  se suben, en esta versión. */
export type SlotFotoConductor = 'principal' | 'licencia_frente' | 'licencia_dorso';

export interface PreviewFotos {
  /** Índice de fila 0-based (mismo índice que `filasRpc`) → foto emparejada por slot. */
  porFila: Map<number, Partial<Record<SlotFotoConductor, string>>>;
  /** Archivos del .zip que no emparejaron con ninguna fila (ningún slot). */
  sinDueno: string[];
}

@Injectable({ providedIn: 'root' })
export class ImportacionService {
  private supabase = inject(SupabaseService);

  /** Normaliza un header para el match (minúsculas, sin acentos ni símbolos). */
  private norm(s: string): string {
    return (s ?? '')
      .toString()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  /**
   * Empareja los headers del Excel con los campos de la entidad por coincidencia
   * normalizada contra el label EXACTO de la plantilla web (sin alias ni UI de
   * mapeo — mobile asume que el archivo viene de esa plantilla).
   */
  mapearColumnas(entidad: EntidadImportacion, headers: string[]): Record<string, string> {
    const map: Record<string, string> = {};
    const normalizados = headers.map((h) => ({ h, n: this.norm(h) }));
    for (const campo of entidad.campos) {
      const objetivo = this.norm(campo.label);
      const found = normalizados.find((x) => x.n === objetivo);
      if (found) map[campo.t] = found.h;
    }
    return map;
  }

  /** Campos requeridos cuya columna NO se encontró en el archivo (error de archivo, no de fila). */
  camposFaltantes(entidad: EntidadImportacion, mapeo: Record<string, string>): CampoImportacion[] {
    return entidad.campos.filter((c) => c.requerido && !mapeo[c.t]);
  }

  /** CQ4-a — fracción de campos de la entidad cuya columna SÍ se emparejó. Sirve para
   *  distinguir "este archivo no es la plantilla" (match muy bajo) de "es la plantilla
   *  pero le faltan una o dos columnas". */
  tasaCoincidencia(entidad: EntidadImportacion, mapeo: Record<string, string>): number {
    if (!entidad.campos.length) return 1;
    return Object.keys(mapeo).length / entidad.campos.length;
  }

  /** Label legible de un campo (para el detalle de cambios del resultado). */
  labelCampo(entidad: EntidadImportacion, t: string): string {
    return entidad.campos.find((c) => c.t === t)?.label ?? t;
  }

  /**
   * Construye las filas que espera el RPC. 1:1 con `rows` (NUNCA filtra ni reordena)
   * para que el índice 1-based que devuelve el RPC (`errores[].i` / `filas[].i`)
   * siga apuntando a la misma fila cruda — necesario para emparejar la foto del .zip.
   */
  construirFilas(entidad: EntidadImportacion, rows: Record<string, string>[], mapeo: Record<string, string>): Record<string, unknown>[] {
    return rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const campo of entidad.campos) {
        const col = mapeo[campo.t];
        const raw = col ? (r[col] ?? '').trim() : '';
        if (!raw) continue;
        if (campo.t === 'anio') {
          out[campo.t] = Number(raw) || undefined;
        } else if (CAMPOS_FECHA.has(campo.t)) {
          out[campo.t] = parseFechaCelda(raw);
        } else if (CAMPOS_NUMERO_ENTERO.has(campo.t) || CAMPOS_NUMERO_DECIMAL.has(campo.t)) {
          const modo: NumeroModo = CAMPOS_NUMERO_DECIMAL.has(campo.t) ? 'decimal' : 'monto';
          const n = parseNumeroFlexible(raw, modo);
          if (n != null) out[campo.t] = n;
        } else if (CAMPOS_BOOLEANO.has(campo.t)) {
          out[campo.t] = parseBooleano(raw);
        } else {
          out[campo.t] = raw;
        }
      }
      return out;
    });
  }

  async crearImportacion(entidad: string, archivoNombre: string, filas: number): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_importacion', {
      p_entidad: entidad,
      p_archivo_path: archivoNombre,
      p_filas: filas,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async importar(entidad: EntidadImportacion, filas: Record<string, unknown>[], importacionId: string): Promise<ResultadoImportacion> {
    const { data, error } = await this.supabase.client.rpc(entidad.rpc, {
      p_filas: filas,
      p_importacion_id: importacionId,
    });
    if (error) throw new Error(error.message);
    const d = (data ?? {}) as Partial<ResultadoImportacion>;
    return {
      nuevos: d.nuevos ?? 0,
      actualizados: d.actualizados ?? 0,
      errores: d.errores ?? [],
      filas: d.filas ?? [],
    };
  }

  /** Sube la foto emparejada del .zip al bucket de la entidad y la enlaza a la fila. */
  async subirFoto(entidad: EntidadImportacion, id: string, filename: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const path = entidad.foto.ruta(id, filename);
    const { error: upErr } = await this.supabase.client.storage.from(entidad.foto.bucket).upload(path, bytes, { upsert: true, contentType });
    if (upErr) throw new Error(upErr.message);
    const { error: dbErr } = await this.supabase.client.from(entidad.key).update({ [entidad.foto.campoDestino]: path }).eq('id', id);
    if (dbErr) throw new Error(dbErr.message);
  }

  /** Label del campo clave usado para emparejar fotos (ej. "Cédula", "Placa"). */
  claveLabel(entidad: EntidadImportacion): string {
    return entidad.campos.find((c) => c.t === entidad.foto.campoClave)?.label ?? entidad.foto.campoClave;
  }

  /** Ejemplo de nombre de archivo para la ayuda del .zip, según el campo clave. */
  claveEjemplo(entidad: EntidadImportacion): string {
    switch (entidad.foto.campoClave) {
      case 'cedula':
        return '00112345678';
      case 'placa':
        return 'G675571';
      default:
        return 'archivo';
    }
  }

  /**
   * CQ4 — preview de emparejamiento foto↔fila SIN subir nada (paso "Revisa y
   * confirma"). Usa el MISMO `entidad.foto.normalizar` + comparación exacta de
   * basename que `subirFotosImportadas` (abajo) para el slot 'principal', así que el
   * preview nunca miente sobre lo que realmente se sube. Para conductores además
   * reconoce los sufijos "-licencia-frente"/"-licencia-dorso" (solo para etiquetar en
   * la revisión — ver nota en `SlotFotoConductor`).
   */
  previsualizarFotos(entidad: EntidadImportacion, filasRpc: Record<string, unknown>[], zip: Map<string, Uint8Array> | null): PreviewFotos {
    const porFila = new Map<number, Partial<Record<SlotFotoConductor, string>>>();
    if (!zip || !zip.size) return { porFila, sinDueno: [] };

    const sufijos: { suf: string; slot: SlotFotoConductor }[] =
      entidad.key === 'conductores'
        ? [
            { suf: '-licencia-frente', slot: 'licencia_frente' },
            { suf: '-licencia-dorso', slot: 'licencia_dorso' },
          ]
        : [];

    const clavesPorFila = filasRpc.map((f) => {
      const raw = String(f[entidad.foto.campoClave] ?? '').trim();
      return raw ? entidad.foto.normalizar(raw) : '';
    });

    const usados = new Set<string>();
    for (const nombre of zip.keys()) {
      const base = nombre.replace(/\.[^.]+$/, '');
      let slot: SlotFotoConductor = 'principal';
      let claveBase = base;
      for (const s of sufijos) {
        if (base.toLowerCase().endsWith(s.suf)) {
          slot = s.slot;
          claveBase = base.slice(0, base.length - s.suf.length);
          break;
        }
      }
      const clave = entidad.foto.normalizar(claveBase);
      if (!clave) continue;
      const fila = clavesPorFila.findIndex((c) => c === clave);
      if (fila === -1) continue;
      const entry = porFila.get(fila) ?? {};
      if (entry[slot]) continue; // ya hay una foto para ese slot de esa fila
      entry[slot] = nombre;
      porFila.set(fila, entry);
      usados.add(nombre);
    }
    const sinDueno = [...zip.keys()].filter((n) => !usados.has(n));
    return { porFila, sinDueno };
  }

  /**
   * Empareja cada foto del .zip con su fila por el campo clave (cédula/placa, ya
   * normalizado igual que el servidor) — no hace falta una columna "archivo_foto" en
   * el Excel. Solo reporta como "sin usar" los archivos del .zip que NO encontraron
   * fila (típico: nombre mal escrito); que una fila no tenga foto es normal.
   * Solo sube la foto 'principal' (cédula/placa) — ver `SlotFotoConductor`.
   */
  async subirFotosImportadas(
    entidad: EntidadImportacion,
    filasRpc: Record<string, unknown>[],
    resultado: ResultadoImportacion,
    zip: Map<string, Uint8Array>,
  ): Promise<{ subidas: number; sinUsar: string[] }> {
    const idPorFila = new Map(resultado.filas.map((f) => [f.i, f.id]));
    const usados = new Set<string>();
    let subidas = 0;
    for (let i = 0; i < filasRpc.length; i++) {
      const claveRaw = String(filasRpc[i][entidad.foto.campoClave] ?? '').trim();
      const id = idPorFila.get(i + 1);
      if (!claveRaw || !id) continue;
      const clave = entidad.foto.normalizar(claveRaw);
      if (!clave) continue;
      const match = [...zip.entries()].find(
        ([nombre]) => !usados.has(nombre) && entidad.foto.normalizar(nombre.replace(/\.[^.]+$/, '')) === clave,
      );
      if (!match) continue;
      const [nombreArchivo, bytes] = match;
      try {
        await this.subirFoto(entidad, id, nombreArchivo, bytes, mimeForFilename(nombreArchivo));
        subidas++;
        usados.add(nombreArchivo);
      } catch {
        /* best-effort — la fila ya se importó igual */
      }
    }
    const sinUsar = [...zip.keys()].filter((n) => !usados.has(n));
    return { subidas, sinUsar };
  }

  /** CQ4 — sube las fotos huérfanas que el usuario emparejó a mano en la revisión
   *  ("¿de cuál es?"). `filaIndex` es 0-based (mismo índice que `filasRpc`). */
  async subirFotosManual(
    entidad: EntidadImportacion,
    resultado: ResultadoImportacion,
    asignaciones: { filaIndex: number; nombre: string; bytes: Uint8Array }[],
  ): Promise<number> {
    const idPorFila = new Map(resultado.filas.map((f) => [f.i, f.id]));
    let subidas = 0;
    for (const a of asignaciones) {
      const id = idPorFila.get(a.filaIndex + 1);
      if (!id) continue;
      try {
        await this.subirFoto(entidad, id, a.nombre, a.bytes, mimeForFilename(a.nombre));
        subidas++;
      } catch {
        /* best-effort */
      }
    }
    return subidas;
  }

  async registrarResultado(id: string, r: ResultadoImportacion): Promise<void> {
    await this.supabase.client.rpc('registrar_resultado_importacion', {
      p_id: id,
      p_nuevos: r.nuevos,
      p_actualizados: r.actualizados,
      p_errores: r.errores,
    });
  }
}
