import { Injectable, inject } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import QRCode from 'qrcode';

import { SupabaseService } from './supabase.service';
import { TipoDocQr } from '../util/doc-qr';
import { environment } from '../../../environments/environment';

export interface DocQrResuelto {
  tipo: TipoDocQr;
  id: string;
  ruta: string;
  estado: string;
}

/** Códigos cortos que lanza `resolver`/`emitir` (se traducen con `mensajeErrorQr`). */
async function codigoDeError(error: unknown): Promise<string> {
  let motivo = '';
  try {
    const ctx = (error as { context?: Response }).context;
    const j = ctx ? ((await ctx.clone().json()) as { error?: string }) : null;
    motivo = j?.error ?? '';
  } catch {
    // sin cuerpo legible
  }
  if (!motivo && /fetch|network|failed to send/i.test((error as Error)?.message ?? '')) return 'sin_red';
  return motivo || 'token_formato';
}

/**
 * DX7/F4 — QR de documentos. Emitir y resolver pasan por la edge `conduce-qr` de SGC (la misma que
 * el conduce; mecanismo único). Resolver requiere red (online-only); el QR ya emitido se guarda en
 * el teléfono para poder MOSTRARLO sin red.
 */
@Injectable({ providedIn: 'root' })
export class DocQrService {
  private supabase = inject(SupabaseService);

  /** Resuelve el token escaneado. Lanza Error(código corto). */
  async resolver(token: string): Promise<DocQrResuelto> {
    const { data, error } = await this.supabase.client.functions.invoke('conduce-qr', {
      body: { accion: 'resolver', token },
    });
    if (error) throw new Error(await codigoDeError(error));
    const r = data as Partial<DocQrResuelto> | null;
    if (!r?.tipo || !r.id) throw new Error('token_formato');
    return { tipo: r.tipo, id: r.id, ruta: r.ruta ?? '', estado: r.estado ?? '' };
  }

  /** Data-URL del QR del documento. `null` si el tipo está apagado, sin acceso o sin red y sin copia local. */
  async qrDataUrl(tipo: TipoDocQr, id: string): Promise<string | null> {
    const clave = `csd.docqr.${tipo}.${id}`;
    try {
      const { data, error } = await this.supabase.client.functions.invoke('conduce-qr', {
        body: tipo === 'conduce' ? { accion: 'emitir', salidaId: id } : { accion: 'emitir', tipo, id },
      });
      if (error) throw error;
      const token = (data as { token?: string } | null)?.token;
      if (!token) return null;
      const origen = environment.appUrl;
      const url = await QRCode.toDataURL(`${origen}/d/${encodeURIComponent(token)}`, { width: 220, margin: 1 });
      try {
        await Preferences.set({ key: clave, value: url });
      } catch {
        // la copia local es un extra
      }
      return url;
    } catch {
      // Sin red (o apagado): se muestra el último QR emitido si existe.
      try {
        const { value } = await Preferences.get({ key: clave });
        return value ?? null;
      } catch {
        return null;
      }
    }
  }
}
