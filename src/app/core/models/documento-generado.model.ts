// CO12/CO13 — un documento ya generado (fusión de una plantilla con datos reales).
export interface DocumentoGenerado {
  id: string;
  plantilla_id: string;
  proyecto_id: string | null;
  nombre: string;
  valores: Record<string, string>;
  contenido_html_final: string;
  generado_por: string;
  created_at: string;
  plantilla_nombre?: string | null;
  plantilla_categoria?: string | null;
  /** Resuelto on-demand vía `documento_usado_en_contrato`. */
  usado_en_contrato?: { id: string; codigo: string; titulo: string } | null;
}
