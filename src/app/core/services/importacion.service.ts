import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

/**
 * CSD-importar — import masivo de Choferes/Vehículos desde Excel (+ fotos vía .zip),
 * mobile es "solo subida": asume los headers EXACTOS de la plantilla que genera SGC
 * web (`src/shared/services/importador.service.ts` en el repo padre) — sin UI de
 * mapeo de columnas. Llama los mismos RPCs que la web
 * (`sql/2026-10-16-importar-choferes-vehiculos-fotos.sql`, ya en sgc-dev).
 */

export interface CampoImportacion {
  t: string;
  label: string;
  requerido?: boolean;
}

export interface FotoImportacion {
  bucket: string;
  campoDestino: string;
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
      { t: 'nota', label: 'Nota' },
      { t: 'archivo_foto', label: 'Archivo de foto (nombre exacto dentro del .zip, opcional)' },
    ],
    foto: {
      bucket: 'conductores',
      campoDestino: 'foto_path',
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
      { t: 'archivo_foto', label: 'Archivo de foto (nombre exacto dentro del .zip, opcional)' },
    ],
    foto: {
      bucket: 'vehiculos',
      campoDestino: 'foto_portada',
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

export interface ResultadoImportacion {
  nuevos: number;
  actualizados: number;
  errores: { i: number; motivo: string }[];
  filas: { i: number; id: string }[];
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
        } else if (campo.t === 'licencia_vencimiento' && /^\d+(\.\d+)?$/.test(raw) && Number(raw) >= 25000 && Number(raw) <= 60000) {
          // Excel auto-formateó la celda como fecha → llega como serial numérico, no AAAA-MM-DD.
          out[campo.t] = excelSerialToIso(Number(raw)) ?? raw;
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

  async registrarResultado(id: string, r: ResultadoImportacion): Promise<void> {
    await this.supabase.client.rpc('registrar_resultado_importacion', {
      p_id: id,
      p_nuevos: r.nuevos,
      p_actualizados: r.actualizados,
      p_errores: r.errores,
    });
  }
}
