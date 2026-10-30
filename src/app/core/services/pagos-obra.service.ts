import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { PermanentSyncError, SyncService, throwSyncError } from '../sync/sync.service';
import { PagoObra, PagoObraLinea } from '../models/pagos-obra.model';

/** A4 — las firmas de descargo van al bucket `obra` (mismo bucket que otros
 *  documentos de obra), bajo `pagos/<pago_id>/firmas/<linea_id>.png`. */
const BUCKET = 'obra';
const SELECT_PAGO =
  'id, proyecto_id, semana_desde, semana_hasta, estado, complemento_de, creado_por, ' +
  'enviado_at, enviado_por, pdf_path, correos_enviados, reabierto_por, reabierto_at, ' +
  'es_prueba, created_at, updated_at';
const SELECT_LINEA =
  'id, pago_id, personal_id, nombre_snapshot, documento_tipo_snapshot, documento_numero_snapshot, ' +
  'cargo_snapshot, monto, concepto, firma_path, firmado_at, firmado_en, estado, created_at, updated_at';

/**
 * A4 — "Pagos" de obra: pago semanal de personal + descargo firmado en el
 * teléfono. El backend ya captura identificación + firma, genera el PDF y
 * avisa a Legal/gerencia (server-side); esta pieza solo consume las tablas
 * `pagos_obra`/`pagos_obra_lineas` (RLS ya acota a las obras del ingeniero) y
 * los RPCs `pagos_obra_crear`/`pagos_obra_linea_guardar`/`pagos_obra_enviar`.
 *
 * Monto/concepto/firma van por el OUTBOX (offline-first, ADR-002): un solo
 * tipo_op `pagos_firma` cubre los 3 (el RPC hace coalesce de lo que se manda).
 * `enviar()` es la única acción online-only (pg_net síncrono server-side):
 * nunca se encola, la pantalla la deshabilita sin señal.
 */
@Injectable({ providedIn: 'root' })
export class PagosObraService {
  private supabase = inject(SupabaseService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandler();
  }

  /** Semanas de pago visibles (RLS ya filtra por obra/rol — ver/operar). */
  async listar(): Promise<PagoObra[]> {
    const { data, error } = await this.supabase.client
      .from('pagos_obra')
      .select(SELECT_PAGO)
      .order('semana_desde', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as unknown as PagoObra[]) ?? [];
  }

  /** Detalle de una semana de pago. */
  async detalle(pagoId: string): Promise<PagoObra | null> {
    const { data, error } = await this.supabase.client
      .from('pagos_obra')
      .select(SELECT_PAGO)
      .eq('id', pagoId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as PagoObra) ?? null;
  }

  /** Líneas (una por trabajador) de una semana de pago. */
  async lineas(pagoId: string): Promise<PagoObraLinea[]> {
    const { data, error } = await this.supabase.client
      .from('pagos_obra_lineas')
      .select(SELECT_LINEA)
      .eq('pago_id', pagoId)
      .order('nombre_snapshot', { ascending: true });
    if (error) throw new Error(error.message);
    return (data as unknown as PagoObraLinea[]) ?? [];
  }

  /**
   * Crea (o recupera, es idempotente por proyecto+semana_desde) la semana de
   * pago de una obra. El servidor prellena las líneas desde el último
   * levantamiento cerrado. Online (RPC síncrono, no hay contrato offline para
   * "crear semana").
   */
  async crear(proyectoId: string, desde: string, hasta: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('pagos_obra_crear', {
      p_proyecto_id: proyectoId,
      p_desde: desde,
      p_hasta: hasta,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  /**
   * Envía el reporte: exige ≥1 línea firmada, marca la semana `enviado` y
   * dispara PDF+correo server-side (pg_net SÍNCRONO) — por eso es la ÚNICA
   * acción de este servicio que NO pasa por el outbox; la pantalla la
   * deshabilita sin conexión.
   */
  async enviar(pagoId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('pagos_obra_enviar', { p_pago_id: pagoId });
    if (error) throw new Error(error.message);
  }

  /** Guarda monto/concepto de una línea (sin tocar la firma). Offline-first. */
  async guardarMontoConcepto(lineaId: string, pagoId: string, monto: number | null, concepto: string | null): Promise<void> {
    await this.encolar({ lineaId, pagoId, monto, concepto });
  }

  /** Marca/desmarca "ausente" (sin firma). Offline-first. */
  async marcarAusente(lineaId: string, pagoId: string, ausente: boolean): Promise<void> {
    await this.encolar({ lineaId, pagoId, ausente });
  }

  /** Firma la línea (descargo). Sube la firma a Storage vía outbox y llama al RPC. */
  async firmar(
    lineaId: string,
    pagoId: string,
    monto: number | null,
    concepto: string | null,
    firmaBlob: Blob,
  ): Promise<void> {
    await this.encolar({ lineaId, pagoId, monto, concepto, firmaBlob });
  }

  private async encolar(input: {
    lineaId: string;
    pagoId: string;
    monto?: number | null;
    concepto?: string | null;
    ausente?: boolean;
    firmaBlob?: Blob;
  }): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    const fotos = input.firmaBlob
      ? [
          {
            id: `${id}:firma`,
            bucket: BUCKET,
            path: `pagos/${input.pagoId}/firmas/${input.lineaId}.png`,
            slot: 'firma',
            blob: input.firmaBlob,
          },
        ]
      : [];
    await this.sync.enqueue({
      id,
      tipo_op: 'pagos_firma',
      capturado_en,
      payload: {
        linea_id: input.lineaId,
        monto: input.monto ?? null,
        concepto: input.concepto ?? null,
        ausente: input.ausente ?? null,
      },
      fotos,
      resumen: { tipo: 'pagos_firma', linea_id: input.lineaId, capturado_en },
    });
  }

  private registerHandler(): void {
    this.sync.register('pagos_firma', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('pagos_obra_linea_guardar', {
        p_linea_id: payload['linea_id'],
        p_monto: payload['monto'] ?? null,
        p_concepto: payload['concepto'] ?? null,
        p_firma_path: photoPaths['firma'] ?? null,
        p_firmado_en: 'app',
        p_ausente: payload['ausente'] ?? null,
      });
      if (error) {
        // La semana ya fue enviada (22023): no hay flujo de "complemento" en la
        // app todavía — mensaje claro y accionable en vez del crudo del servidor.
        const code = (error as { code?: string }).code ?? '';
        const msg = (error as { message?: string }).message ?? '';
        if (code === '22023' && /enviad/i.test(msg)) {
          throw new PermanentSyncError(
            'Esta semana ya fue enviada; usa «complemento» para lo que faltó.',
            'validacion',
            undefined,
            undefined,
            code,
          );
        }
        throwSyncError(error);
      }
    });
  }
}
