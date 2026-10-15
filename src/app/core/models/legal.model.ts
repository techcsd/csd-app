// CO13/CO11 — Legal (Expedientes + Contratos). Sin RPC de listado/creación del
// padre: todo es acceso directo a tabla, bajo la RLS `is_admin() or tiene_modulo('legal')`.

export type ExpedienteTipo = 'laboral' | 'permiso' | 'reclamacion' | 'litigio' | 'cumplimiento' | 'contractual' | 'otro';
export type ExpedienteEstado = 'abierto' | 'en_proceso' | 'en_espera' | 'cerrado';
export type ExpedientePrioridad = 'baja' | 'media' | 'alta' | 'urgente';

export interface ExpedienteLegal {
  id: string;
  codigo: string;
  titulo: string;
  tipo: ExpedienteTipo;
  estado: ExpedienteEstado;
  prioridad: ExpedientePrioridad;
  proyecto_id: string | null;
  contraparte: string | null;
  descripcion: string | null;
  fecha_apertura: string;
  fecha_limite: string | null;
  fecha_cierre: string | null;
  responsable_id: string | null;
  creado_por: string | null;
  created_at: string;
  monto_reclamado: number | null;
  /** Resuelto client-side (proyectos ya cacheados o embed). */
  proyecto_nombre?: string | null;
}

export interface ExpedienteNota {
  id: string;
  expediente_id: string;
  usuario_id: string | null;
  nota: string;
  created_at: string;
  usuario_nombre?: string | null;
}

export interface ExpedienteArchivo {
  id: string;
  expediente_id: string;
  nombre: string;
  archivo_path: string;
  tipo_mime: string | null;
  subido_por: string | null;
  created_at: string;
  url?: string | null;
}

export type ContratoTipo = 'subcontrato' | 'proveedor' | 'laboral' | 'arrendamiento' | 'servicios' | 'otro';
export type ContratoEstado = 'borrador' | 'en_revision' | 'firmado' | 'vencido' | 'cancelado';

export interface Contrato {
  id: string;
  codigo: string;
  titulo: string;
  tipo: ContratoTipo;
  contraparte_nombre: string;
  proveedor_id: string | null;
  proyecto_id: string | null;
  documento_generado_id: string | null;
  estado: ContratoEstado;
  monto: number | null;
  fecha_inicio: string | null;
  fecha_vencimiento: string | null;
  fecha_firma: string | null;
  responsable_id: string | null;
  creado_por: string | null;
  created_at: string;
  archivo_firmado_path: string | null;
}

export interface ContratoDetalle {
  contrato: Omit<Contrato, 'proveedor_id' | 'proyecto_id'>;
  proveedor: { nombre: string } | null;
  proyecto: { nombre: string } | null;
  documento: {
    id: string;
    nombre: string;
    created_at: string;
    plantilla_nombre: string | null;
    plantilla_categoria: string | null;
  } | null;
}
