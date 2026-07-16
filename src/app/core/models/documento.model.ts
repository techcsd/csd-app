/** A stored document (photo or PDF) backing a conductor or vehicle (X1). */
export type DocEntidad = 'conductor' | 'vehiculo';

/** Suggested doc types per entity (free-form `otro` allowed by the table). */
export type DocTipoConductor = 'cedula' | 'licencia' | 'otro';
export type DocTipoVehiculo = 'seguro' | 'matricula' | 'otro';

export interface Documento {
  id: string;
  entidad: DocEntidad;
  entidad_id: string;
  tipo: string;
  nombre: string | null;
  path: string;
  created_at: string;
}

/** What the doc-slot hands back when the user captures/picks a document. */
export interface DocCaptura {
  blob: Blob;
  nombre: string;
  esImagen: boolean;
  /** File extension for the storage path (`jpg` | `png` | `pdf`). */
  ext: string;
}
