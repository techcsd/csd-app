/**
 * CR1 — Conector de Claude Desktop (MCP + OAuth, contrato del padre en
 * `SGC/PARIDAD.md` § "CR1 — Conector de Claude Desktop (contrato para la app,
 * PROMPT-105)"). La app SOLO consume: conectar/desconectar vía OAuth es cosa de
 * la web (Claude Desktop se configura en una computadora).
 */

export type ClaudeBorradorEstado = 'pendiente' | 'confirmado' | 'descartado' | 'caducado';

/** Fila cruda de `sgc.claude_borradores` (RLS: solo lo propio). */
export interface ClaudeBorrador {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  resumen: string | null;
  estado: ClaudeBorradorEstado;
  creado_en: string;
  expira_en: string;
  resultado: { ok?: boolean; mensaje?: string; duplicado?: boolean } | null;
}

/** `sgc.claude_mi_conexion()` — todo lo que Perfil › Claude necesita en una llamada. */
export interface ClaudeMiConexion {
  conectado: boolean;
  desde: string | null;
  ultima_actividad: string | null;
  consultas_7d: number;
  borradores_pendientes: number;
}

/** `sgc.claude_conector_config()` — interruptores del conector (CR1 §B1). */
export interface ClaudeConectorConfig {
  activo: boolean;
  solo_autorizados: boolean;
  clientes_extra: boolean;
  max_hora: number;
}

/** Línea resuelta (nombre de obra/artículo ya buscado) para `/borrador/:id`. */
export interface ClaudeBorradorDetalleLinea {
  etiqueta: string;
  valor: string;
}
