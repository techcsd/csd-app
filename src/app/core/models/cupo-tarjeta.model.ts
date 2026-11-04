/**
 * DI — "cupo de tarjeta de combustible": solicitud manual + cupo opcional por
 * tarjeta (decisión de Xaviel). La app NO conoce el límite real de la tarjeta
 * (vive con el proveedor de combustible); Flota opcionalmente anota un cupo y
 * el chofer pide más manualmente cuando lo necesita. Backend ya en prod.
 */

/** RPC `mi_tarjeta_vehiculo` — 0 o 1 fila. null/[] = sin tarjeta mapeada o sin acceso. */
export interface TarjetaConsumo {
  codigo_tarjeta: string;
  cupo_gal: number | null;
  cupo_monto: number | null;
  periodo: string;
  consumo_gal: number | null;
  consumo_monto: number | null;
  pct_gal: number | null;
  pct_monto: number | null;
}

/** Motivos válidos de `solicitar_cupo_tarjeta` (p_motivo). */
export type MotivoCupo = 'llego_limite' | 'bomba_rechazo' | 'pocos_galones' | 'otro';

/** Estado de una solicitud (`combustible_solicitudes_cupo.estado`). */
export type EstadoSolicitudCupo = 'pendiente' | 'ampliada' | 'rechazada' | 'cancelada';

/** RPC `mis_solicitudes_cupo` — una fila de `sgc.combustible_solicitudes_cupo`. */
export interface SolicitudCupo {
  id: string;
  codigo_tarjeta: string;
  vehiculo_id: string | null;
  solicitante_id: string;
  galones_pedidos: number | null;
  monto_pedido: number | null;
  motivo: MotivoCupo;
  nota: string | null;
  foto_rechazo_path: string | null;
  estado: EstadoSolicitudCupo;
  respuesta: string | null;
  nuevo_cupo_gal: number | null;
  nuevo_cupo_monto: number | null;
  atendida_por: string | null;
  atendida_at: string | null;
  es_prueba: boolean;
  created_at: string;
}

/** Input para `CupoTarjetaService.solicitar`. */
export interface SolicitarCupoInput {
  codigoTarjeta: string;
  vehiculoId?: string | null;
  galones?: number | null;
  monto?: number | null;
  motivo: MotivoCupo;
  nota?: string | null;
  fotoRechazoPath?: string | null;
}
