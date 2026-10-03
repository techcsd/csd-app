import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { CampoPlantilla, EmpresaLite, PlantillaCategoria, PlantillaDocumento } from '../models/plantilla-documento.model';

const CAT_PLANTILLAS = 'plantillas_documento';
const CAT_EMPRESA = 'empresa_lite';
const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function formatFechaLarga(iso: string): string {
  const [y, m, d] = (iso ?? '').split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return iso;
  return `${d} de ${MESES[m - 1]} de ${y}`;
}
function formatNumero(raw: string): string {
  const s = (raw ?? '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return raw;
  const neg = s.startsWith('-');
  const [intp, decp] = s.replace('-', '').split('.');
  const grouped = intp.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${decp ? '.' + decp : ''}`;
}

/**
 * CF7 (app) — lectura + render de plantillas de documento (motor portado del padre).
 * Las plantillas y la empresa se leen con caché read-through (offline-friendly) para
 * poder generar el contrato en obra sin red. La CREACIÓN/edición de plantillas vive en
 * la web (Sonia); la app solo las consume.
 */
@Injectable({ providedIn: 'root' })
export class PlantillasDocumentoService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);

  /** Todas las plantillas activas (cacheadas). */
  async getAll(): Promise<PlantillaDocumento[]> {
    const data = await this.catalog.refresh<PlantillaDocumento[]>(CAT_PLANTILLAS, async () => {
      const { data, error } = await this.supabase.client
        .from('plantillas_documento')
        .select('id,nombre,categoria,contenido_html,campos,origen,activo,es_default,created_at')
        .eq('activo', true)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as PlantillaDocumento[];
    });
    return data ?? [];
  }

  /** Plantilla por defecto de una categoría (es_default), o la primera de esa categoría. */
  async plantillaDefault(categoria: PlantillaCategoria): Promise<PlantillaDocumento | null> {
    const all = await this.getAll().catch(() => [] as PlantillaDocumento[]);
    const deCat = all.filter((p) => p.categoria === categoria);
    return deCat.find((p) => p.es_default) ?? deCat[0] ?? null;
  }

  /** Datos de empresa para las variables (cacheados). */
  async getEmpresa(): Promise<EmpresaLite | null> {
    const data = await this.catalog.refresh<EmpresaLite | null>(CAT_EMPRESA, async () => {
      const { data, error } = await this.supabase.client
        .from('empresa')
        .select('razon_social,nombre_comercial,rnc,representante,gerente_general,direccion,ciudad')
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as EmpresaLite | null;
    });
    return data ?? null;
  }

  /**
   * Sustituye los {{token}} del HTML por los valores resueltos (fecha larga es-DO si el
   * campo es tipo 'fecha', miles si 'numero'). Lo no resuelto queda vacío.
   */
  renderizar(contenidoHtml: string, valores: Record<string, string>, campos: CampoPlantilla[] = []): string {
    const tipoByKey = new Map(campos.map((c) => [c.key, c.tipo]));
    return contenidoHtml.replace(TOKEN_RE, (_m, key: string) => {
      const raw = valores[key] ?? '';
      const tipo = tipoByKey.get(key);
      let value = raw;
      if (tipo === 'fecha') value = formatFechaLarga(raw);
      else if (tipo === 'numero') value = formatNumero(raw);
      return escapeHtml(value);
    });
  }
}
