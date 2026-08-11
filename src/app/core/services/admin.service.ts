import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { UserContextService } from './user-context.service';

export interface Reporte {
  id: string;
  tipo: string;
  asunto: string;
  descripcion: string;
  estado: string;
  respuesta_admin: string | null;
  created_at: string;
  usuario?: { nombre: string } | null;
}

export interface Unidad {
  id: number;
  codigo: string;
  nombre: string;
  activo: boolean;
}

export interface BCatalogo {
  id: number;
  tipo: 'estructura' | 'actividad' | 'restriccion';
  valor: string;
  activo: boolean;
}

export interface ConteoRow {
  id: string;
  motivo: string | null;
  created_at: string;
  bodega?: { nombre: string } | null;
  creado?: { nombre: string } | null;
  items?: { cantidad_antes: number; cantidad_contada: number; articulo?: { nombre: string } | null }[];
}

export interface AuditoriaRow {
  id: number;
  tabla: string;
  registro_id: string;
  accion: 'INSERT' | 'UPDATE' | 'DELETE';
  actor_id: string | null;
  actor?: { nombre: string } | null;
  cambios: Record<string, { antes: unknown; despues: unknown }> | null;
  datos_despues: Record<string, unknown> | null;
  datos_antes: Record<string, unknown> | null;
  creado_en: string;
}

/** P13 — agregados del RPC `auditoria_resumen` (mismo shape que la web). */
export interface AuditoriaResumen {
  total: number;
  usuarios_activos: number;
  modulos_activos: number;
  por_usuario: { actor_id: string | null; nombre: string; n: number }[];
  por_modulo: { tabla: string; n: number }[];
  por_accion: { accion: string; n: number }[];
  por_dia: { dia: string; n: number }[];
  por_hora: { hora: number; n: number }[];
  acciones_comunes: { tabla: string; accion: string; n: number }[];
}

// ── AL2 — Usuarios / Roles / Parámetros (Administración completo) ─────────────
export type NivelPermiso = 'ver' | 'operar';
export type PermisosMap = Record<string, NivelPermiso>;

export interface RolAdmin {
  id: number;
  codigo: string;
  nombre: string;
  modulos: string[];
  permisos?: PermisosMap | null;
  descripcion?: string | null;
}

export interface UsuarioAdmin {
  id: string;
  nombre: string;
  email: string | null;
  activo: boolean;
  avatar_path?: string | null;
  roles: { rol: RolAdmin }[];
  conductores?: { id: string; nombre: string }[];
  pendiente?: boolean; // invitación sin aceptar
}

export interface Parametro {
  clave: string;
  valor: string;
  descripcion?: string | null;
}

export interface ModuloInfo {
  key: string;
  label: string;
  desc: string;
  sensible?: boolean;
}
export interface SubmoduloInfo {
  key: string;
  label: string;
  enforced?: boolean;
}

/** AG12 — catálogo de módulos (espeja la web). */
export const MODULOS_DISPONIBLES: ModuloInfo[] = [
  { key: 'inventario', label: 'Inventario', desc: 'Almacenes, artículos, entradas/salidas, conduces, conteos y requisiciones.' },
  { key: 'compras', label: 'Compras', desc: 'Solicitudes y órdenes de compra; aprobar y recibir compras.' },
  { key: 'rrhh', label: 'RRHH', desc: 'Empleados, asignaciones y documentos de personal.' },
  { key: 'proyectos', label: 'Proyectos', desc: 'Obras, cronograma, avance y ranking de encargados.' },
  { key: 'flota', label: 'Flota', desc: 'Vehículos, conductores, uso, combustible, mantenimientos, rutas y avisos.' },
  { key: 'transporte', label: 'Transporte (chofer)', desc: 'Logística del chofer: rutas, conduces recibidos, compras de ferretería.' },
  { key: 'bitacora', label: 'Bitácora', desc: 'Bitácora del día de obra, visitas e incidentes.' },
  { key: 'documentos', label: 'Documentos', desc: 'Rellenar y descargar documentos a partir de plantillas.' },
  { key: 'plantillas', label: 'Plantillas (crear/editar)', desc: 'Crear y editar plantillas de documentos.' },
  { key: 'legal', label: 'Legal', desc: 'Expedientes legales, contratos y aprobaciones.' },
  { key: 'tareas', label: 'Tareas (asignar)', desc: 'Asignar y seguir tareas de otros.' },
  { key: 'obra', label: 'Producción de Obra', desc: 'Plan del día, NC/incidentes, checklists, subcontratistas, avance e informes.' },
  { key: 'tecnologia', label: 'Tecnología', desc: 'Activos de TI: inventario tecnológico, guía, homologación y compras tecnológicas.' },
  { key: 'direccion', label: 'Dirección (vista ejecutiva)', desc: 'KPIs y dashboards consolidados.', sensible: true },
  { key: 'plataforma', label: 'Plataforma (app)', desc: 'Personalizar orden/tamaño de módulos del launcher (delegable).' },
  { key: 'admin', label: 'Administración', desc: 'Usuarios, roles/permisos, versiones, auditoría y reportes. Acceso máximo.', sensible: true },
];

/** AG12 — catálogo de submódulos por módulo (espeja la web). */
export const SUBMODULOS: Record<string, SubmoduloInfo[]> = {
  compras: [
    { key: 'compras.proveedores', label: 'Proveedores', enforced: true },
    { key: 'compras.ordenes', label: 'Órdenes de compra' },
    { key: 'compras.solicitudes', label: 'Solicitudes de compra' },
  ],
  inventario: [
    { key: 'inventario.entradas', label: 'Entradas' },
    { key: 'inventario.salidas', label: 'Salidas / Conduces' },
    { key: 'inventario.articulos', label: 'Artículos' },
    { key: 'inventario.conteos', label: 'Conteos' },
  ],
  flota: [
    { key: 'flota.vehiculos', label: 'Vehículos' },
    { key: 'flota.conductores', label: 'Conductores' },
    { key: 'flota.combustible', label: 'Combustible' },
    { key: 'flota.mantenimientos', label: 'Mantenimientos' },
    { key: 'flota.rutas', label: 'Rutas / Seguimiento' },
  ],
  rrhh: [
    { key: 'rrhh.empleados', label: 'Empleados' },
    { key: 'rrhh.asistencia', label: 'Asistencia' },
    { key: 'rrhh.ausencias', label: 'Ausencias / Vacaciones' },
  ],
  proyectos: [
    { key: 'proyectos.obras', label: 'Obras' },
    { key: 'proyectos.cronograma', label: 'Cronograma' },
    { key: 'proyectos.ranking', label: 'Ranking de encargados' },
  ],
  obra: [
    { key: 'obra.plan_dia', label: 'Plan del día y charla de seguridad' },
    { key: 'obra.no_conformidades', label: 'No conformidades e incidentes', enforced: true },
    { key: 'obra.checklists', label: 'Checklists de calidad' },
    { key: 'obra.subcontratistas', label: 'Subcontratistas y cubicaciones' },
    { key: 'obra.avance', label: 'Avance, costos y logística' },
    { key: 'obra.informes', label: 'Informe semanal' },
  ],
  plataforma: [{ key: 'plataforma.layout_app', label: 'Personalizar layout de la app', enforced: true }],
};

/** URL de la PWA donde el usuario invitado fija su contraseña. */
const SET_PASSWORD_URL = 'https://app.sgcconstructorasd.com/auth/set-password';

/**
 * Admin operations for the in-app Administración section. All writes are gated
 * server-side by RLS (sgc.is_admin()); the UI is additionally gated by the
 * `admin` module.
 */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private supabase = inject(SupabaseService);
  private ctx = inject(UserContextService);

  // ── AL2 — Usuarios ────────────────────────────────────────
  async getUsuarios(): Promise<UsuarioAdmin[]> {
    const { data, error } = await this.supabase.client
      .from('usuarios')
      .select('id, nombre, email, activo, avatar_path, roles:usuarios_roles!usuario_id(rol:roles(id, codigo, nombre, modulos, permisos)), conductores:conductores!usuario_id(id, nombre)')
      .order('nombre');
    if (error) throw new Error(error.message);
    const usuarios = (data as unknown as UsuarioAdmin[]) ?? [];
    // Augment con estado de invitación (best-effort).
    try {
      const { data: est } = await this.supabase.client.rpc('usuarios_estado_auth');
      const pend = new Map((((est as { id: string; pendiente: boolean }[]) ?? []).map((r) => [r.id, r.pendiente])));
      for (const u of usuarios) u.pendiente = pend.get(u.id) ?? false;
    } catch {
      /* best-effort */
    }
    return usuarios;
  }

  async getRoles(): Promise<RolAdmin[]> {
    const { data, error } = await this.supabase.client.from('roles').select('*').order('nombre');
    if (error) throw new Error(error.message);
    return (data as unknown as RolAdmin[]) ?? [];
  }

  async crearUsuario(email: string, fullName: string, roleId: number | null): Promise<void> {
    const { error } = await this.supabase.client.functions.invoke('admin-create-user', {
      body: { email: email.trim(), fullName: fullName.trim(), roleId, redirectTo: SET_PASSWORD_URL },
    });
    if (error) throw new Error(this.fnError(error));
  }

  async actualizarNombre(id: string, nombre: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('actualizar_usuario', { p_id: id, p_nombre: nombre.trim() });
    if (error) throw new Error(error.message);
  }

  async asignarRoles(usuarioId: string, rolIds: number[]): Promise<void> {
    const { error } = await this.supabase.client.rpc('assign_roles', {
      p_usuario_id: usuarioId,
      p_rol_ids: rolIds,
      p_asignado_por: this.ctx.profile()?.id ?? null,
    });
    if (error) throw new Error(error.message);
  }

  async toggleActivo(userId: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client.functions.invoke('admin-deactivate-user', {
      body: { userId, activo },
    });
    if (error) throw new Error(this.fnError(error));
  }

  async resetPassword(userId: string): Promise<void> {
    const { error } = await this.supabase.client.functions.invoke('admin-reset-user-password', {
      body: { userId, redirectTo: SET_PASSWORD_URL },
    });
    if (error) throw new Error(this.fnError(error));
  }

  async reenviarInvitacion(userId: string): Promise<void> {
    const { error } = await this.supabase.client.functions.invoke('admin-resend-invite', {
      body: { userId, redirectTo: SET_PASSWORD_URL },
    });
    if (error) throw new Error(this.fnError(error));
  }

  // ── AL2 — Roles / permisos (matriz AG12) ──────────────────
  async guardarRol(payload: { id?: number; nombre: string; modulos: string[]; permisos: PermisosMap; descripcion: string | null }): Promise<void> {
    if (payload.id) {
      const { error } = await this.supabase.client
        .from('roles')
        .update({ nombre: payload.nombre.trim(), modulos: payload.modulos, permisos: payload.permisos ?? {}, descripcion: payload.descripcion })
        .eq('id', payload.id);
      if (error) throw new Error(error.message);
      return;
    }
    const codigo = this.slug(payload.nombre);
    const { error } = await this.supabase.client
      .from('roles')
      .insert({ codigo, nombre: payload.nombre.trim(), modulos: payload.modulos, permisos: payload.permisos ?? {}, descripcion: payload.descripcion });
    if (error) throw new Error(error.code === '23505' ? 'Ya existe un rol con ese nombre.' : error.message);
  }

  async eliminarRol(id: number): Promise<void> {
    const { error } = await this.supabase.client.rpc('eliminar_rol', { p_rol_id: id });
    if (error) throw new Error(error.message);
  }

  // ── AL2 — Parámetros ──────────────────────────────────────
  async getParametros(): Promise<Parametro[]> {
    const { data, error } = await this.supabase.client.from('parametros').select('clave, valor, descripcion').order('clave');
    if (error) throw new Error(error.message);
    return (data as unknown as Parametro[]) ?? [];
  }

  async updateParametro(clave: string, valor: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('parametros')
      .update({ valor, updated_at: new Date().toISOString() })
      .eq('clave', clave);
    if (error) throw new Error(error.message);
  }

  private fnError(error: unknown): string {
    const m = (error as { message?: string })?.message ?? '';
    return m || 'No se pudo completar la operación.';
  }

  // ── Reportes ──────────────────────────────────────────────
  async getReportes(): Promise<Reporte[]> {
    const { data, error } = await this.supabase.client
      .from('reportes_usuario')
      .select('id, tipo, asunto, descripcion, estado, respuesta_admin, created_at, usuario:usuarios!reportes_usuario_usuario_id_fkey(nombre)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data as unknown as Reporte[]) ?? [];
  }

  async resolverReporte(id: string, respuesta: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('reportes_usuario')
      .update({
        estado: 'resuelto',
        respuesta_admin: respuesta.trim() || null,
        asignado_a: this.ctx.profile()?.id,
        resuelto_en: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Unidades ──────────────────────────────────────────────
  async getUnidades(): Promise<Unidad[]> {
    const { data, error } = await this.supabase.client.from('unidades').select('*').order('nombre');
    if (error) throw new Error(error.message);
    return (data as unknown as Unidad[]) ?? [];
  }

  async crearUnidad(nombre: string): Promise<Unidad> {
    const codigo = this.slug(nombre);
    const { data, error } = await this.supabase.client
      .from('unidades')
      .insert({ codigo, nombre: nombre.trim() })
      .select('*')
      .single();
    if (error) throw new Error(error.code === '23505' ? 'Ya existe esa unidad.' : error.message);
    return data as unknown as Unidad;
  }

  async toggleUnidad(id: number, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client.from('unidades').update({ activo }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Bitácora catálogos ────────────────────────────────────
  async getBCatalogos(): Promise<BCatalogo[]> {
    const { data, error } = await this.supabase.client
      .from('bitacora_catalogos')
      .select('*')
      .order('tipo')
      .order('valor');
    if (error) throw new Error(error.message);
    return (data as unknown as BCatalogo[]) ?? [];
  }

  async crearBCatalogo(tipo: string, valor: string): Promise<BCatalogo> {
    const { data, error } = await this.supabase.client
      .from('bitacora_catalogos')
      .insert({ tipo, valor: valor.trim().toUpperCase() })
      .select('*')
      .single();
    if (error) throw new Error(error.code === '23505' ? 'Ese valor ya existe.' : error.message);
    return data as unknown as BCatalogo;
  }

  async toggleBCatalogo(id: number, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client.from('bitacora_catalogos').update({ activo }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Conteos (ajustes) history ─────────────────────────────
  async getConteos(): Promise<ConteoRow[]> {
    const { data, error } = await this.supabase.client
      .from('conteos_inventario')
      .select('id, motivo, created_at, bodega:bodegas(nombre), creado:usuarios(nombre), items:conteo_items(cantidad_antes, cantidad_contada, articulo:articulos(nombre))')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data as unknown as ConteoRow[]) ?? [];
  }

  // ── Auditoría (traceability) ──────────────────────────────
  /** Recent change trail (who created/modified/deleted what) from both web and
   *  app. Paginated by page (0-based); accion optionally filters. */
  async getAuditoria(page = 0, accion?: string): Promise<AuditoriaRow[]> {
    const size = 30;
    let q = this.supabase.client
      .from('auditoria')
      .select('*, actor:usuarios!auditoria_actor_id_fkey(nombre)')
      .order('creado_en', { ascending: false })
      .range(page * size, page * size + size - 1);
    if (accion) q = q.eq('accion', accion);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data as unknown as AuditoriaRow[]) ?? [];
  }

  /**
   * P13 — agregados analíticos del módulo de auditoría (mismo RPC que la web:
   * `auditoria_resumen`). Una sola llamada devuelve KPIs + series para los
   * gráficos. Solo online (es admin).
   */
  async getAuditoriaResumen(filtro: {
    desde?: string | null;
    hasta?: string | null;
    actor?: string | null;
    tabla?: string | null;
  }): Promise<AuditoriaResumen> {
    const { data, error } = await this.supabase.client.rpc('auditoria_resumen', {
      p_desde: filtro.desde ?? null,
      p_hasta: filtro.hasta ?? null,
      p_actor: filtro.actor ?? null,
      p_tabla: filtro.tabla ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? {}) as AuditoriaResumen;
  }

  private slug(nombre: string): string {
    return nombre
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }
}
