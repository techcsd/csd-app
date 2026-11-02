/**
 * DF2/DF3 (PROMPT 129) — infraestructura de agentes de monitoreo (SGC, PROMPT 128).
 * Espejo de solo lectura (+ 2 RPCs de decisión) de `sql/2026-11-01-df2-agentes.sql`
 * y `sql/2026-11-01-df3-agentes-aprobaciones-cronista.sql`, ya desplegados al
 * Supabase de dev. RLS: `sgc.is_admin() or sgc.es_tecnologia()`.
 */
export type AgenteClave = 'vigia' | 'capataz' | 'soporte' | 'auditor' | 'escriba' | 'cronista';
export type AgenteEventoEstado = 'observando' | 'trabajando' | 'esperando_ok' | 'error' | 'inactivo';
export type AgenteHallazgoEstado = 'abierto' | 'en_progreso' | 'resuelto' | 'descartado';
export type AgenteAprobacionEstado = 'pendiente' | 'aprobada' | 'ajuste' | 'descartada';

export interface Agente {
  id: string;
  clave: AgenteClave;
  nombre: string;
  rol: string;
  nivel_max: 1 | 2 | 3;
  activo: boolean;
}

export interface AgenteEvento {
  id: string;
  agente_id: string;
  tipo: string;
  estado: AgenteEventoEstado;
  resumen: string | null;
  creado_en: string;
}

export interface AgenteHallazgo {
  id: string;
  agente_id: string;
  severidad: 'baja' | 'media' | 'alta' | 'critica';
  titulo: string;
  detalle: string | null;
  origen: string | null;
  estado: AgenteHallazgoEstado;
  creado_en: string;
}

export interface AgenteAccion {
  id: string;
  agente_id: string;
  que_hizo: string;
  resultado: string | null;
  reversible: boolean;
  deshecha_en: string | null;
  creado_en: string;
}

export interface AgenteAprobacion {
  id: string;
  agente_id: string | null;
  propuesta: string;
  rama: string | null;
  pr_url: string | null;
  pruebas_resultado: Record<string, unknown> | null;
  estado: AgenteAprobacionEstado;
  decidida_en: string | null;
  creado_en: string;
}

export interface AgenteInformeDiario {
  id: string;
  fecha: string;
  contenido_md: string;
  enviado_en: string | null;
  creado_en: string;
}
