// A4 (ronda DB) — Pagos de obra: pago semanal de personal + descargo firmado.
// Espejo de las tablas `sgc.pagos_obra` / `sgc.pagos_obra_lineas` (backend ya
// desplegado en dev). La app SOLO consume: crear semana, editar monto/concepto,
// firmar (offline, outbox) y enviar (online, dispara PDF+correo server-side).

export type PagoObraEstado = 'borrador' | 'enviado';
export type PagoObraLineaEstado = 'pendiente' | 'firmado' | 'ausente';
export type PagoFirmadoEn = 'app' | 'web';

export interface PagoObra {
  id: string;
  proyecto_id: string;
  semana_desde: string; // date YYYY-MM-DD
  semana_hasta: string; // date YYYY-MM-DD
  estado: PagoObraEstado;
  complemento_de: string | null;
  creado_por: string | null;
  enviado_at: string | null;
  enviado_por: string | null;
  pdf_path: string | null;
  correos_enviados: unknown;
  reabierto_por: string | null;
  reabierto_at: string | null;
  es_prueba?: boolean;
  created_at: string;
  updated_at: string;
}

export interface PagoObraLinea {
  id: string;
  pago_id: string;
  personal_id: string;
  nombre_snapshot: string;
  documento_tipo_snapshot: string | null;
  documento_numero_snapshot: string | null;
  cargo_snapshot: string | null;
  monto: number | null;
  concepto: string | null;
  firma_path: string | null;
  firmado_at: string | null;
  firmado_en: PagoFirmadoEn | null;
  estado: PagoObraLineaEstado;
  created_at: string;
  updated_at: string;
}
