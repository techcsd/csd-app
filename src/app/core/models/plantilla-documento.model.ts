// CF7 (app) — motor de plantillas de documento portado del padre (SGC web).
export type PlantillaCategoria =
  | 'contrato'
  | 'recibo_pago'
  | 'orden_pago'
  | 'carta_entrega'
  | 'acta_incidencia'
  | 'otro';

export type CampoTipo = 'texto' | 'numero' | 'fecha' | 'textarea';

export interface CampoPlantilla {
  key: string;
  label: string;
  tipo: CampoTipo;
}

export interface PlantillaDocumento {
  id: string;
  nombre: string;
  categoria: PlantillaCategoria;
  contenido_html: string;
  campos: CampoPlantilla[];
  origen: 'sistema' | 'usuario';
  activo: boolean;
  es_default?: boolean;
  created_at: string;
}

/** Datos de la empresa usados por el motor de merge (variables del contrato). */
export interface EmpresaLite {
  razon_social: string | null;
  nombre_comercial: string | null;
  rnc: string | null;
  representante: string | null;
  gerente_general: string | null;
  direccion: string | null;
  ciudad: string | null;
}
