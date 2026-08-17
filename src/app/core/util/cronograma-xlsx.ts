import { unzipSync, strFromU8 } from 'fflate';

/**
 * AS21 — parser del Excel de cronograma de obra (formato CSD: hoja por torre/etapa,
 * meta arriba, tabla desde una fila de headers con "ACTIVIDADES"). Corre 100% en el
 * cliente (fflate para descomprimir + parseo del XML de la hoja). Tolera variaciones
 * de fila de headers y columnas ausentes. Mapea a la forma que espera el RPC
 * `cronograma_importar` (nombre/tipo/dias/fecha_inicio/fecha_fin/avance_pct/
 * responsable/volumetria/rendimiento/grupo).
 */

export interface CronogramaActividad {
  orden: number;
  nombre: string;
  responsable: string | null;
  volumetria: string | null;
  fecha_inicio: string | null; // ISO yyyy-mm-dd
  fecha_fin: string | null;
  dias: number | null;
  status: string | null;
  avance_pct: number; // 0..100 (avance REAL)
  avance_esperado_pct: number | null;
  rendimiento: string | null;
  grupo: string | null; // sección (ENTREPISO #, etc.)
}

export interface CronogramaImportPreview {
  proyectoNombre: string | null;
  faseNombre: string; // nombre de la hoja (torre/etapa)
  actividades: CronogramaActividad[];
  advertencias: string[];
}

/** Columna 'B' → 2, 'AA' → 27. */
function colToNum(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Serial de Excel (base 1899-12-30) → ISO yyyy-mm-dd. */
function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Normaliza un % que puede venir como fracción (0..1 → 0..100) o ya como porcentaje. */
function pct(raw: number | null): number {
  if (raw == null || !Number.isFinite(raw)) return 0;
  const v = raw > 0 && raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/** Parsea sharedStrings.xml → arreglo de textos. */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const txt = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('');
    out.push(decode(txt));
  }
  return out;
}

interface Celda {
  col: number;
  colLetra: string;
  valor: string;
  num: number | null;
}
type Fila = Map<number, Celda>;

/** Parsea una hoja → filas (por número de fila) con sus celdas resueltas. */
function parseSheet(xml: string, sst: string[]): Map<number, Fila> {
  const filas = new Map<number, Fila>();
  for (const rm of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const r = Number(rm[1]);
    const fila: Fila = new Map();
    for (const cm of rm[2].matchAll(
      /<c r="([A-Z]+\d+)"(?:[^>]*?t="([^"]*)")?[^>]*>(?:<v>([\s\S]*?)<\/v>|<is><t[^>]*>([\s\S]*?)<\/t><\/is>)?<\/c>/g,
    )) {
      const ref = cm[1];
      const t = cm[2];
      const v = cm[3];
      const inl = cm[4];
      let valor = v ?? inl ?? '';
      if (t === 's' && v != null) valor = sst[Number(v)] ?? '';
      else valor = decode(valor);
      if (valor === '') continue;
      const col = colToNum(ref);
      const num = t === 's' ? null : Number(valor);
      fila.set(col, { col, colLetra: ref.match(/^[A-Z]+/)![0], valor, num: Number.isFinite(num) ? num : null });
    }
    if (fila.size) filas.set(r, fila);
  }
  return filas;
}

/** Encuentra el nombre de la primera hoja en workbook.xml. */
function primeraHoja(xml: string): string {
  const m = xml.match(/<sheet[^>]*name="([^"]*)"/);
  return m ? decode(m[1]) : 'Cronograma';
}

/** Mapa de header→columna a partir de la fila de headers. */
const HEADER_MATCHERS: { key: keyof HeaderCols; re: RegExp }[] = [
  { key: 'numero', re: /^#$/ },
  { key: 'nombre', re: /actividad/i },
  { key: 'responsable', re: /responsable/i },
  { key: 'volumetria', re: /volumetr/i },
  { key: 'inicio', re: /fecha\s*inicio/i },
  { key: 'fin', re: /fecha\s*fin/i },
  { key: 'dias', re: /d[ií]as/i },
  { key: 'status', re: /status|estado/i },
  { key: 'avanceReal', re: /avance\s*real/i },
  { key: 'avanceEsp', re: /avance\s*esperado/i },
  { key: 'rendimiento', re: /rendimiento/i },
];
interface HeaderCols {
  numero?: number;
  nombre?: number;
  responsable?: number;
  volumetria?: number;
  inicio?: number;
  fin?: number;
  dias?: number;
  status?: number;
  avanceReal?: number;
  avanceEsp?: number;
  rendimiento?: number;
}

/** Detecta la fila de headers (la que contiene "ACTIVIDADES") y mapea columnas. */
function detectarHeaders(filas: Map<number, Fila>): { headerRow: number; cols: HeaderCols } | null {
  for (const [r, fila] of [...filas.entries()].sort((a, b) => a[0] - b[0])) {
    const tieneActividades = [...fila.values()].some((c) => /actividad/i.test(c.valor));
    if (!tieneActividades) continue;
    const cols: HeaderCols = {};
    for (const c of fila.values()) {
      for (const m of HEADER_MATCHERS) {
        if (m.re.test(c.valor.trim()) && cols[m.key] == null) cols[m.key] = c.col;
      }
    }
    if (cols.nombre != null) return { headerRow: r, cols };
  }
  return null;
}

/** Parsea un archivo .xlsx de cronograma → preview de actividades. */
export function parseCronogramaXlsx(buffer: ArrayBuffer): CronogramaImportPreview {
  const files = unzipSync(new Uint8Array(buffer));
  const get = (name: string): string | null => {
    const f = files[name];
    return f ? strFromU8(f) : null;
  };
  const workbook = get('xl/workbook.xml') ?? '';
  const faseNombre = primeraHoja(workbook);
  const sst = parseSharedStrings(get('xl/sharedStrings.xml') ?? '');
  // La primera hoja suele ser sheet1.xml; si no, tomamos la primera worksheet.
  let sheetXml = get('xl/worksheets/sheet1.xml');
  if (!sheetXml) {
    const key = Object.keys(files).find((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
    sheetXml = key ? strFromU8(files[key]) : null;
  }
  const advertencias: string[] = [];
  if (!sheetXml) {
    return { proyectoNombre: null, faseNombre, actividades: [], advertencias: ['No se pudo leer la hoja del Excel.'] };
  }
  const filas = parseSheet(sheetXml, sst);

  // Nombre del proyecto: primera celda de texto de las filas de meta (antes de los headers).
  const det = detectarHeaders(filas);
  if (!det) {
    return {
      proyectoNombre: null,
      faseNombre,
      actividades: [],
      advertencias: ['No se encontró la fila de encabezados (con "ACTIVIDADES"). ¿Es el formato de cronograma correcto?'],
    };
  }
  const { headerRow, cols } = det;

  let proyectoNombre: string | null = null;
  for (const [r, fila] of filas) {
    if (r >= headerRow) continue;
    const primera = [...fila.values()].sort((a, b) => a.col - b.col)[0];
    if (primera && isNaN(Number(primera.valor)) && primera.valor.length > 2) {
      proyectoNombre = primera.valor;
      break;
    }
  }

  const cell = (fila: Fila, col?: number): Celda | null => (col != null ? fila.get(col) ?? null : null);
  const actividades: CronogramaActividad[] = [];
  let grupoActual: string | null = null;
  let orden = 0;

  for (const [r, fila] of [...filas.entries()].sort((a, b) => a[0] - b[0])) {
    if (r <= headerRow) continue;
    const nombre = cell(fila, cols.nombre)?.valor?.trim() ?? '';
    if (!nombre) continue;
    const numeroCel = cell(fila, cols.numero);
    const tieneNumero = numeroCel?.num != null;
    const inicioCel = cell(fila, cols.inicio);
    const finCel = cell(fila, cols.fin);
    const diasCel = cell(fila, cols.dias);
    const tieneDatos = !!(inicioCel || finCel || diasCel || cell(fila, cols.responsable) || cell(fila, cols.volumetria));

    // Fila de sección (grupo): tiene nombre pero ni número ni datos de actividad.
    if (!tieneNumero && !tieneDatos) {
      grupoActual = nombre;
      continue;
    }

    orden += 1;
    const dias = diasCel?.num != null ? Math.round(diasCel.num) : null;
    let fechaInicio: string | null = null;
    if (inicioCel?.num != null) fechaInicio = excelSerialToIso(inicioCel.num);
    else if (inicioCel && /^\d{4}-\d{2}-\d{2}/.test(inicioCel.valor)) fechaInicio = inicioCel.valor.slice(0, 10);
    let fechaFin: string | null = null;
    if (finCel?.num != null) fechaFin = excelSerialToIso(finCel.num);
    else if (finCel && /^\d{4}-\d{2}-\d{2}/.test(finCel.valor)) fechaFin = finCel.valor.slice(0, 10);
    // Fin derivado de inicio + días si falta.
    if (!fechaFin && fechaInicio && dias != null) {
      const d = new Date(Date.UTC(1899, 11, 30) + (inicioCel!.num! + Math.max(0, dias)) * 86400000);
      fechaFin = d.toISOString().slice(0, 10);
    }
    const avanceReal = cell(fila, cols.avanceReal)?.num ?? null;
    const avanceEsp = cell(fila, cols.avanceEsp)?.num ?? null;

    actividades.push({
      orden,
      nombre,
      responsable: cell(fila, cols.responsable)?.valor?.trim() || null,
      volumetria: cell(fila, cols.volumetria)?.valor?.trim() || null,
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      dias,
      status: cell(fila, cols.status)?.valor?.trim() || null,
      avance_pct: pct(avanceReal),
      avance_esperado_pct: avanceEsp != null ? pct(avanceEsp) : null,
      rendimiento: cell(fila, cols.rendimiento)?.valor?.trim() || null,
      grupo: grupoActual,
    });
  }

  if (!actividades.length) advertencias.push('No se detectaron actividades bajo la fila de encabezados.');
  const sinFecha = actividades.filter((a) => !a.fecha_inicio).length;
  if (sinFecha) advertencias.push(`${sinFecha} actividad(es) sin fecha de inicio (se importan igual).`);

  return { proyectoNombre, faseNombre, actividades, advertencias };
}

/** Mapea una actividad al item que espera el RPC `cronograma_importar`. */
export function actividadToTareaRpc(a: CronogramaActividad): Record<string, unknown> {
  return {
    orden: a.orden,
    nombre: a.nombre,
    tipo: 'ordinaria',
    dias: a.dias ?? 1,
    fecha_inicio: a.fecha_inicio,
    fecha_fin: a.fecha_fin,
    avance_pct: a.avance_pct,
    responsable: a.responsable,
    volumetria: a.volumetria,
    rendimiento: a.rendimiento,
    grupo: a.grupo,
  };
}
