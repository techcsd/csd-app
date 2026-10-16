import { unzipSync, strFromU8 } from 'fflate';

/**
 * CSD-importar — parser genérico de un .xlsx "header en fila 1" (columna→texto).
 * Mismo enfoque regex-sobre-el-XML que `cronograma-xlsx.ts` (fflate para
 * descomprimir, sin dependencia de SheetJS), pero sin el layout fijo de cronograma:
 * cualquier hoja con una fila de encabezados y filas de datos debajo sirve. Pensado
 * para los Excels "Choferes"/"Vehículos" que genera la plantilla de SGC web.
 */

export interface XlsxTable {
  headers: string[];
  rows: Record<string, string>[];
}

/** Columna 'B' → 2, 'AA' → 27. */
function colToNum(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
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

type Fila = Map<number, string>;

/** Parsea una hoja → filas (por número de fila) con el texto de cada celda. */
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
      fila.set(colToNum(ref), valor);
    }
    if (fila.size) filas.set(r, fila);
  }
  return filas;
}

/**
 * Parsea un .xlsx genérico: la primera fila con contenido = encabezados, el resto
 * son filas de datos (se saltan las filas totalmente vacías). Devuelve los headers
 * tal cual vienen en el archivo (sin normalizar) + un record por fila (header → texto
 * de la celda, recortado). No interpreta tipos (fechas/números quedan como texto).
 */
export function parseXlsxTable(buffer: ArrayBuffer): XlsxTable {
  const files = unzipSync(new Uint8Array(buffer));
  const get = (name: string): string | null => {
    const f = files[name];
    return f ? strFromU8(f) : null;
  };
  const sst = parseSharedStrings(get('xl/sharedStrings.xml') ?? '');
  let sheetXml = get('xl/worksheets/sheet1.xml');
  if (!sheetXml) {
    const key = Object.keys(files).find((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
    sheetXml = key ? strFromU8(files[key]) : null;
  }
  if (!sheetXml) return { headers: [], rows: [] };

  const filas = parseSheet(sheetXml, sst);
  const numerosFila = [...filas.keys()].sort((a, b) => a - b);
  if (!numerosFila.length) return { headers: [], rows: [] };

  const headerRowNum = numerosFila[0];
  const headerRow = filas.get(headerRowNum)!;
  const columnas = [...headerRow.entries()].sort((a, b) => a[0] - b[0]);
  const headers = columnas.map(([, texto]) => texto.trim());

  const rows: Record<string, string>[] = [];
  for (const r of numerosFila) {
    if (r <= headerRowNum) continue;
    const fila = filas.get(r)!;
    const vacia = [...fila.values()].every((v) => !v.trim());
    if (vacia) continue;
    const rec: Record<string, string> = {};
    for (const [col, header] of columnas) {
      if (!header) continue;
      rec[header] = (fila.get(col) ?? '').trim();
    }
    rows.push(rec);
  }
  return { headers, rows };
}
