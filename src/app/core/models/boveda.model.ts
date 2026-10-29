// CZ3/CZ9/CZ7 — Vault ("Bóveda") de Administración, espejo app de
// sgc.boveda_entradas. Metadata SOLO (nunca el valor cifrado — las columnas
// secretas están revocadas a `authenticated`; se leen únicamente a través de
// la edge `boveda`). Alcance móvil (DZ-19): buscar, ver, revelar, copiar,
// código 2FA y generador. Crear/editar/eliminar/importar/exportar: solo web.

export type BovedaTipo = 'cuenta' | 'api' | '2fa' | 'nota' | 'archivo';

export interface BovedaEntrada {
  id: string;
  tipo: BovedaTipo;
  nombre: string;
  sitio_url: string | null;
  usuario_texto: string | null;
  archivo_path: string | null;
  archivo_nombre: string | null;
  archivo_mime: string | null;
  etiquetas: string[];
  rotar_cada_dias: number | null;
  ultima_rotacion: string | null;
  notas: string | null;
  creado_por: string | null;
  created_at: string;
  updated_at: string;
}

export type BovedaEstadoRotacion = 'al_dia' | 'por_rotar' | 'vencida' | 'sin_rotacion';

/** Espejo EXACTO de la función `estadoRotacion` del Vault web (vault.ts). */
export function estadoRotacionDe(e: Pick<BovedaEntrada, 'rotar_cada_dias' | 'ultima_rotacion' | 'created_at'>): BovedaEstadoRotacion {
  if (!e.rotar_cada_dias) return 'sin_rotacion';
  const base = new Date(e.ultima_rotacion ?? e.created_at).getTime();
  const vence = base + e.rotar_cada_dias * 86_400_000;
  const diasRestantes = Math.ceil((vence - Date.now()) / 86_400_000);
  if (diasRestantes < 0) return 'vencida';
  if (diasRestantes <= 7) return 'por_rotar';
  return 'al_dia';
}
