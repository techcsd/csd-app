/** Role as embedded from sgc.roles (codigo + module gates). */
export interface Rol {
  codigo: string;
  nombre: string;
  modulos: string[];
  /** AG12 — permisos por submódulo `"modulo.submodulo" → "ver"|"operar"`. */
  permisos?: Record<string, 'ver' | 'operar'> | null;
}

export interface UsuarioRol {
  rol: Rol;
}

/** Current user profile, shaped like SGC's usuarios + roles embed. */
export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  telefono?: string | null; // AY1 — editable por el propio usuario
  activo?: boolean;
  /** AY7 — usuario de PRUEBA (email sintético, excluido de lo real). Muestra banner. */
  es_prueba?: boolean;
  avatar_path?: string | null;
  roles?: UsuarioRol[];
}

/** Field module keys that map to a Home button (subset of SGC modules). */
export type ModuloCampo = 'bitacora' | 'flota' | 'inventario' | 'compras';
