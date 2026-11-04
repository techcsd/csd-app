import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CapturedPhoto } from './camera.service';
import { blobABase64 } from '../../shared/utils/base64.util';
import {
  PropuestaConduceIA,
  PropuestaMantenimientoIA,
  PropuestaChecklistIA,
  PropuestaRequisicionIA,
  PropuestaUsoVehiculoIA,
} from '../models/formulario-ia.model';

/**
 * DF1-B..E (PROMPT 129) — cliente de la edge genérica `leer-formulario` (SGC,
 * ya desplegada en el Supabase de dev). Un formulario por método, el mismo
 * patrón de error/consentimiento/offline que `BitacoraIaService`.
 */
@Injectable({ providedIn: 'root' })
export class FormularioIaService {
  private supabase = inject(SupabaseService);

  async leerConduceExterno(input: { fotos: CapturedPhoto[]; proyectoId?: string | null }): Promise<PropuestaConduceIA> {
    const fotos = await Promise.all(
      input.fotos.map(async (f) => ({ data: await blobABase64(f.blob), mime: f.blob.type || 'image/jpeg' })),
    );
    return this.invocar('conduce_externo', { fotos, proyecto_id: input.proyectoId ?? null });
  }

  async leerMantenimiento(input: { audio: Blob }): Promise<PropuestaMantenimientoIA> {
    return this.invocar('mantenimiento', {
      audio: { data: await blobABase64(input.audio), mime: input.audio.type || 'audio/webm' },
    });
  }

  async leerChecklistVehiculo(input: {
    items: { id: string; etiqueta: string; es_critico: boolean }[];
    audio: Blob;
    fotos?: CapturedPhoto[];
  }): Promise<PropuestaChecklistIA> {
    const fotos = await Promise.all(
      (input.fotos ?? []).map(async (f) => ({ data: await blobABase64(f.blob), mime: f.blob.type || 'image/jpeg' })),
    );
    return this.invocar('checklist_vehiculo', {
      items: input.items,
      audio: { data: await blobABase64(input.audio), mime: input.audio.type || 'audio/webm' },
      fotos,
    });
  }

  async leerRequisicionVoz(input: { audio: Blob }): Promise<PropuestaRequisicionIA> {
    return this.invocar('requisicion', {
      audio: { data: await blobABase64(input.audio), mime: input.audio.type || 'audio/webm' },
    });
  }

  /** PROMPT di-ronda-03nov — lectura del tablero (km/horas, nivel, luces) al
   *  tomar/recibir o soltar un vehículo en "Uso de vehículo". */
  async leerUsoVehiculo(input: { foto: CapturedPhoto }): Promise<PropuestaUsoVehiculoIA> {
    return this.invocar('uso_vehiculo', {
      fotos: [{ data: await blobABase64(input.foto.blob), mime: input.foto.blob.type || 'image/jpeg' }],
    });
  }

  /** Marca la propuesta como aceptada (se usó para llenar el registro) o descartada. Best-effort. */
  async resolverPropuesta(propuestaId: string, estado: 'aceptada' | 'descartada', entidadId?: string): Promise<void> {
    try {
      await this.supabase.client
        .from('formulario_ia_propuestas')
        .update({ estado, entidad_id: entidadId ?? null, resuelta_en: new Date().toISOString() })
        .eq('id', propuestaId);
    } catch {
      /* métrica, nunca bloquea al usuario */
    }
  }

  /** La forma de la respuesta varía por tipo — cada método público la tipa al llamar. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async invocar(tipo: string, extra: Record<string, unknown>): Promise<any> {
    const { data, error } = await this.supabase.client.functions.invoke('leer-formulario', { body: { tipo, ...extra } });
    if (error) {
      const ctx = (error as { context?: { body?: unknown } }).context;
      if (ctx?.body) {
        try {
          const parsed = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body;
          if (parsed?.error) return { ok: false, error: parsed.error, error_code: parsed.error_code };
        } catch {
          /* ignore */
        }
      }
      return { ok: false, error: 'No se pudo leer el formulario. Llénalo a mano.' };
    }
    return data;
  }
}
