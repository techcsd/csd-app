import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { UserContextService } from './user-context.service';
import {
  FilaAplicarDocumento,
  PaginaEmparejada,
  PaginaLectura,
  ResultadoAplicarDocumento,
} from '../models/documento-flota.model';

/** A5 — respuesta de la edge `leer-documento-flota` (mismo contrato que `LecturaRecibo`/CF4). */
export interface LecturaDocumentoResp {
  ok: boolean;
  error?: string;
  paginas?: PaginaLectura[];
  modelo?: string;
  costo_usd?: number;
}

/**
 * A5 — "Leer documento" desde el perfil de UN vehículo: una foto → IA (edge
 * `leer-documento-flota`) → emparejar contra la flota (`flota_documentos_emparejar`)
 * → aplicar el cambio (`flota_documentos_aplicar`, gated server-side a Flota elevado).
 * El manejo del error de la edge mirror-ea `CombustibleService.leerRecibo` (lee el
 * body JSON del error cuando lo hay, incluyendo `sin_consentimiento_ia`/429).
 */
@Injectable({ providedIn: 'root' })
export class FlotaDocumentosIaService {
  private supabase = inject(SupabaseService);
  private ctx = inject(UserContextService);

  /** Lee UNA foto (base64 sin prefijo) con la IA. Solo online. */
  async leerDocumento(archivo: { data: string; mime: string }): Promise<LecturaDocumentoResp> {
    const { data, error } = await this.supabase.client.functions.invoke('leer-documento-flota', {
      body: { archivos: [archivo] },
    });
    if (error) {
      const ctx = (error as { context?: { body?: unknown } }).context;
      if (ctx?.body) {
        try {
          const parsed = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body;
          if (parsed?.error) return { ok: false, error: parsed.error };
        } catch {
          /* body no-JSON */
        }
      }
      return { ok: false, error: 'No se pudo leer el documento.' };
    }
    return (data as LecturaDocumentoResp) ?? { ok: false, error: 'No se pudo leer el documento.' };
  }

  /** Empareja las páginas leídas contra la flota (placa/VIN); barato, siempre se llama. */
  async emparejar(paginas: PaginaLectura[]): Promise<PaginaEmparejada[]> {
    const { data, error } = await this.supabase.client.rpc('flota_documentos_emparejar', {
      p_paginas: paginas,
    });
    if (error) throw new Error(error.message);
    return (data as PaginaEmparejada[]) ?? [];
  }

  /** Aplica el cambio al vehículo. El servidor gatea (admin/jefe_flota/logistica) y
   *  NUNCA pisa una vigencia más nueva (devuelve `omitido` en ese caso, no error). */
  async aplicar(filas: FilaAplicarDocumento[]): Promise<ResultadoAplicarDocumento[]> {
    const { data, error } = await this.supabase.client.rpc('flota_documentos_aplicar', {
      p_filas: filas,
    });
    if (error) throw new Error(error.message);
    return (data as ResultadoAplicarDocumento[]) ?? [];
  }

  /**
   * A5 — "Avisar a Flota" (un chofer sin permiso de aplicar propone el cambio):
   * reutiliza `notificar_modulo('flota', …)`, el mismo mecanismo que
   * `VehiculosService.pedirUnidadAFlota` ("Mi unidad" → "pedir unidad").
   */
  async avisarFlota(placa: string, tipoLabel: string, vehiculoId: string): Promise<void> {
    const nombre = this.ctx.profile()?.nombre || 'Alguien';
    const { error } = await this.supabase.client.rpc('notificar_modulo', {
      p_modulo: 'flota',
      p_tipo: 'documento_vehiculo_propuesto',
      p_titulo: 'Documento propuesto',
      p_mensaje: `${nombre} subió una foto de ${tipoLabel} del vehículo ${placa}. Revísala en Documentos.`,
      p_ruta: `/transporte/vehiculo/${vehiculoId}`,
    });
    if (error) throw new Error(error.message);
  }
}
