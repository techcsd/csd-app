import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { DocumentoGenerado } from '../models/documento-generado.model';

/**
 * CO12/CO13 — Historial de documentos generados. Sin RPC de creación/listado del
 * padre: insert/select directos bajo la RLS de `documentos_generados` (acota por
 * `generado_por`, módulo `documentos`/`proyectos`, o aprobación legal — la app no
 * reimplementa ese cálculo, confía en lo que la RLS deje ver).
 */
@Injectable({ providedIn: 'root' })
export class DocumentosGeneradosService {
  private supabase = inject(SupabaseService);

  async historial(): Promise<DocumentoGenerado[]> {
    const { data, error } = await this.supabase.client
      .from('documentos_generados')
      .select('*, plantilla:plantillas_documento(nombre,categoria)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<DocumentoGenerado & { plantilla: { nombre: string; categoria: string } | null }>).map(
      (r) => ({ ...r, plantilla_nombre: r.plantilla?.nombre ?? null, plantilla_categoria: r.plantilla?.categoria ?? null }),
    );
  }

  /** "Usado en contrato CTR-…" (best-effort, un RPC por documento — historial corto). */
  async usadoEnContrato(documentoId: string): Promise<DocumentoGenerado['usado_en_contrato']> {
    try {
      const { data } = await this.supabase.client.rpc('documento_usado_en_contrato', { p_documento_id: documentoId });
      return (data as DocumentoGenerado['usado_en_contrato']) ?? null;
    } catch {
      return null;
    }
  }

  /** Crea el documento (merge ya resuelto por `PlantillasDocumentoService.renderizar`). */
  async crear(input: {
    plantillaId: string;
    proyectoId: string | null;
    nombre: string;
    valores: Record<string, string>;
    contenidoHtmlFinal: string;
  }): Promise<string> {
    const { data: userData } = await this.supabase.client.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) throw new Error('No autenticado.');
    const { data, error } = await this.supabase.client
      .from('documentos_generados')
      .insert({
        plantilla_id: input.plantillaId,
        proyecto_id: input.proyectoId,
        nombre: input.nombre,
        valores: input.valores,
        contenido_html_final: input.contenidoHtmlFinal,
        generado_por: uid,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }
}
