/** A5 — "Leer documento" (una foto en el perfil de un vehículo → IA → emparejar → aplicar). */

/** Campos que la edge `leer-documento-flota` puede extraer de una página. */
export interface CamposLecturaDocumento {
  poliza?: string | null;
  aseguradora?: string | null;
  vigencia_desde?: string | null;
  vigencia_hasta?: string | null;
  placa?: string | null;
  chasis?: string | null;
  marca?: string | null;
  modelo?: string | null;
  anio?: number | null;
  numero_matricula?: string | null;
  marbete_numero?: string | null;
}

/** Tipos de documento que la IA puede identificar en una página. */
export type TipoDocumentoLeido = 'seguro' | 'matricula' | 'marbete_dgii' | 'licencia' | 'otro' | 'reverso';

/** Tipos que SÍ se pueden aplicar a un vehículo (subconjunto de TipoDocumentoLeido). */
export type TipoDocumentoAplicable = 'seguro' | 'matricula' | 'marbete_dgii';

export interface PaginaLectura {
  pagina: number;
  tipo: TipoDocumentoLeido;
  campos: CamposLecturaDocumento;
  confianza: number | Record<string, number>;
}

/** Resultado de `flota_documentos_emparejar` para UNA página. */
export type MatchDocumento = 'exacta' | 'vin' | 'revisar' | 'sin_vehiculo';

export interface CandidatoVehiculo {
  vehiculo_id: string;
  placa: string;
  alias: string | null;
}

export interface PaginaEmparejada extends PaginaLectura {
  match: MatchDocumento;
  vehiculo_id?: string | null;
  vehiculo_placa?: string | null;
  vehiculo_alias?: string | null;
  candidatos?: CandidatoVehiculo[];
}

/** Fila que se envía a `flota_documentos_aplicar`. */
export interface FilaAplicarDocumento {
  vehiculo_id: string;
  tipo: TipoDocumentoAplicable;
  campos: CamposLecturaDocumento;
  imagen_path: string | null;
  pagina: number;
}

/** Resultado de `flota_documentos_aplicar` para UNA fila. */
export interface ResultadoAplicarDocumento {
  vehiculo_id: string;
  pagina: number;
  ok: boolean;
  aplicado: Record<string, unknown> | null;
  omitido: string | null;
  error: string | null;
}
