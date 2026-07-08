/** Role as embedded from sgc.roles (codigo + module gates). */
export interface Rol {
  codigo: string;
  nombre: string;
  modulos: string[];
}

export interface UsuarioRol {
  rol: Rol;
}

/** Current user profile, shaped like SGC's usuarios + roles embed. */
export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  activo?: boolean;
  avatar_path?: string | null;
  roles?: UsuarioRol[];
}

/** Field module keys that map to a Home button (subset of SGC modules). */
export type ModuloCampo = 'bitacora' | 'flota' | 'inventario' | 'compras';
